import type { Dirent, Stats } from "node:fs";
import {
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  type DiagnosticClock,
  type DiagnosticSerializer,
  type DiagnosticUuid,
  diagnosticCauseRecord,
  diagnosticRunStartedData,
  serializeDiagnosticRecord,
} from "./diagnostics.ts";
import { redactSensitiveText } from "./errors.ts";
import type { EventSink, ObservabilityEventInput } from "./observability.ts";
import { sanitizeForOutput } from "./output.ts";

export const DIAGNOSTIC_MAX_EVENTS = 256;
export const DIAGNOSTIC_MAX_BYTES = 1_024 * 1_024;
export const DIAGNOSTIC_RETENTION = 20;

/** Only files this tool created are ever pruned or treated as managed logs. */
export const DIAGNOSTIC_FILENAME_PATTERN =
  /^myboxctl-\d{8}T\d{9}Z-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/;

type DiagnosticRecord = Record<string, unknown> & { type: string };

export function defaultDiagnosticsDirectory(
  env: Record<string, string | undefined> = process.env,
  homeDirectory = homedir(),
): string {
  const stateHome =
    env.XDG_STATE_HOME !== undefined && env.XDG_STATE_HOME.length > 0
      ? env.XDG_STATE_HOME
      : join(homeDirectory, ".local", "state");
  return join(stateHome, "myboxctl", "diagnostics");
}

export function diagnosticLogFileName(date: Date, uuid: string): string {
  return `myboxctl-${date.toISOString().replace(/[-:.]/g, "")}-${uuid}.jsonl`;
}

export type AutomaticDiagnosticBufferOptions = {
  command: string;
  json: boolean;
  options: Record<string, boolean>;
  clock?: DiagnosticClock;
  uuid?: DiagnosticUuid;
  serialize?: DiagnosticSerializer;
  maxEvents?: number;
  maxBytes?: number;
};

/**
 * Sanitized, bounded in-memory log for automatic failure diagnostics. Nothing touches the
 * filesystem while the command succeeds; {@link failureRecords} freezes the retained records for
 * a single exclusive write.
 */
export class AutomaticDiagnosticBuffer {
  readonly runId: string;
  readonly command: string;
  readonly json: boolean;
  #clock: DiagnosticClock;
  #serialize: DiagnosticSerializer;
  #maxEvents: number;
  #maxBytes: number;
  #started: DiagnosticRecord;
  #events: Array<{ record: DiagnosticRecord; bytes: number }> = [];
  #bytes = 0;
  #sequence = 1;
  #frozen = false;

  constructor(options: AutomaticDiagnosticBufferOptions) {
    this.command = options.command;
    this.json = options.json;
    this.#clock = options.clock ?? (() => new Date());
    this.#serialize = options.serialize ?? ((value) => JSON.stringify(value));
    this.#maxEvents = options.maxEvents ?? DIAGNOSTIC_MAX_EVENTS;
    this.#maxBytes = options.maxBytes ?? DIAGNOSTIC_MAX_BYTES;
    this.runId = (options.uuid ?? (() => crypto.randomUUID()))();
    this.#started = this.#envelope(0, {
      type: "run-started",
      data: diagnosticRunStartedData(options.command, options.options),
    });
  }

  readonly sink: EventSink = {
    emit: (event: ObservabilityEventInput) => {
      if (this.#frozen) return;
      const { type: _type, ...data } = event;
      const record = this.#envelope(this.#sequence, {
        type: "event",
        ...data,
        command: this.command,
      });
      this.#sequence += 1;
      const bytes = Buffer.byteLength(this.#line(record), "utf8");
      this.#events.push({ record, bytes });
      this.#bytes += bytes;
      while (
        this.#events.length > this.#maxEvents ||
        (this.#bytes > this.#maxBytes && this.#events.length > 1)
      ) {
        const dropped = this.#events.shift();
        if (dropped === undefined) break;
        this.#bytes -= dropped.bytes;
      }
    },
  };

  discard(): void {
    this.#frozen = true;
    this.#events = [];
    this.#bytes = 0;
  }

  failureRecords(exitCode: number, result: unknown, cause?: unknown): DiagnosticRecord[] {
    this.#frozen = true;
    const causeRecord = diagnosticCauseRecord(cause);
    const completed = this.#envelope(this.#sequence, {
      type: "run-completed",
      exitCode,
      result,
      ...(causeRecord === undefined ? {} : { cause: causeRecord }),
    });
    return [this.#started, ...this.#events.map((entry) => entry.record), completed];
  }

  #envelope(sequence: number, record: DiagnosticRecord): DiagnosticRecord {
    const envelope: DiagnosticRecord = {
      diagnosticSchemaVersion: 1,
      timestamp: this.#clock().toISOString(),
      runId: this.runId,
      sequence,
      ...record,
    };
    return sanitizeForOutput(envelope);
  }

  #line(record: DiagnosticRecord): string {
    return `${this.#serialize(sanitizeForOutput(record))}\n`;
  }
}

export type FailureLogIo = {
  mkdir: (path: string, options: { recursive: true; mode: number }) => unknown;
  open: (path: string, flags: string, mode: number) => number;
  write: (fd: number, buffer: Buffer, offset: number, length: number) => number;
  close: (fd: number) => void;
  readdir: (path: string, options: { withFileTypes: true }) => Dirent[];
  lstat: (path: string) => Stats;
  unlink: (path: string) => void;
  warn: (message: string) => void;
};

export const defaultFailureLogIo: FailureLogIo = {
  mkdir: (path, options) => mkdirSync(path, options),
  open: openSync,
  write: (fd, buffer, offset, length) => writeSync(fd, buffer, offset, length),
  close: closeSync,
  readdir: (path, options) => readdirSync(path, options),
  lstat: lstatSync,
  unlink: unlinkSync,
  warn: (message) => process.stderr.write(message),
};

export type FailureDiagnosticWriteOptions = {
  directory: string;
  command: string;
  json: boolean;
  retention?: number;
  clock?: DiagnosticClock;
  uuid?: DiagnosticUuid;
  serialize?: DiagnosticSerializer;
  io?: FailureLogIo;
};

function diagnosticWarning(
  options: { json: boolean; command: string },
  stage: "directory" | "write" | "retention",
  error: unknown,
): string {
  const code = redactSensitiveText((error as NodeJS.ErrnoException | undefined)?.code ?? "UNKNOWN");
  if (options.json) {
    return `${JSON.stringify({
      type: "event",
      level: "warning",
      event: "diagnostic.write-failed",
      command: options.command,
      data: { stage, code },
    })}\n`;
  }
  const label =
    stage === "directory"
      ? "Automatic diagnostic log could not be created"
      : stage === "write"
        ? "Automatic diagnostic log write failed"
        : "Automatic diagnostic log retention failed";
  return `Warning: ${label} (${code}).\n`;
}

/**
 * Writes the buffered records to one exclusive JSONL file and prunes older managed logs. Any
 * failure only produces a redacted warning so the original command result is preserved.
 */
export function persistFailureDiagnosticLog(
  records: readonly DiagnosticRecord[],
  options: FailureDiagnosticWriteOptions,
): string | undefined {
  const io = options.io ?? defaultFailureLogIo;
  const serialize = options.serialize ?? ((value) => JSON.stringify(value));
  const path = join(
    options.directory,
    diagnosticLogFileName(
      (options.clock ?? (() => new Date()))(),
      (options.uuid ?? (() => crypto.randomUUID()))(),
    ),
  );

  try {
    io.mkdir(options.directory, { recursive: true, mode: 0o700 });
  } catch (error) {
    io.warn(diagnosticWarning(options, "directory", error));
    return undefined;
  }

  let fd: number | undefined;
  try {
    fd = io.open(path, "wx", 0o600);
    for (const record of records) {
      const bytes = Buffer.from(`${serializeDiagnosticRecord(record, serialize)}\n`, "utf8");
      let offset = 0;
      while (offset < bytes.length) {
        const written = io.write(fd, bytes, offset, bytes.length - offset);
        if (written <= 0) throw new Error("Diagnostic write made no progress.");
        offset += written;
      }
    }
    io.close(fd);
    fd = undefined;
  } catch (error) {
    if (fd !== undefined) {
      try {
        io.close(fd);
      } catch {
        // Best effort cleanup; the original write error is reported below.
      }
    }
    io.warn(diagnosticWarning(options, "write", error));
    return undefined;
  }

  try {
    pruneFailureDiagnosticLogs(options.directory, options.retention ?? DIAGNOSTIC_RETENTION, io);
  } catch (error) {
    io.warn(diagnosticWarning(options, "retention", error));
  }
  return path;
}

/**
 * Keeps the newest managed logs and ignores symlinks, directories and foreign filenames inside
 * the diagnostics directory.
 */
export function pruneFailureDiagnosticLogs(
  directory: string,
  retention: number,
  io: FailureLogIo = defaultFailureLogIo,
): void {
  const managed: string[] = [];
  for (const entry of io.readdir(directory, { withFileTypes: true })) {
    if (!DIAGNOSTIC_FILENAME_PATTERN.test(entry.name)) continue;
    let stats: Stats;
    try {
      stats = io.lstat(join(directory, entry.name));
    } catch {
      continue;
    }
    if (!stats.isFile()) continue;
    managed.push(entry.name);
  }
  managed.sort();
  for (const name of managed.slice(0, Math.max(0, managed.length - retention))) {
    io.unlink(join(directory, name));
  }
}

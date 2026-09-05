import { closeSync, openSync, writeSync } from "node:fs";

import { DomainError, redactSensitiveText } from "./errors.ts";
import type { EventSink, ObservabilityEventInput } from "./observability.ts";
import { sanitizeForOutput } from "./output.ts";
import { VERSION } from "./version.ts";

export type DiagnosticBootstrap = {
  path?: string;
  command: string;
  options: Record<string, boolean>;
  skip: boolean;
};

const BOOLEAN_OPTIONS = new Set([
  "json",
  "verbose",
  "quiet",
  "recursive",
  "mkdir",
  "force",
  "overwrite",
  "parents",
  "ignore-missing",
]);

export function parseDiagnosticBootstrap(argv: readonly string[]): DiagnosticBootstrap {
  let path: string | undefined;
  const options: Record<string, boolean> = {};
  let command = "myboxctl";
  let separator = false;
  for (let index = 2; index < argv.length; index += 1) {
    const argument = argv[index] ?? "";
    if (argument === "--") {
      separator = true;
      continue;
    }
    if (!separator && argument === "--diagnostic-log") {
      if (path !== undefined)
        throw new DomainError("invalid-arguments", "--diagnostic-log may be specified only once.");
      const value = argv[index + 1];
      if (value === undefined || value.length === 0 || value.startsWith("--"))
        throw new DomainError("invalid-arguments", "--diagnostic-log requires a file path.");
      path = value;
      index += 1;
      continue;
    }
    if (!separator && argument.startsWith("--diagnostic-log=")) {
      if (path !== undefined)
        throw new DomainError("invalid-arguments", "--diagnostic-log may be specified only once.");
      const value = argument.slice("--diagnostic-log=".length);
      if (value.length === 0)
        throw new DomainError("invalid-arguments", "--diagnostic-log requires a file path.");
      path = value;
      continue;
    }
    if (!separator && argument.startsWith("--")) {
      const name = argument.slice(2);
      if (BOOLEAN_OPTIONS.has(name))
        options[name === "ignore-missing" ? "ignoreMissing" : name] = true;
      continue;
    }
    if (command === "myboxctl") command = argument === "ls" ? "list" : argument;
  }
  const skip =
    argv.length === 2 ||
    command === "myboxctl" ||
    argv.some((value) => ["--help", "-h", "--version", "-V"].includes(value));
  return { ...(path === undefined ? {} : { path }), command, options, skip };
}

type DiagnosticRecord = Record<string, unknown> & { type: string };

export type DiagnosticFileIo = {
  open: (path: string, flags: string, mode?: number) => number;
  write: (fd: number, buffer: Buffer, offset: number, length: number) => number;
  close: (fd: number) => void;
  warn: (message: string) => void;
};

const defaultFileIo: DiagnosticFileIo = {
  open: openSync,
  write: (fd, buffer, offset, length) => writeSync(fd, buffer, offset, length),
  close: closeSync,
  warn: (message) => process.stderr.write(message),
};

export class DiagnosticSession {
  readonly path: string;
  readonly command: string;
  readonly runId: string;
  readonly json: boolean;
  #fd: number;
  #sequence = 0;
  #active = true;
  #warned = false;
  #io: DiagnosticFileIo;

  private constructor(
    path: string,
    command: string,
    fd: number,
    runId: string,
    json: boolean,
    io: DiagnosticFileIo,
  ) {
    this.path = path;
    this.command = command;
    this.#fd = fd;
    this.runId = runId;
    this.json = json;
    this.#io = io;
  }

  static open(
    bootstrap: DiagnosticBootstrap,
    io: DiagnosticFileIo = defaultFileIo,
  ): DiagnosticSession | undefined {
    if (bootstrap.path === undefined || bootstrap.skip) return undefined;
    let fd: number;
    try {
      fd = io.open(bootstrap.path, "wx", 0o600);
    } catch (error) {
      throw new DomainError("local-file", "The diagnostic log could not be created.", {
        cause: error,
      });
    }
    const session = new DiagnosticSession(
      bootstrap.path,
      bootstrap.command,
      fd,
      crypto.randomUUID(),
      bootstrap.options.json === true,
      io,
    );
    try {
      session.write({
        type: "run-started",
        data: {
          version: VERSION,
          command: bootstrap.command,
          options: bootstrap.options,
          platform: process.platform,
          arch: process.arch,
          runtime: { name: "node", version: process.versions.node },
        },
      });
      if (!session.#active) throw new Error("The initial diagnostic record could not be written.");
    } catch (error) {
      try {
        io.close(fd);
      } catch {}
      throw new DomainError("local-file", "The diagnostic log could not be written.", {
        cause: error,
      });
    }
    return session;
  }

  readonly sink: EventSink = {
    emit: (event: ObservabilityEventInput) => {
      const { type: _type, ...data } = event;
      this.write({ type: "event", ...data, command: this.command });
    },
  };

  private write(record: DiagnosticRecord): void {
    if (!this.#active) return;
    const value = sanitizeForOutput({
      diagnosticSchemaVersion: 1,
      timestamp: new Date().toISOString(),
      runId: this.runId,
      sequence: this.#sequence,
      ...record,
    });
    const bytes = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
    let offset = 0;
    try {
      while (offset < bytes.length) {
        const written = this.#io.write(this.#fd, bytes, offset, bytes.length - offset);
        if (written <= 0) throw new Error("Diagnostic write made no progress.");
        offset += written;
      }
      this.#sequence += 1;
    } catch (error) {
      this.#active = false;
      if (!this.#warned) {
        this.#warned = true;
        const code = redactSensitiveText((error as NodeJS.ErrnoException).code ?? "UNKNOWN");
        this.#io.warn(
          this.json
            ? `${JSON.stringify({ type: "event", level: "warning", event: "diagnostic.write-failed", command: this.command, data: { stage: "write", code } })}\n`
            : `Warning: diagnostic log write failed (${code}).\n`,
        );
      }
    }
  }

  complete(exitCode: number, result: unknown, cause?: unknown): void {
    const raw = cause instanceof Error ? (cause as NodeJS.ErrnoException) : undefined;
    const safeCause =
      raw === undefined
        ? undefined
        : {
            name: raw.name,
            message: raw.message,
            ...(raw.code === undefined ? {} : { code: raw.code }),
            ...(raw.errno === undefined ? {} : { errno: raw.errno }),
            ...(raw.syscall === undefined ? {} : { syscall: raw.syscall }),
            ...(raw.path === undefined ? {} : { path: raw.path }),
            ...(raw.stack === undefined ? {} : { stack: raw.stack }),
          };
    this.write({
      type: "run-completed",
      exitCode,
      result,
      ...(safeCause === undefined ? {} : { cause: safeCause }),
    });
    this.close();
  }

  close(): void {
    if (this.#fd < 0) return;
    const fd = this.#fd;
    this.#fd = -1;
    try {
      this.#io.close(fd);
    } catch (error) {
      if (!this.#warned) {
        const code = redactSensitiveText((error as NodeJS.ErrnoException).code ?? "UNKNOWN");
        this.#io.warn(
          this.json
            ? `${JSON.stringify({ type: "event", level: "warning", event: "diagnostic.write-failed", command: this.command, data: { stage: "close", code } })}\n`
            : `Warning: diagnostic log close failed (${code}).\n`,
        );
      }
    }
  }
}

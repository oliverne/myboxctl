import { afterEach, describe, expect, test } from "bun:test";
import { closeSync, mkdirSync, openSync, writeSync } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AutomaticDiagnosticBuffer,
  DIAGNOSTIC_FILENAME_PATTERN,
  DIAGNOSTIC_MAX_EVENTS,
  defaultDiagnosticsDirectory,
  diagnosticLogFileName,
  type FailureLogIo,
  persistFailureDiagnosticLog,
  pruneFailureDiagnosticLogs,
} from "./failure-diagnostics.ts";

const temporaryDirectories: string[] = [];
afterEach(async () =>
  Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  ),
);

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "myboxctl-failure-diagnostics-"));
  temporaryDirectories.push(directory);
  return directory;
}

const clock = () => new Date("2026-10-05T01:02:03.456Z");
const runId = "00000000-0000-4000-8000-000000000001";

function stubIo(overrides: Partial<FailureLogIo> = {}): FailureLogIo {
  const unexpected = (): never => {
    throw new Error("Unexpected failure-log IO call.");
  };
  return {
    mkdir: unexpected,
    open: unexpected,
    write: unexpected,
    close: unexpected,
    readdir: unexpected,
    lstat: unexpected,
    unlink: unexpected,
    warn: () => {},
    ...overrides,
  };
}

describe("AutomaticDiagnosticBuffer", () => {
  test("keeps sanitized records bounded by count and never emits after freezing", () => {
    const buffer = new AutomaticDiagnosticBuffer({
      command: "list",
      json: false,
      options: { json: false },
      clock,
      uuid: () => runId,
      maxEvents: 3,
    });
    for (let index = 1; index <= 5; index += 1) {
      buffer.sink.emit({
        type: "event",
        level: "info",
        event: "upload.resume",
        data: { offset: index, totalBytes: 5 },
      });
    }

    const records = buffer.failureRecords(5, { ok: false });
    expect(records.map((record) => [record.sequence, record.type])).toEqual([
      [0, "run-started"],
      [3, "event"],
      [4, "event"],
      [5, "event"],
      [6, "run-completed"],
    ]);

    buffer.sink.emit({
      type: "event",
      level: "info",
      event: "upload.resume",
      data: { offset: 9, totalBytes: 9 },
    });
    expect(buffer.failureRecords(5, { ok: false })).toHaveLength(records.length);
  });

  test("drops the oldest events first when the byte budget is exceeded", () => {
    const buffer = new AutomaticDiagnosticBuffer({
      command: "list",
      json: false,
      options: {},
      clock,
      uuid: () => runId,
      maxBytes: 1,
    });
    for (let index = 1; index <= 4; index += 1) {
      buffer.sink.emit({
        type: "event",
        level: "info",
        event: "upload.resume",
        data: { offset: index, totalBytes: 4 },
      });
    }

    const records = buffer.failureRecords(1, { ok: false });
    expect(records.map((record) => record.sequence)).toEqual([0, 4, 5]);
  });

  test("defaults to keeping the newest 256 events", () => {
    const buffer = new AutomaticDiagnosticBuffer({
      command: "list",
      json: false,
      options: {},
      clock,
      uuid: () => runId,
    });
    for (let index = 1; index <= DIAGNOSTIC_MAX_EVENTS + 10; index += 1) {
      buffer.sink.emit({
        type: "event",
        level: "info",
        event: "upload.resume",
        data: { offset: index, totalBytes: DIAGNOSTIC_MAX_EVENTS + 10 },
      });
    }

    const records = buffer.failureRecords(1, { ok: false });
    expect(records).toHaveLength(DIAGNOSTIC_MAX_EVENTS + 2);
    expect(records[1]?.sequence).toBe(11);
  });

  test("discards retained events on success", () => {
    const buffer = new AutomaticDiagnosticBuffer({
      command: "list",
      json: false,
      options: {},
      clock,
      uuid: () => runId,
    });
    buffer.sink.emit({
      type: "event",
      level: "info",
      event: "upload.resume",
      data: { offset: 1, totalBytes: 2 },
    });
    buffer.discard();
    buffer.sink.emit({
      type: "event",
      level: "info",
      event: "upload.resume",
      data: { offset: 2, totalBytes: 2 },
    });

    const records = buffer.failureRecords(1, { ok: false });
    expect(records.map((record) => record.type)).toEqual(["run-started", "run-completed"]);
  });

  test("sanitizes secrets and URLs before records stay in memory", () => {
    const buffer = new AutomaticDiagnosticBuffer({
      command: "upload",
      json: true,
      options: { json: true },
      clock,
      uuid: () => runId,
    });
    buffer.sink.emit({
      type: "event",
      level: "info",
      event: "download.quota-advisory",
      data: {
        plan: "mbx_pat_must-not-appear",
        isDefault: true,
        expectedDownloads: 0,
        dailyLimit: 1,
      },
    });

    const records = buffer.failureRecords(
      7,
      {
        ok: false,
        error: { message: "GET https://signed.example/path?t=mbx_pat_must-not-appear" },
      },
      Object.assign(new Error("write failed"), { code: "EIO" }),
    );
    const text = JSON.stringify(records);

    expect(text).not.toContain("mbx_pat_must-not-appear");
    expect(text).not.toContain("https://");
    expect(records[2]).toMatchObject({ exitCode: 7, cause: { code: "EIO" } });
  });
});

describe("failure diagnostic persistence", () => {
  test("builds managed file names and default paths", () => {
    const name = diagnosticLogFileName(clock(), runId);
    expect(name).toBe(`myboxctl-20261005T010203456Z-${runId}.jsonl`);
    expect(DIAGNOSTIC_FILENAME_PATTERN.test(name)).toBe(true);
    expect(DIAGNOSTIC_FILENAME_PATTERN.test("myboxctl-notes.jsonl")).toBe(false);
    expect(DIAGNOSTIC_FILENAME_PATTERN.test(name.replace(".jsonl", ".txt"))).toBe(false);
    expect(defaultDiagnosticsDirectory({ XDG_STATE_HOME: "/state" }, "/home/tester")).toBe(
      join("/state", "myboxctl", "diagnostics"),
    );
    expect(defaultDiagnosticsDirectory({}, "/home/tester")).toBe(
      join("/home/tester", ".local", "state", "myboxctl", "diagnostics"),
    );
  });

  test("writes JSONL records with exclusive creation and restrictive modes", async () => {
    const root = await temporaryDirectory();
    const directory = join(root, "state", "myboxctl", "diagnostics");
    const buffer = new AutomaticDiagnosticBuffer({
      command: "list",
      json: false,
      options: {},
      clock,
      uuid: () => runId,
    });
    buffer.sink.emit({
      type: "event",
      level: "info",
      event: "http.retry-scheduled",
      data: { operation: "search", attempt: 1, waitMs: 10, delaySource: "backoff" },
    });
    const records = buffer.failureRecords(1, { ok: false });

    const path = persistFailureDiagnosticLog(records, {
      directory,
      command: "list",
      json: false,
      clock,
      uuid: () => runId,
    });

    expect(path).toBe(join(directory, diagnosticLogFileName(clock(), runId)));
    const lines = (await readFile(path as string, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(lines.map((line) => line.type)).toEqual(["run-started", "event", "run-completed"]);
    expect(lines[1]).toMatchObject({ event: "http.retry-scheduled", command: "list" });
    if (process.platform !== "win32") {
      expect(((await stat(directory)).mode & 0o777).toString(8)).toBe("700");
      expect(((await stat(path as string)).mode & 0o777).toString(8)).toBe("600");
    }
  });

  test("uses unique names when the clock does not advance", async () => {
    const directory = await temporaryDirectory();
    const records = [{ type: "run-started" }];
    const first = persistFailureDiagnosticLog(records, {
      directory,
      command: "list",
      json: false,
      clock,
    });
    const second = persistFailureDiagnosticLog(records, {
      directory,
      command: "list",
      json: false,
      clock,
    });

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first).not.toBe(second);
    expect((await readdir(directory)).length).toBe(2);
  });

  test("prunes only the newest managed regular files and ignores foreign entries", async () => {
    const directory = await temporaryDirectory();
    const managed: string[] = [];
    for (let index = 0; index < 25; index += 1) {
      const name = diagnosticLogFileName(
        new Date(Date.UTC(2025, 0, 1, 0, 0, index)),
        `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      );
      managed.push(name);
      await writeFile(join(directory, name), "log\n");
    }
    await writeFile(join(directory, "notes.jsonl"), "keep\n");
    await writeFile(join(directory, "myboxctl-notes.jsonl"), "keep\n");
    const matchingDirectoryName = diagnosticLogFileName(
      new Date(Date.UTC(2025, 0, 2, 0, 0, 0)),
      "00000000-0000-4000-8000-000000000098",
    );
    const matchingDirectory = join(directory, matchingDirectoryName);
    await mkdir(matchingDirectory);
    const symlinkName = diagnosticLogFileName(
      new Date(Date.UTC(2025, 0, 2)),
      "00000000-0000-4000-8000-000000000099",
    );
    await symlink(join(directory, "notes.jsonl"), join(directory, symlinkName));

    pruneFailureDiagnosticLogs(directory, 20);

    const remaining = await readdir(directory);
    const remainingLogs: string[] = [];
    for (const name of remaining) {
      if (!DIAGNOSTIC_FILENAME_PATTERN.test(name)) continue;
      if ((await lstat(join(directory, name))).isFile()) remainingLogs.push(name);
    }
    expect(remainingLogs).toHaveLength(20);
    expect(remainingLogs).not.toContain(managed[0]);
    expect(remainingLogs).toContain(managed[24] as string);
    expect(remainingLogs).not.toContain(matchingDirectoryName);
    expect(remainingLogs).not.toContain(symlinkName);
    expect(remaining).toContain("notes.jsonl");
    expect(remaining).toContain("myboxctl-notes.jsonl");
    expect((await lstat(join(directory, symlinkName))).isSymbolicLink()).toBe(true);
    expect((await stat(matchingDirectory)).isDirectory()).toBe(true);
  });

  test("reports write and retention failures without throwing", async () => {
    const directory = await temporaryDirectory();
    const warnings: string[] = [];
    const writeFailure = stubIo({
      mkdir: (path, options) => mkdirSync(path, options),
      open: () => {
        throw Object.assign(new Error("denied"), { code: "EACCES" });
      },
      warn: (message) => warnings.push(message),
    });

    expect(
      persistFailureDiagnosticLog([{ type: "run-started" }], {
        directory,
        command: "list",
        json: false,
        io: writeFailure,
        clock,
        uuid: () => runId,
      }),
    ).toBeUndefined();
    expect(warnings).toEqual(["Warning: Automatic diagnostic log write failed (EACCES).\n"]);

    warnings.length = 0;
    const retentionFailure = stubIo({
      mkdir: (path, options) => mkdirSync(path, options),
      open: (path, flags, mode) => openSync(path, flags, mode),
      write: (fd, buffer, offset, length) => writeSync(fd, buffer, offset, length),
      close: closeSync,
      readdir: () => {
        throw Object.assign(new Error("busy"), { code: "EBUSY" });
      },
      warn: (message) => warnings.push(message),
    });
    const path = persistFailureDiagnosticLog([{ type: "run-started" }], {
      directory,
      command: "list",
      json: false,
      io: retentionFailure,
      clock,
      uuid: () => runId,
    });

    expect(path).toBeDefined();
    expect(warnings).toEqual(["Warning: Automatic diagnostic log retention failed (EBUSY).\n"]);
  });

  test("emits a machine warning for JSON runs", () => {
    const warnings: string[] = [];
    const io = stubIo({
      mkdir: () => undefined,
      open: () => {
        throw Object.assign(new Error("denied"), { code: "EACCES" });
      },
      warn: (message) => warnings.push(message),
    });

    expect(
      persistFailureDiagnosticLog([{ type: "run-started" }], {
        directory: "/irrelevant",
        command: "list",
        json: true,
        io,
        clock,
        uuid: () => runId,
      }),
    ).toBeUndefined();
    expect(JSON.parse(warnings[0] as string)).toMatchObject({
      type: "event",
      level: "warning",
      event: "diagnostic.write-failed",
      command: "list",
      data: { stage: "write", code: "EACCES" },
    });
  });

  test("never overwrites an existing managed file", async () => {
    const directory = await temporaryDirectory();
    const records = [{ type: "run-started" }];
    const options = { directory, command: "list", json: false, clock, uuid: () => runId };
    const path = persistFailureDiagnosticLog(records, options);
    expect(path).toBeDefined();

    const warnings: string[] = [];
    const io = stubIo({
      mkdir: (target, mkdirOptions) => mkdirSync(target, mkdirOptions),
      open: openSync,
      write: (fd, buffer, offset, length) => writeSync(fd, buffer, offset, length),
      close: closeSync,
      warn: (message) => warnings.push(message),
    });
    expect(persistFailureDiagnosticLog(records, { ...options, io })).toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(await readFile(path as string, "utf8")).toBe('{"type":"run-started"}\n');
  });

  test("supports an injected serializer for byte accounting", () => {
    const serialized: string[] = [];
    const buffer = new AutomaticDiagnosticBuffer({
      command: "list",
      json: false,
      options: {},
      clock,
      uuid: () => runId,
      serialize: (value) => {
        const text = JSON.stringify(value);
        serialized.push(text);
        return text;
      },
    });
    buffer.sink.emit({
      type: "event",
      level: "info",
      event: "upload.resume",
      data: { offset: 1, totalBytes: 2 },
    });
    buffer.failureRecords(1, { ok: false });

    expect(serialized).toHaveLength(1);
    expect(serialized[0]).toContain("upload.resume");
  });
});

describe("failure log file handle cleanup", () => {
  test("closes a partially written file after an interrupted write", async () => {
    const directory = await temporaryDirectory();
    const closed: number[] = [];
    const io = stubIo({
      mkdir: (path, options) => mkdirSync(path, options),
      open: (path, flags, mode) => openSync(path, flags, mode),
      write: () => {
        throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
      },
      close: (fd) => {
        closed.push(fd);
        closeSync(fd);
      },
    });

    expect(
      persistFailureDiagnosticLog([{ type: "run-started" }], {
        directory,
        command: "list",
        json: false,
        io,
        clock,
        uuid: () => runId,
      }),
    ).toBeUndefined();
    expect(closed).toHaveLength(1);
  });
});

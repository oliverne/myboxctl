import { afterEach, describe, expect, test } from "bun:test";
import { closeSync, openSync, writeSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type DiagnosticFileIo,
  DiagnosticSession,
  parseDiagnosticBootstrap,
} from "./diagnostics.ts";

const temporaryDirectories: string[] = [];
afterEach(async () =>
  Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  ),
);

describe("diagnostic log", () => {
  test("parses root and command option positions without recording paths", () => {
    expect(
      parseDiagnosticBootstrap([
        "node",
        "cli",
        "--json",
        "--diagnostic-log",
        "한글 log.jsonl",
        "upload",
        "secret-local",
        "/secret-remote",
        "--recursive",
      ]),
    ).toMatchObject({
      path: "한글 log.jsonl",
      command: "upload",
      options: { json: true, recursive: true },
      skip: false,
    });
    expect(() =>
      parseDiagnosticBootstrap([
        "node",
        "cli",
        "list",
        "--diagnostic-log=a",
        "--diagnostic-log",
        "b",
      ]),
    ).toThrow();
  });

  test("writes ordered sanitized JSONL records with exclusive creation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "myboxctl-diagnostics-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "run.jsonl");
    const bootstrap = parseDiagnosticBootstrap(["node", "cli", "list", "--diagnostic-log", path]);
    const session = DiagnosticSession.open(bootstrap);
    expect(session).toBeDefined();
    session?.sink.emit({
      type: "event",
      level: "info",
      event: "upload.resume",
      data: { offset: 0, totalBytes: 1 },
    });
    session?.complete(0, { ok: true, token: "mbx_pat_secret" });
    const records = (await readFile(path, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(records.map((record) => [record.sequence, record.type])).toEqual([
      [0, "run-started"],
      [1, "event"],
      [2, "run-completed"],
    ]);
    expect(JSON.stringify(records)).not.toContain("mbx_pat_secret");
    expect(() => DiagnosticSession.open(bootstrap)).toThrow();
  });

  test("disables only the diagnostic sink after a mid-write failure", async () => {
    const directory = await mkdtemp(join(tmpdir(), "myboxctl-diagnostics-write-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "run.jsonl");
    const warnings: string[] = [];
    let writes = 0;
    const io: DiagnosticFileIo = {
      open: openSync,
      write: (fd, bytes, offset, length) => {
        writes += 1;
        if (writes === 2) {
          throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
        }
        return writeSync(fd, bytes, offset, length);
      },
      close: closeSync,
      warn: (message) => warnings.push(message),
    };
    const bootstrap = parseDiagnosticBootstrap([
      "node",
      "cli",
      "list",
      "--json",
      "--quiet",
      "--diagnostic-log",
      path,
    ]);
    const session = DiagnosticSession.open(bootstrap, io);
    expect(session).toBeDefined();
    session?.sink.emit({
      type: "event",
      level: "info",
      event: "download.quota-advisory",
      data: {
        plan: "mbx_pat_should-not-appear",
        isDefault: true,
        expectedDownloads: 0,
        dailyLimit: 1,
      },
    });
    session?.complete(0, { ok: true });

    expect(warnings).toHaveLength(1);
    expect(JSON.parse(warnings[0] ?? "")).toMatchObject({
      type: "event",
      event: "diagnostic.write-failed",
      data: { stage: "write", code: "ENOSPC" },
    });
    const records = (await readFile(path, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(records).toHaveLength(1);
    expect(JSON.stringify(records)).not.toContain("mbx_pat_should-not-appear");
  });

  test("fails before command execution when the first diagnostic write fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "myboxctl-diagnostics-first-write-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "run.jsonl");
    const warnings: string[] = [];
    const io: DiagnosticFileIo = {
      open: openSync,
      write: () => {
        throw Object.assign(new Error("read-only filesystem"), { code: "EACCES" });
      },
      close: closeSync,
      warn: (message) => warnings.push(message),
    };
    const bootstrap = parseDiagnosticBootstrap(["node", "cli", "list", "--diagnostic-log", path]);

    expect(() => DiagnosticSession.open(bootstrap, io)).toThrow(
      "The diagnostic log could not be written.",
    );
    expect(warnings).toEqual(["Warning: diagnostic log write failed (EACCES).\n"]);
  });

  test("reports a close failure without changing the completed result", async () => {
    const directory = await mkdtemp(join(tmpdir(), "myboxctl-diagnostics-close-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "run.jsonl");
    const warnings: string[] = [];
    const io: DiagnosticFileIo = {
      open: openSync,
      write: writeSync,
      close: (fd) => {
        closeSync(fd);
        throw Object.assign(new Error("close failed"), { code: "EIO" });
      },
      warn: (message) => warnings.push(message),
    };
    const bootstrap = parseDiagnosticBootstrap(["node", "cli", "list", "--diagnostic-log", path]);
    const session = DiagnosticSession.open(bootstrap, io);
    session?.complete(7, { ok: false, code: "LOCAL_FILE" });

    expect(warnings).toEqual(["Warning: diagnostic log close failed (EIO).\n"]);
    const records = (await readFile(path, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(records.map((record) => [record.type, record.exitCode])).toEqual([
      ["run-started", undefined],
      ["run-completed", 7],
    ]);
  });
});

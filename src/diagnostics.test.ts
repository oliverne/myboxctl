import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DiagnosticSession, parseDiagnosticBootstrap } from "./diagnostics.ts";

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
});

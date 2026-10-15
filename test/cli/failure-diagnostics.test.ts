import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { createFakeHttpServer, type FakeHttpServer } from "../http/server.ts";

const temporaryDirectories: string[] = [];
const servers: FakeHttpServer[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.close();
  }
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

type RunOptions = {
  configDirectory: string;
  stateDirectory: string;
  baseUrl?: string;
};

async function run(args: string[], options: RunOptions) {
  const child = Bun.spawn(["bun", "run", "src/cli.ts", ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      MYBOX_PAT: "mbx_pat_must-not-appear",
      MYBOX_BASE_URL: options.baseUrl ?? "http://127.0.0.1:9",
      MYBOX_TIMEOUT_MS: "5000",
      XDG_CONFIG_HOME: options.configDirectory,
      XDG_STATE_HOME: options.stateDirectory,
      MYBOX_RATE_LIMIT_STATE_PATH: join(options.stateDirectory, "rate-limit.json"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
}

async function temporaryRoot(): Promise<{
  configDirectory: string;
  stateDirectory: string;
  diagnosticsDirectory: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "myboxctl-auto-diagnostics-"));
  temporaryDirectories.push(root);
  const configDirectory = join(root, "config");
  const stateDirectory = join(root, "state");
  await mkdir(join(configDirectory, "myboxctl"), { recursive: true });
  await mkdir(stateDirectory, { recursive: true });
  return {
    configDirectory,
    stateDirectory,
    diagnosticsDirectory: join(stateDirectory, "myboxctl", "diagnostics"),
  };
}

async function writeConfig(configDirectory: string, body: unknown): Promise<void> {
  await writeFile(join(configDirectory, "myboxctl", "config.json"), `${JSON.stringify(body)}\n`);
}

describe("automatic failure diagnostics CLI contract", () => {
  test("creates no log by default", async () => {
    const root = await temporaryRoot();
    await writeConfig(root.configDirectory, { plan: "30GB" });

    const result = await run(["info", "/invalid/../path", "--json"], root);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout).diagnosticLogPath).toBeUndefined();
    await expect(readdir(root.diagnosticsDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("writes one sanitized log for a failed JSON run and exposes its path", async () => {
    const root = await temporaryRoot();
    await writeConfig(root.configDirectory, { diagnostics: { onError: true } });

    const result = await run(["info", "/invalid/../path", "--json"], root);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe("");
    const envelope = JSON.parse(result.stdout);
    expect(typeof envelope.diagnosticLogPath).toBe("string");
    expect(envelope.diagnosticLogPath.startsWith(root.diagnosticsDirectory)).toBe(true);

    const contents = await readFile(envelope.diagnosticLogPath, "utf8");
    const records = contents
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(records.map((record) => record.type)).toEqual(["run-started", "run-completed"]);
    expect(records[1]).toMatchObject({ exitCode: 2, result: { ok: false, command: "info" } });
    expect(contents).not.toContain("mbx_pat_must-not-appear");
  });

  test("prints the log path on stderr for human failures", async () => {
    const root = await temporaryRoot();
    await writeConfig(root.configDirectory, { diagnostics: { onError: true } });

    const result = await run(["info", "/invalid/../path"], root);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    const pathLines = result.stderr
      .split("\n")
      .filter((line) => line.startsWith("Diagnostic log: "));
    expect(pathLines).toHaveLength(1);
    const path = (pathLines[0] as string).slice("Diagnostic log: ".length);
    expect((await stat(path)).isFile()).toBe(true);
    expect(result.stderr.trim().split("\n")[0]).toStartWith("Error: ");
  });

  test("prefers an explicit --diagnostic-log over the automatic log", async () => {
    const root = await temporaryRoot();
    await writeConfig(root.configDirectory, { diagnostics: { onError: true } });
    const explicitPath = join(root.stateDirectory, "explicit.jsonl");

    const result = await run(
      ["info", "/invalid/../path", "--json", "--diagnostic-log", explicitPath],
      root,
    );

    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout).diagnosticLogPath).toBeUndefined();
    expect((await stat(explicitPath)).isFile()).toBe(true);
    await expect(readdir(root.diagnosticsDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("creates no log for a successful run", async () => {
    const root = await temporaryRoot();
    await writeConfig(root.configDirectory, { diagnostics: { onError: true } });
    const server = await createFakeHttpServer({ handler: () => ({ body: { resources: [] } }) });
    servers.push(server);

    const result = await run(["info", "/", "--json"], { ...root, baseUrl: server.baseUrl });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    await expect(readdir(root.diagnosticsDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("creates no log for help, version, or no arguments", async () => {
    const root = await temporaryRoot();
    await writeConfig(root.configDirectory, { diagnostics: { onError: true } });

    for (const args of [[], ["--help"], ["--version"], ["info", "--help"]]) {
      const result = await run(args, root);
      expect(result.exitCode).toBe(0);
    }
    await expect(readdir(root.diagnosticsDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("does not create a log when config cannot be validated", async () => {
    const root = await temporaryRoot();
    await writeFile(join(root.configDirectory, "myboxctl", "config.json"), "{ not json\n");

    const result = await run(["info", "/invalid/../path", "--json"], root);

    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout).diagnosticLogPath).toBeUndefined();
    await expect(readdir(root.diagnosticsDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("keeps distinct logs for concurrent failing processes", async () => {
    const root = await temporaryRoot();
    await writeConfig(root.configDirectory, { diagnostics: { onError: true } });

    const [first, second] = await Promise.all([
      run(["info", "/invalid/../path", "--json"], root),
      run(["info", "/invalid/../path", "--json"], root),
    ]);

    expect(first.exitCode).toBe(2);
    expect(second.exitCode).toBe(2);
    const firstPath = JSON.parse(first.stdout).diagnosticLogPath;
    const secondPath = JSON.parse(second.stdout).diagnosticLogPath;
    expect(firstPath).not.toBe(secondPath);
    expect((await readdir(root.diagnosticsDirectory)).length).toBe(2);
  });

  test("prunes older managed logs after a failure", async () => {
    const root = await temporaryRoot();
    await writeConfig(root.configDirectory, { diagnostics: { onError: true } });
    await mkdir(root.diagnosticsDirectory, { recursive: true });
    for (let index = 0; index < 25; index += 1) {
      const name = `myboxctl-20250101T0000${String(index).padStart(2, "0")}000Z-00000000-0000-4000-8000-${String(index).padStart(12, "0")}.jsonl`;
      await writeFile(join(root.diagnosticsDirectory, name), "log\n");
    }

    const result = await run(["info", "/invalid/../path", "--json"], root);

    expect(result.exitCode).toBe(2);
    const entries = await readdir(root.diagnosticsDirectory);
    expect(entries).toHaveLength(20);
    expect(entries).toContain(basename(JSON.parse(result.stdout).diagnosticLogPath));
  });
});

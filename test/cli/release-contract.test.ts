import { describe, expect, test } from "bun:test";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const artifactPath = join(process.cwd(), "dist", "cli.js");

type ProcessResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  invocation: "direct" | "bun";
};

function cleanEnvironment(): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? process.cwd(),
  };
}

async function artifactInvocation(args: string[]): Promise<{
  command: string[];
  invocation: "direct" | "bun";
}> {
  const artifactStats = await stat(artifactPath);
  const firstLine = (await readFile(artifactPath, "utf8")).split(/\r?\n/u).at(0);
  expect(firstLine).toBe("#!/usr/bin/env bun");
  const executable = process.platform !== "win32" && (artifactStats.mode & 0o111) !== 0;

  if (executable) {
    return { command: [artifactPath, ...args], invocation: "direct" };
  }

  return { command: [process.execPath, artifactPath, ...args], invocation: "bun" };
}

async function runArtifact(args: string[]): Promise<ProcessResult> {
  const { command, invocation } = await artifactInvocation(args);
  const subprocess = Bun.spawn(command, {
    cwd: process.cwd(),
    env: cleanEnvironment(),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
    subprocess.exited,
  ]);

  return { exitCode, stdout, stderr, invocation };
}

describe("built CLI release contract", () => {
  test("runs the build artifact with a direct shebang or Bun invocation", async () => {
    const result = await runArtifact(["--version"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("0.0.0\n");
    expect(result.stderr).toBe("");
    expect(["direct", "bun"]).toContain(result.invocation);
  });

  test("renders help from the build artifact without diagnostics", async () => {
    const result = await runArtifact(["--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage: myboxctl");
    expect(result.stdout).toContain("list|ls");
    expect(result.stdout).toContain("info");
    expect(result.stdout).not.toMatch(/\n\s+stat\b/);
    expect(result.stdout).not.toMatch(/\n\s+ensure-dir\b/);
    expect(result.stdout).not.toMatch(/\n\s+put\b/);
    expect(result.stderr).toBe("");
  });

  test("keeps an invalid argument failure as one JSON document on stdout", async () => {
    const result = await runArtifact(["info", "--json"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe("");
    expect(result.stdout.endsWith("\n")).toBe(true);
    expect(result.stdout.trim().split(/\r?\n/u)).toHaveLength(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      schemaVersion: 1,
      command: "info",
      error: {
        kind: "invalid-arguments",
        retryable: false,
      },
    });
    const failure = JSON.parse(result.stdout) as { error?: { message?: unknown } };
    expect(typeof failure.error?.message).toBe("string");
  });

  test("keeps the canonical list command in machine mode", async () => {
    const result = await runArtifact(["list", "--unknown", "--json"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      schemaVersion: 1,
      ok: false,
      command: "list",
      error: { kind: "invalid-arguments" },
    });
  });
});

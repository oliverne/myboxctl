import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function output(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text();
}

describe("npm package", () => {
  test("built Node launcher runs the CLI exactly once", async () => {
    const directory = await mkdtemp(join(tmpdir(), "myboxctl-npm-package-"));
    const distPath = join(directory, "cli.js");
    const outDir = join(directory, "package");

    try {
      const build = Bun.spawn(
        ["bun", "run", "scripts/build.ts", "--version", "1.2.3", "--outfile", distPath],
        { stdout: "ignore", stderr: "pipe" },
      );
      const [buildStderr, buildExitCode] = await Promise.all([output(build.stderr), build.exited]);
      expect(buildExitCode).toBe(0);
      expect(buildStderr).toBe("");

      const prepare = Bun.spawn(
        [
          "bun",
          "run",
          "scripts/prepare-npm.ts",
          "--version",
          "1.2.3",
          "--dist",
          distPath,
          "--outdir",
          outDir,
        ],
        { stdout: "ignore", stderr: "pipe" },
      );
      const [prepareStderr, prepareExitCode] = await Promise.all([
        output(prepare.stderr),
        prepare.exited,
      ]);
      expect(prepareExitCode).toBe(0);
      expect(prepareStderr).toBe("");

      const launcher = Bun.spawn(["node", join(outDir, "bin", "myboxctl.js"), "--version"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        output(launcher.stdout),
        output(launcher.stderr),
        launcher.exited,
      ]);

      expect(exitCode).toBe(0);
      expect(stdout).toBe("1.2.3\n");
      expect(stderr).toBe("");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("Node launcher records failure and preserves diagnostic create errors on Unicode paths", async () => {
    const directory = await mkdtemp(join(tmpdir(), "myboxctl-npm-diagnostic-"));
    const distPath = join(directory, "cli.js");
    const outDir = join(directory, "package");
    const logPath = join(directory, "한글 diagnostic log.jsonl");
    const invalidLogPath = join(directory, "기존 diagnostic directory");

    try {
      const build = Bun.spawn(
        ["bun", "run", "scripts/build.ts", "--version", "1.2.3", "--outfile", distPath],
        { stdout: "ignore", stderr: "pipe" },
      );
      const [buildStderr, buildExitCode] = await Promise.all([output(build.stderr), build.exited]);
      expect(buildExitCode).toBe(0);
      expect(buildStderr).toBe("");

      const prepare = Bun.spawn(
        [
          "bun",
          "run",
          "scripts/prepare-npm.ts",
          "--version",
          "1.2.3",
          "--dist",
          distPath,
          "--outdir",
          outDir,
        ],
        { stdout: "ignore", stderr: "pipe" },
      );
      const [prepareStderr, prepareExitCode] = await Promise.all([
        output(prepare.stderr),
        prepare.exited,
      ]);
      expect(prepareExitCode).toBe(0);
      expect(prepareStderr).toBe("");

      const launcherPath = join(outDir, "bin", "myboxctl.js");
      const commandFailure = Bun.spawn(
        ["node", launcherPath, "unknown", "--json", "--diagnostic-log", logPath],
        { stdout: "pipe", stderr: "pipe" },
      );
      const [stdout, stderr, exitCode] = await Promise.all([
        output(commandFailure.stdout),
        output(commandFailure.stderr),
        commandFailure.exited,
      ]);

      expect(exitCode).toBe(2);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toMatchObject({
        schemaVersion: 1,
        ok: false,
        command: "unknown",
        error: { kind: "invalid-arguments", retryable: false },
      });
      const records = (await readFile(logPath, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(records.map((record) => record.type)).toEqual(["run-started", "run-completed"]);
      expect(records[1]).toMatchObject({
        type: "run-completed",
        exitCode: 2,
        result: { ok: false, command: "unknown" },
      });

      await mkdir(invalidLogPath);
      const diagnosticFailure = Bun.spawn(
        ["node", launcherPath, "unknown", "--json", "--diagnostic-log", invalidLogPath],
        { stdout: "pipe", stderr: "pipe" },
      );
      const [failureStdout, failureStderr, failureExitCode] = await Promise.all([
        output(diagnosticFailure.stdout),
        output(diagnosticFailure.stderr),
        diagnosticFailure.exited,
      ]);

      expect(failureExitCode).toBe(7);
      expect(failureStderr).toBe("");
      expect(JSON.parse(failureStdout)).toMatchObject({
        schemaVersion: 1,
        ok: false,
        command: "unknown",
        error: { kind: "local-file", retryable: false },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("Node launcher가 pipe로 전달한 큰 stdout/stderr와 exit code를 보존한다", async () => {
    const directory = await mkdtemp(join(tmpdir(), "myboxctl-npm-package-"));
    const distPath = join(directory, "cli.js");
    const outDir = join(directory, "package");
    const stdoutText = "o".repeat(2 * 1024 * 1024);
    const stderrText = "e".repeat(2 * 1024 * 1024);

    try {
      await writeFile(
        distPath,
        `export async function runCli() {
  process.stdout.write(${JSON.stringify(stdoutText)});
  process.stderr.write(${JSON.stringify(stderrText)});
  return 7;
}\n`,
      );

      const prepare = Bun.spawn(
        [
          "bun",
          "run",
          "scripts/prepare-npm.ts",
          "--version",
          "1.2.3",
          "--dist",
          distPath,
          "--outdir",
          outDir,
        ],
        { stdout: "pipe", stderr: "pipe" },
      );
      const [prepareStdout, prepareStderr, prepareExitCode] = await Promise.all([
        output(prepare.stdout),
        output(prepare.stderr),
        prepare.exited,
      ]);

      expect(prepareExitCode).toBe(0);
      expect(prepareStderr).toBe("");
      expect(prepareStdout).toContain("Prepared npm package");

      const launcher = Bun.spawn(["node", join(outDir, "bin", "myboxctl.js")], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        output(launcher.stdout),
        output(launcher.stderr),
        launcher.exited,
      ]);

      expect(exitCode).toBe(7);
      expect(stdout).toBe(stdoutText);
      expect(stderr).toBe(stderrText);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("영문·국문 README를 npm package에 포함한다", async () => {
    const directory = await mkdtemp(join(tmpdir(), "myboxctl-npm-package-"));
    const distPath = join(directory, "cli.js");
    const outDir = join(directory, "package");

    try {
      await writeFile(distPath, "export async function runCli() { return 0; }\n");
      const prepare = Bun.spawn(
        [
          "bun",
          "run",
          "scripts/prepare-npm.ts",
          "--version",
          "1.2.3",
          "--dist",
          distPath,
          "--outdir",
          outDir,
        ],
        { stdout: "ignore", stderr: "pipe" },
      );
      const [prepareStderr, prepareExitCode] = await Promise.all([
        output(prepare.stderr),
        prepare.exited,
      ]);

      expect(prepareExitCode).toBe(0);
      expect(prepareStderr).toBe("");

      const packageJson = JSON.parse(await readFile(join(outDir, "package.json"), "utf8"));
      expect(packageJson.files).toContain("README.md");
      expect(packageJson.files).toContain("README.ko.md");
      expect(await readFile(join(outDir, "README.md"), "utf8")).toBe(
        await readFile("README.md", "utf8"),
      );
      expect(await readFile(join(outDir, "README.ko.md"), "utf8")).toBe(
        await readFile("README.ko.md", "utf8"),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

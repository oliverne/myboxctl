import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFakeHttpServer, type FakeHttpServer, type RecordedRequest } from "../http/server.ts";

async function output(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text();
}

function searchPage(resources: unknown[] = []) {
  return { resources, responseMetaData: {} };
}

function storageResponse() {
  return {
    fileCounts: {
      archive: 0,
      audio: 0,
      document: 0,
      etc: 0,
      executable: 0,
      image: 0,
      total: 0,
      video: 0,
    },
    maxFileBytes: 1_000_000,
    quotaBytes: 10_000_000,
    trashAutoDeleteDays: 30,
    usedBytes: 0,
  };
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

  test("Node launcher streams an upload body with Node fetch", async () => {
    const directory = await mkdtemp(join(tmpdir(), "myboxctl-npm-upload-"));
    const distPath = join(directory, "cli.js");
    const outDir = join(directory, "package");
    const localPath = join(directory, "report.txt");
    const rateLimitStatePath = join(directory, "rate-limit.json");
    await writeFile(localPath, "content");

    let server: FakeHttpServer | undefined;
    try {
      server = await createFakeHttpServer({
        handler: (request: RecordedRequest) => {
          if (request.path === "/v1/drive/storage") {
            return { body: storageResponse() };
          }
          if (request.path.startsWith("/v1/search/resources/")) {
            return { body: searchPage() };
          }
          if (request.path === "/v1/drive/files") {
            return {
              status: 201,
              body: { uploadUrl: `${server?.baseUrl}/storage/upload`, offset: 0 },
            };
          }
          if (request.path === "/storage/upload") {
            return { body: { resourceId: "file-1", name: "report.txt", fileSize: 7 } };
          }
          if (request.path === "/v1/drive/resources/file-1") {
            return {
              body: {
                resourceId: "file-1",
                parentId: "parent-1",
                name: "report.txt",
                type: "file",
                size: 7,
                createdAt: "2026-08-23T10:00:00Z",
                modifiedAt: "2026-08-23T10:00:01Z",
                accessedAt: "2026-08-23T10:00:01Z",
                isFavorite: false,
                isHidden: false,
                lastModifiedBy: "tester",
              },
            };
          }
          return { status: 500, body: { code: "UNEXPECTED", message: "unexpected request" } };
        },
      });

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

      const launcher = Bun.spawn(
        ["node", join(outDir, "bin", "myboxctl.js"), "upload", localPath, "/report.txt", "--json"],
        {
          env: {
            ...process.env,
            MYBOX_PAT: "test-pat",
            MYBOX_BASE_URL: server.baseUrl,
            MYBOX_TIMEOUT_MS: "5000",
            MYBOX_RATE_LIMIT_STATE_PATH: rateLimitStatePath,
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const [stdout, stderr, exitCode] = await Promise.all([
        output(launcher.stdout),
        output(launcher.stderr),
        launcher.exited,
      ]);

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toMatchObject({
        schemaVersion: 1,
        ok: true,
        command: "upload",
        action: "uploaded",
        data: { path: "/report.txt", resourceId: "file-1", sizeBytes: 7 },
      });
      expect(
        server.requests.find((request) => request.path === "/storage/upload")?.bodyText,
      ).toContain("content\r\n--");
    } finally {
      server?.close();
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

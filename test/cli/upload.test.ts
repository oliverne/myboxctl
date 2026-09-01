import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UploadDependencies } from "../../src/features/upload.ts";
import { resolveUploadDestination } from "../../src/features/upload-command.ts";
import { createFakeHttpServer, type FakeHttpServer, type RecordedRequest } from "../http/server.ts";

const servers: FakeHttpServer[] = [];
const directories: string[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.close();
  }
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

function searchPage(resources: unknown[] = []) {
  return { resources, responseMetaData: {} };
}

function storageResponse(maxFileBytes = 1_000_000) {
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
    maxFileBytes,
    quotaBytes: 10_000_000,
    trashAutoDeleteDays: 30,
    usedBytes: 0,
  };
}

async function runCli(
  args: string[],
  baseUrl: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const subprocess = Bun.spawn(["bun", "run", "src/cli.ts", ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      MYBOX_PAT: "test-pat",
      MYBOX_BASE_URL: baseUrl,
      MYBOX_TIMEOUT_MS: "5000",
      MYBOX_RATE_LIMIT_STATE_PATH: join(
        tmpdir(),
        `myboxctl-cli-rate-limit-${crypto.randomUUID()}.json`,
      ),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
    subprocess.exited,
  ]);
  return { exitCode, stdout, stderr };
}

describe("upload local basename", () => {
  function stubDependencies(): UploadDependencies {
    return {
      client: {} as never,
      resolver: { resolveCanonical: async () => ({}) } as never,
      uploader: {} as never,
      timeoutMs: 1_000,
    };
  }

  test("uses host-native basename without normalizing backslashes on POSIX", async () => {
    if (process.platform === "win32") return;
    const destination = await resolveUploadDestination(
      "/tmp/data/report\\2026.txt",
      undefined,
      {},
      stubDependencies(),
    );
    expect(destination).toBe("/report\\2026.txt");
  });

  test("keeps a Windows-style path literal on POSIX", async () => {
    if (process.platform === "win32") return;
    const destination = await resolveUploadDestination(
      "C:\\Users\\tester\\data\\file name.txt",
      undefined,
      {},
      stubDependencies(),
    );
    expect(destination).toBe("/C:\\Users\\tester\\data\\file name.txt");
  });
});

describe("upload command subprocess contract", () => {
  test("uploads a local file and emits one JSON envelope", async () => {
    const directory = await mkdtemp(join(tmpdir(), "myboxctl-upload-cli-"));
    directories.push(directory);
    const localPath = join(directory, "한글 report.txt");
    await writeFile(localPath, "content");
    const server = await createFakeHttpServer({
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
            body: { uploadUrl: `${server.baseUrl}/storage/upload`, offset: 0 },
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
    servers.push(server);

    const result = await runCli(["upload", localPath, "/report.txt", "--json"], server.baseUrl);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      schemaVersion: 1,
      ok: true,
      command: "upload",
      action: "uploaded",
      data: {
        path: "/report.txt",
        resourceId: "file-1",
        sizeBytes: 7,
        modifiedAt: "2026-08-23T10:00:01.000Z",
        reason: "remote-absent",
      },
    });
    expect(result.stderr).toBe("");
    expect(
      server.requests.find((request) => request.path === "/storage/upload")?.bodyText,
    ).toContain("content\r\n--");

    const verbose = await runCli(
      ["upload", localPath, "/report.txt", "--json", "--verbose"],
      server.baseUrl,
    );
    expect(verbose.exitCode).toBe(0);
    expect(JSON.parse(verbose.stdout)).toMatchObject({ ok: true, command: "upload" });
    const events = verbose.stderr
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { event: string; command: string });
    expect(events.every((event) => event.command === "upload")).toBe(true);
    expect(events.map((event) => event.event)).toContain("upload.transfer-started");
    expect(events.map((event) => event.event)).toContain("upload.transfer-completed");
  });

  test("rejects a control-character remote path before HTTP", async () => {
    const directory = await mkdtemp(join(tmpdir(), "myboxctl-upload-cli-control-"));
    directories.push(directory);
    const localPath = join(directory, "local.txt");
    await writeFile(localPath, "content");
    const server = await createFakeHttpServer();
    servers.push(server);

    const remotePath = `/report${String.fromCodePoint(0x0d)}injected.txt`;
    const result = await runCli(["upload", localPath, remotePath, "--json"], server.baseUrl);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      command: "upload",
      error: { kind: "invalid-remote-path", retryable: false },
    });
    expect(server.requests).toHaveLength(0);
  });

  test("returns FILE_TOO_LARGE before upload mutation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "myboxctl-upload-cli-large-"));
    directories.push(directory);
    const localPath = join(directory, "large.txt");
    await writeFile(localPath, "content");
    const server = await createFakeHttpServer({
      handler: (request: RecordedRequest) => {
        if (request.path === "/v1/drive/storage") {
          return { body: storageResponse(1) };
        }
        if (request.path.startsWith("/v1/search/resources/")) {
          return { body: searchPage() };
        }
        return { status: 500, body: { code: "UNEXPECTED", message: "unexpected request" } };
      },
    });
    servers.push(server);

    const result = await runCli(["upload", localPath, "/large.txt", "--json"], server.baseUrl);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      command: "upload",
      error: { kind: "invalid-arguments", code: "FILE_TOO_LARGE", retryable: false },
    });
    expect(server.requests.filter((request) => request.method === "POST")).toHaveLength(0);
  });
});

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

function searchFile() {
  return {
    resourceId: "file-1",
    name: "report.txt",
    type: "file",
    path: "/report.txt",
    parentPath: "/",
  };
}

function resourceDetail(size: number, modifiedAt: string) {
  return {
    resourceId: "file-1",
    parentId: "parent-1",
    name: "report.txt",
    type: "file",
    size,
    createdAt: "2026-08-23T10:00:00Z",
    modifiedAt,
    accessedAt: modifiedAt,
    isFavorite: false,
    isHidden: false,
    lastModifiedBy: "tester",
  };
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

async function runCli(args: string[], baseUrl: string) {
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

async function localFile() {
  const directory = await mkdtemp(join(tmpdir(), "myboxctl-put-cli-"));
  directories.push(directory);
  const path = join(directory, "report.txt");
  await writeFile(path, "abcdef");
  const timestamp = new Date("2026-08-23T10:00:00Z");
  await utimes(path, timestamp, timestamp);
  return { path, stats: await stat(path) };
}

describe("put command subprocess contract", () => {
  test("emits skipped metadata and reason as one JSON envelope", async () => {
    const local = await localFile();
    const modifiedAt = new Date(local.stats.mtimeMs).toISOString();
    const server = await createFakeHttpServer({
      handler: (request: RecordedRequest) => {
        if (request.path === "/v1/drive/storage") {
          return { body: storageResponse() };
        }
        if (request.path === "/v1/search/resources/folders") {
          return { body: searchPage() };
        }
        if (request.path === "/v1/search/resources/files") {
          return { body: searchPage([searchFile()]) };
        }
        if (request.path === "/v1/drive/resources/file-1") {
          return { body: resourceDetail(6, modifiedAt) };
        }
        return { status: 500, body: { code: "UNEXPECTED", message: "unexpected request" } };
      },
    });
    servers.push(server);

    const result = await runCli(["put", local.path, "/report.txt", "--json"], server.baseUrl);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      command: "put",
      action: "skipped",
      data: {
        path: "/report.txt",
        resourceId: "file-1",
        size: 6,
        modifiedAt,
        reason: "remote-is-current",
      },
    });
  });

  test("returns remote-newer conflict unless force is explicit", async () => {
    const local = await localFile();
    const remoteModifiedAt = new Date(local.stats.mtimeMs + 10_000).toISOString();
    const server = await createFakeHttpServer({
      handler: (request: RecordedRequest) => {
        if (request.path === "/v1/drive/storage") {
          return { body: storageResponse() };
        }
        if (request.path === "/v1/search/resources/folders") {
          return { body: searchPage() };
        }
        if (request.path === "/v1/search/resources/files") {
          return { body: searchPage([searchFile()]) };
        }
        if (request.path === "/v1/drive/resources/file-1") {
          return { body: resourceDetail(6, remoteModifiedAt) };
        }
        if (request.path === "/v1/drive/files") {
          return {
            status: 201,
            body: { uploadUrl: `${server.baseUrl}/storage/upload`, offset: 0 },
          };
        }
        if (request.path === "/storage/upload") {
          return { body: { resourceId: "file-1", name: "report.txt", fileSize: 6 } };
        }
        return { status: 500, body: { code: "UNEXPECTED", message: "unexpected request" } };
      },
    });
    servers.push(server);

    const conflict = await runCli(["put", local.path, "/report.txt", "--json"], server.baseUrl);
    expect(conflict.exitCode).toBe(5);
    expect(conflict.stderr).toBe("");
    expect(JSON.parse(conflict.stdout)).toMatchObject({
      ok: false,
      command: "put",
      error: { kind: "conflict", code: "REMOTE_NEWER" },
    });
    expect(server.requests.filter((request) => request.method === "POST")).toHaveLength(0);

    const forced = await runCli(
      ["put", local.path, "/report.txt", "--force", "--json"],
      server.baseUrl,
    );
    expect(forced.exitCode).toBe(0);
    expect(forced.stderr).toBe("");
    expect(JSON.parse(forced.stdout)).toMatchObject({
      ok: true,
      command: "put",
      action: "overwritten",
      data: { reason: "forced" },
    });
  });
});

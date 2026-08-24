import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runPut } from "../../src/features/put/command.ts";
import { MyboxClient } from "../../src/mybox/client.ts";
import { MyboxUploader } from "../../src/mybox/upload.ts";
import { RemoteResolver } from "../../src/remote/resolver.ts";
import { createFakeHttpServer, type FakeHttpServer, type RecordedRequest } from "./server.ts";

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

async function localFile(contents = "abcdef") {
  const directory = await mkdtemp(join(tmpdir(), "myboxctl-put-test-"));
  directories.push(directory);
  const path = join(directory, "report.txt");
  await writeFile(path, contents);
  const timestamp = new Date("2026-08-23T10:00:00Z");
  await utimes(path, timestamp, timestamp);
  return { path, stats: await stat(path) };
}

function dependencies(server: FakeHttpServer) {
  const client = new MyboxClient({ pat: "test-pat", baseUrl: server.baseUrl, timeoutMs: 5_000 });
  return {
    client,
    resolver: new RemoteResolver(client),
    uploader: new MyboxUploader(),
    timeoutMs: 5_000,
  };
}

describe("put HTTP operation", () => {
  test("skips matching metadata without a mutation", async () => {
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

    const result = await runPut(local.path, "/report.txt", {}, dependencies(server));

    expect(result).toEqual({
      action: "skipped",
      data: {
        path: "/report.txt",
        resourceId: "file-1",
        size: 6,
        modifiedAt,
        reason: "remote-is-current",
      },
    });
    expect(server.requests.filter((request) => request.method === "POST")).toHaveLength(0);
  });

  test("rejects a newer remote file without a mutation", async () => {
    const local = await localFile();
    const remoteModifiedAt = new Date(local.stats.mtimeMs + 2_001).toISOString();
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
          return { body: resourceDetail(99, remoteModifiedAt) };
        }
        return { status: 500, body: { code: "UNEXPECTED", message: "unexpected request" } };
      },
    });
    servers.push(server);

    await expect(runPut(local.path, "/report.txt", {}, dependencies(server))).rejects.toMatchObject(
      { kind: "conflict", code: "REMOTE_NEWER" },
    );
    expect(server.requests.filter((request) => request.method === "POST")).toHaveLength(0);
  });

  test("uploads an absent target through the Phase 04 uploader", async () => {
    const local = await localFile();
    const modifiedAt = "2026-08-23T10:00:01Z";
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
          return { body: { resourceId: "file-1", name: "report.txt", fileSize: 6 } };
        }
        if (request.path === "/v1/drive/resources/file-1") {
          return { body: resourceDetail(6, modifiedAt) };
        }
        return { status: 500, body: { code: "UNEXPECTED", message: "unexpected request" } };
      },
    });
    servers.push(server);

    const result = await runPut(local.path, "/report.txt", {}, dependencies(server));

    expect(result).toMatchObject({
      action: "uploaded",
      data: { path: "/report.txt", size: 6, reason: "remote-absent" },
    });
    expect(server.requests.filter((request) => request.path === "/v1/drive/files")).toHaveLength(1);
    expect(server.requests.filter((request) => request.path === "/storage/upload")).toHaveLength(1);
  });

  test("rejects an absent oversized target before upload mutation", async () => {
    const local = await localFile();
    const server = await createFakeHttpServer({
      handler: (request: RecordedRequest) => {
        if (request.path === "/v1/drive/storage") {
          return { body: storageResponse(5) };
        }
        if (request.path.startsWith("/v1/search/resources/")) {
          return { body: searchPage() };
        }
        return { status: 500, body: { code: "UNEXPECTED", message: "unexpected request" } };
      },
    });
    servers.push(server);

    await expect(runPut(local.path, "/report.txt", {}, dependencies(server))).rejects.toMatchObject({
      kind: "invalid-arguments",
      code: "FILE_TOO_LARGE",
    });
    expect(server.requests.filter((request) => request.method === "POST")).toHaveLength(0);
    expect(server.requests.filter((request) => request.path === "/v1/drive/storage")).toHaveLength(1);
  });

  test("force overwrites a newer remote file", async () => {
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

    const result = await runPut(local.path, "/report.txt", { force: true }, dependencies(server));

    expect(result).toMatchObject({ action: "overwritten", data: { reason: "forced" } });
    const reservation = server.requests.find((request) => request.path === "/v1/drive/files");
    expect(JSON.parse(reservation?.bodyText ?? "{}").isOverwrite).toBe(true);
  });
});

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runUpload } from "../../src/features/upload.ts";
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

function resourceDetail(name: string, size: number) {
  return {
    resourceId: "file-1",
    parentId: "parent-1",
    name,
    type: "file",
    size,
    createdAt: "2026-08-23T10:00:00Z",
    modifiedAt: "2026-08-23T10:00:01Z",
    accessedAt: "2026-08-23T10:00:01Z",
    isFavorite: false,
    isHidden: false,
    lastModifiedBy: "tester",
  };
}

async function localFile(contents = "abcdef"): Promise<{ directory: string; path: string }> {
  const directory = await mkdtemp(join(tmpdir(), "myboxctl-upload-test-"));
  directories.push(directory);
  const path = join(directory, "report.txt");
  await writeFile(path, contents);
  return { directory, path };
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

describe("MYBOX upload content", () => {
  test("streams only the remaining bytes with the verified resume Content-Range", async () => {
    const local = await localFile();
    const server = await createFakeHttpServer([
      { body: { resourceId: "file-1", name: "report.txt", fileSize: 6 } },
    ]);
    servers.push(server);
    const handle = await open(local.path, "r");
    try {
      const result = await new MyboxUploader().uploadContent({
        uploadUrl: `${server.baseUrl}/storage/upload?stoken=secret`,
        fileHandle: handle,
        fileName: "report.txt",
        fileSize: 6,
        offset: 2,
        resume: true,
        signal: AbortSignal.timeout(5_000),
      });

      expect(result).toEqual({ resourceId: "file-1", name: "report.txt", fileSize: 6 });
      expect(server.requests[0]?.headers["content-range"]).toBe("2-5/6");
      expect(server.requests[0]?.headers.authorization).toBeUndefined();
      expect(server.requests[0]?.bodyText).toContain("cdef\r\n--");
      expect(server.requests[0]?.bodyText).not.toContain("abcdef");
    } finally {
      await handle.close();
    }
  });

  test("maps a signed storage failure without exposing its URL", async () => {
    const local = await localFile();
    const server = await createFakeHttpServer([
      { status: 503, body: { code: "STORAGE_BUSY", message: "busy" } },
    ]);
    servers.push(server);
    const handle = await open(local.path, "r");
    try {
      const uploadUrl = `${server.baseUrl}/storage/upload?stoken=secret`;
      let failure: unknown;
      try {
        await new MyboxUploader().uploadContent({
          uploadUrl,
          fileHandle: handle,
          fileName: "report.txt",
          fileSize: 6,
          offset: 0,
          resume: false,
          signal: AbortSignal.timeout(5_000),
        });
      } catch (error) {
        failure = error;
      }

      expect(failure).toMatchObject({ kind: "api-unavailable", retryable: true, status: 503 });
      expect(String(failure)).not.toContain(uploadUrl);
      expect(String(failure)).not.toContain("stoken");
    } finally {
      await handle.close();
    }
  });

  test("uploads an empty file without an invalid Content-Range", async () => {
    const local = await localFile("");
    const server = await createFakeHttpServer([
      { body: { resourceId: "file-1", name: "report.txt", fileSize: 0 } },
    ]);
    servers.push(server);
    const handle = await open(local.path, "r");
    try {
      await new MyboxUploader().uploadContent({
        uploadUrl: `${server.baseUrl}/storage/upload`,
        fileHandle: handle,
        fileName: "report.txt",
        fileSize: 0,
        offset: 0,
        resume: true,
        signal: AbortSignal.timeout(5_000),
      });

      expect(server.requests[0]?.headers["content-range"]).toBeUndefined();
      expect(server.requests[0]?.bodyText).toContain('filename="report.txt"');
    } finally {
      await handle.close();
    }
  });
});

describe("upload HTTP operation", () => {
  test("restarts once from offset zero after the first content failure", async () => {
    const local = await localFile();
    let reservationCount = 0;
    let storageCount = 0;
    const server = await createFakeHttpServer({
      handler: (request: RecordedRequest) => {
        if (request.path === "/v1/search/resources/folders") {
          return { body: searchPage() };
        }
        if (request.path === "/v1/search/resources/files") {
          return { body: searchPage() };
        }
        if (request.path === "/v1/drive/files") {
          reservationCount += 1;
          return {
            status: 201,
            body: { uploadUrl: `${server.baseUrl}/storage/upload`, offset: 0 },
          };
        }
        if (request.path === "/storage/upload") {
          storageCount += 1;
          return storageCount === 1
            ? { status: 503, body: { code: "STORAGE_BUSY", message: "busy" } }
            : { body: { resourceId: "file-1", name: "report.txt", fileSize: 6 } };
        }
        if (request.path === "/v1/drive/resources/file-1") {
          return { body: resourceDetail("report.txt", 6) };
        }
        return { status: 500, body: { code: "UNEXPECTED", message: "unexpected request" } };
      },
    });
    servers.push(server);

    const result = await runUpload(local.path, "/report.txt", {}, dependencies(server));

    expect(result).toEqual({
      action: "uploaded",
      data: {
        path: "/report.txt",
        resourceId: "file-1",
        size: 6,
        modifiedAt: "2026-08-23T10:00:01Z",
      },
    });
    expect(reservationCount).toBe(2);
    expect(storageCount).toBe(2);
    const reservations = server.requests.filter((request) => request.path === "/v1/drive/files");
    expect(JSON.parse(reservations[0]?.bodyText ?? "{}")).toEqual(
      JSON.parse(reservations[1]?.bodyText ?? "{}"),
    );
    const storage = server.requests.filter((request) => request.path === "/storage/upload");
    expect(storage[0]?.headers["content-range"]).toBeUndefined();
    expect(storage[1]?.headers["content-range"]).toBe("0-5/6");
    expect(storage[1]?.bodyText).toContain("abcdef\r\n--");
  });

  test("does not attempt a third transfer when restart-from-zero fails", async () => {
    const local = await localFile();
    let reservationCount = 0;
    let storageCount = 0;
    const server = await createFakeHttpServer({
      handler: (request: RecordedRequest) => {
        if (request.path.startsWith("/v1/search/resources/")) {
          return { body: searchPage() };
        }
        if (request.path === "/v1/drive/files") {
          reservationCount += 1;
          return {
            status: 201,
            body: { uploadUrl: `${server.baseUrl}/storage/upload`, offset: 0 },
          };
        }
        if (request.path === "/storage/upload") {
          storageCount += 1;
          return { status: 503, body: { code: "STORAGE_BUSY", message: "busy" } };
        }
        return { status: 500, body: { code: "UNEXPECTED", message: "unexpected request" } };
      },
    });
    servers.push(server);

    await expect(
      runUpload(local.path, "/report.txt", {}, dependencies(server)),
    ).rejects.toMatchObject({
      kind: "api-unavailable",
      retryable: true,
      status: 503,
    });
    expect(reservationCount).toBe(2);
    expect(storageCount).toBe(2);
  });

  test("continues from a non-zero server offset when one is available", async () => {
    const local = await localFile();
    let reservationCount = 0;
    let storageCount = 0;
    const server = await createFakeHttpServer({
      handler: (request: RecordedRequest) => {
        if (request.path.startsWith("/v1/search/resources/")) {
          return { body: searchPage() };
        }
        if (request.path === "/v1/drive/files") {
          reservationCount += 1;
          return {
            status: 201,
            body: {
              uploadUrl: `${server.baseUrl}/storage/upload`,
              offset: reservationCount === 1 ? 0 : 2,
            },
          };
        }
        if (request.path === "/storage/upload") {
          storageCount += 1;
          return storageCount === 1
            ? { status: 503, body: { code: "STORAGE_BUSY", message: "busy" } }
            : { body: { resourceId: "file-1", name: "report.txt", fileSize: 6 } };
        }
        if (request.path === "/v1/drive/resources/file-1") {
          return { body: resourceDetail("report.txt", 6) };
        }
        return { status: 500, body: { code: "UNEXPECTED", message: "unexpected request" } };
      },
    });
    servers.push(server);

    await runUpload(local.path, "/report.txt", {}, dependencies(server));

    const storage = server.requests.filter((request) => request.path === "/storage/upload");
    expect(storage[1]?.headers["content-range"]).toBe("2-5/6");
    expect(storage[1]?.bodyText).toContain("cdef\r\n--");
    expect(storage[1]?.bodyText).not.toContain("abcdef");
  });

  test("rejects an existing target unless overwrite is explicit", async () => {
    const local = await localFile();
    const server = await createFakeHttpServer({
      handler: (request: RecordedRequest) => {
        if (request.path === "/v1/search/resources/folders") {
          return { body: searchPage() };
        }
        if (request.path === "/v1/search/resources/files") {
          return {
            body: searchPage([
              {
                resourceId: "file-1",
                name: "report.txt",
                type: "file",
                path: "/report.txt",
                parentPath: "/",
              },
            ]),
          };
        }
        return { status: 500, body: { code: "UNEXPECTED", message: "unexpected request" } };
      },
    });
    servers.push(server);

    await expect(
      runUpload(local.path, "/report.txt", {}, dependencies(server)),
    ).rejects.toMatchObject({ kind: "conflict" });
    expect(server.requests.filter((request) => request.method === "POST")).toHaveLength(0);
  });

  test("overwrites an existing file only when explicitly requested", async () => {
    const local = await localFile();
    const server = await createFakeHttpServer({
      handler: (request: RecordedRequest) => {
        if (request.path === "/v1/search/resources/folders") {
          return { body: searchPage() };
        }
        if (request.path === "/v1/search/resources/files") {
          return {
            body: searchPage([
              {
                resourceId: "file-1",
                name: "report.txt",
                type: "file",
                path: "/report.txt",
                parentPath: "/",
              },
            ]),
          };
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
          return { body: resourceDetail("report.txt", 6) };
        }
        return { status: 500, body: { code: "UNEXPECTED", message: "unexpected request" } };
      },
    });
    servers.push(server);

    const result = await runUpload(
      local.path,
      "/report.txt",
      { overwrite: true },
      dependencies(server),
    );

    expect(result.action).toBe("overwritten");
    const reservation = server.requests.find((request) => request.path === "/v1/drive/files");
    expect(JSON.parse(reservation?.bodyText ?? "{}").isOverwrite).toBe(true);
  });

  test("creates a missing parent when mkdir is explicit", async () => {
    const local = await localFile();
    const server = await createFakeHttpServer({
      handler: (request: RecordedRequest) => {
        if (request.path.startsWith("/v1/search/resources/")) {
          return { body: searchPage() };
        }
        if (request.path === "/v1/drive/folders") {
          return { status: 201, body: { resourceId: "parent-1", name: "new" } };
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
          return { body: resourceDetail("report.txt", 6) };
        }
        return { status: 500, body: { code: "UNEXPECTED", message: "unexpected request" } };
      },
    });
    servers.push(server);

    const result = await runUpload(
      local.path,
      "/new/report.txt",
      { mkdir: true },
      dependencies(server),
    );

    expect(result.data.path).toBe("/new/report.txt");
    const reservation = server.requests.find((request) => request.path === "/v1/drive/files");
    expect(JSON.parse(reservation?.bodyText ?? "{}").parentId).toBe("parent-1");
  });

  test("fails local-file-changed after a successful remote upload", async () => {
    const local = await localFile();
    const server = await createFakeHttpServer({
      handler: async (request: RecordedRequest) => {
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
          await writeFile(local.path, "changed-size");
          return { body: { resourceId: "file-1", name: "report.txt", fileSize: 6 } };
        }
        if (request.path === "/v1/drive/resources/file-1") {
          return { body: resourceDetail("report.txt", 6) };
        }
        return { status: 500, body: { code: "UNEXPECTED", message: "unexpected request" } };
      },
    });
    servers.push(server);

    await expect(
      runUpload(local.path, "/report.txt", {}, dependencies(server)),
    ).rejects.toMatchObject({ kind: "local-file-changed" });
  });
});

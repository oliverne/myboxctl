import { afterEach, describe, expect, test } from "bun:test";

import { DomainError } from "../../src/errors.ts";
import { MyboxClient } from "../../src/mybox/client.ts";
import { createFakeHttpServer, type FakeHttpServer } from "./server.ts";

type TestResource = {
  resourceId: string;
  name: string;
  type: string;
};

function listPage(resources: TestResource[], nextCursor?: string) {
  const completeResources = resources.map((resource) => ({
    parentId: "parent-1",
    size: 0,
    createdAt: "2026-08-22T10:00:00Z",
    modifiedAt: "2026-08-22T10:00:00Z",
    accessedAt: "2026-08-22T10:00:00Z",
    isFavorite: false,
    isHidden: false,
    lastModifiedBy: "tester",
    ...resource,
  }));
  return {
    resources: completeResources,
    responseMetaData: nextCursor === undefined ? {} : { nextCursor },
    fileCount: resources.filter((resource) => resource.type === "file").length,
    subFolderCount: resources.filter((resource) => resource.type === "folder").length,
  };
}

const servers: FakeHttpServer[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.close();
  }
});

describe("MyboxClient transport", () => {
  test("encodes query values, sends Bearer auth, and retries GET only", async () => {
    const server = await createFakeHttpServer([
      { status: 503, body: { code: "PLAT-503", message: "temporary" } },
      {
        status: 429,
        headers: { "Retry-After": "45" },
        body: { code: "PLAT-429", message: "slow down" },
      },
      {
        body: listPage([{ resourceId: "folder-1", name: "한글 폴더", type: "folder" }], "cursor 2"),
      },
      { body: listPage([{ resourceId: "file-1", name: "report #1.txt", type: "file" }]) },
    ]);
    servers.push(server);
    const sleeps: number[] = [];
    const client = new MyboxClient(
      { pat: "raw-pat", baseUrl: server.baseUrl, timeoutMs: 5_000 },
      {
        sleep: async (ms) => {
          sleeps.push(ms);
        },
        random: () => 0,
      },
    );

    const resources = await client.listRoot({ count: 1 });

    expect(resources.map((resource) => resource.resourceId)).toEqual(["folder-1", "file-1"]);
    expect(sleeps).toEqual([500, 45_000]);
    expect(server.requests).toHaveLength(4);
    expect(server.requests[0]?.method).toBe("GET");
    expect(server.requests[0]?.query.get("count")).toBe("1");
    expect(server.requests[0]?.query.has("cursor")).toBe(false);
    expect(server.requests[0]?.headers.authorization).toBe("Bearer raw-pat");
    expect(server.requests[3]?.query.get("cursor")).toBe("cursor 2");
  });

  test("lists a nested folder through the documented direct-children endpoint", async () => {
    const server = await createFakeHttpServer([
      { body: listPage([{ resourceId: "child-file", name: "report.txt", type: "file" }]) },
    ]);
    servers.push(server);
    const client = new MyboxClient({ pat: "token", baseUrl: server.baseUrl, timeoutMs: 5_000 });

    const resources = await client.listFolder("folder /한글", { sort: "name,asc" });

    expect(resources.map((resource) => resource.resourceId)).toEqual(["child-file"]);
    expect(server.requests[0]?.path).toBe(
      "/v1/drive/folders/folder%20%2F%ED%95%9C%EA%B8%80/resources",
    );
    expect(server.requests[0]?.query.get("count")).toBe("1000");
    expect(server.requests[0]?.query.get("sort")).toBe("name,asc");
  });

  test("paginates direct-folder children and preserves the cursor query", async () => {
    const server = await createFakeHttpServer([
      { body: listPage([{ resourceId: "folder-1", name: "one", type: "folder" }], "child-next") },
      { body: listPage([{ resourceId: "file-2", name: "two.txt", type: "file" }]) },
    ]);
    servers.push(server);
    const client = new MyboxClient({ pat: "token", baseUrl: server.baseUrl, timeoutMs: 5_000 });

    const resources = await client.listFolder("folder-1");

    expect(resources.map((resource) => resource.resourceId)).toEqual(["folder-1", "file-2"]);
    expect(server.requests[1]?.query.get("cursor")).toBe("child-next");
  });

  test("does not retry mutations", async () => {
    const server = await createFakeHttpServer([
      { status: 503, body: { code: "PLAT-503", message: "temporary" } },
    ]);
    servers.push(server);
    const sleeps: number[] = [];
    const client = new MyboxClient(
      { pat: "token", baseUrl: server.baseUrl, timeoutMs: 5_000 },
      {
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      },
    );

    await expect(client.createFolder({ folderName: "reports" })).rejects.toMatchObject({
      kind: "api-unavailable",
      code: "PLAT-503",
    });
    expect(server.requests).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  test("waits one conservative window and retries a GET 429 only once without Retry-After", async () => {
    const server = await createFakeHttpServer([
      { status: 429, body: { code: "PLAT-429", message: "slow down" } },
      { status: 429, body: { code: "PLAT-429", message: "still limited" } },
      { body: listPage([]) },
    ]);
    servers.push(server);
    const sleeps: number[] = [];
    const client = new MyboxClient(
      { pat: "token", baseUrl: server.baseUrl, timeoutMs: 5_000 },
      {
        sleep: async (ms) => {
          sleeps.push(ms);
        },
        random: () => 0,
      },
    );

    await expect(client.listRootPage()).rejects.toMatchObject({
      kind: "rate-limit",
      retryable: true,
      retryAfterMs: 60_000,
    });
    expect(server.requests).toHaveLength(2);
    expect(sleeps).toEqual([60_000]);
  });

  test("preserves a local rate-limit state failure instead of retrying it as a network error", async () => {
    const server = await createFakeHttpServer();
    servers.push(server);
    const client = new MyboxClient(
      { pat: "token", baseUrl: server.baseUrl, timeoutMs: 5_000 },
      {
        rateLimiter: {
          beforeRequest: async () => {
            throw new DomainError("api-unavailable", "rate state failed", {
              code: "RATE_LIMIT_STATE_UNAVAILABLE",
              retryable: true,
            });
          },
          recordResponse: async () => undefined,
        },
      },
    );

    await expect(client.listRootPage()).rejects.toMatchObject({
      kind: "api-unavailable",
      code: "RATE_LIMIT_STATE_UNAVAILABLE",
    });
    expect(server.requests).toHaveLength(0);
  });

  test("maps a schema mismatch to api-unavailable without raw Zod details", async () => {
    const server = await createFakeHttpServer([{ body: { resources: [] } }]);
    servers.push(server);
    const client = new MyboxClient({ pat: "token", baseUrl: server.baseUrl, timeoutMs: 5_000 });

    await expect(client.listRootPage()).rejects.toMatchObject({
      kind: "api-unavailable",
      code: "API_RESPONSE_INVALID",
    });
  });

  test("detects repeated cursors", async () => {
    const server = await createFakeHttpServer([
      { body: listPage([], "same") },
      { body: listPage([], "same") },
    ]);
    servers.push(server);
    const client = new MyboxClient({ pat: "token", baseUrl: server.baseUrl, timeoutMs: 5_000 });

    await expect(client.listRoot()).rejects.toMatchObject({
      kind: "api-unavailable",
      message: "MYBOX returned a repeated pagination cursor.",
    });
    expect(server.requests).toHaveLength(2);
  });

  test("validates mutation response contracts and request body", async () => {
    const server = await createFakeHttpServer([
      { body: { name: "reports", resourceId: "folder-1", extra: true }, status: 201 },
      { body: { uploadUrl: "https://upload.example.test/storage", offset: 0 }, status: 201 },
    ]);
    servers.push(server);
    const client = new MyboxClient({ pat: "token", baseUrl: server.baseUrl, timeoutMs: 5_000 });

    await expect(
      client.createFolder({ folderName: "reports", parentId: "root" }),
    ).resolves.toMatchObject({
      resourceId: "folder-1",
    });
    await expect(
      client.createUpload({
        fileName: "report.md",
        fileSize: 12,
        parentId: "folder-1",
        isOverwrite: true,
        resume: true,
        modifiedTime: "2026-08-22T10:00:00Z",
      }),
    ).resolves.toMatchObject({ offset: 0 });

    expect(JSON.parse(server.requests[0]?.bodyText ?? "{}")).toEqual({
      folderName: "reports",
      parentId: "root",
    });
    expect(JSON.parse(server.requests[1]?.bodyText ?? "{}")).toEqual({
      fileName: "report.md",
      fileSize: 12,
      parentId: "folder-1",
      isOverwrite: true,
      resume: true,
      modifiedTime: "2026-08-22T10:00:00Z",
    });
  });
});

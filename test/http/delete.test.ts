import { afterEach, describe, expect, test } from "bun:test";

import { runDelete } from "../../src/features/delete.ts";
import { MyboxClient } from "../../src/mybox/client.ts";
import { RemoteResolver } from "../../src/remote/resolver.ts";
import { createFakeHttpServer, type FakeHttpServer, type RecordedRequest } from "./server.ts";

const servers: FakeHttpServer[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.close();
  }
});

function searchPage(resources: unknown[] = []) {
  return { resources, responseMetaData: {} };
}

function listPage(resources: unknown[] = []) {
  return {
    resources,
    responseMetaData: {},
    fileCount: resources.length,
    subFolderCount: 0,
  };
}

function searchResource(type: "file" | "folder" = "file") {
  return {
    resourceId: "resource-1",
    name: type === "file" ? "report.txt" : "reports",
    type,
    path: type === "file" ? "/report.txt" : "/reports",
    parentPath: "/",
  };
}

function resourceDetail(type: "file" | "folder" = "file") {
  return {
    resourceId: "resource-1",
    parentId: "parent-1",
    name: type === "file" ? "report.txt" : "reports",
    type,
    size: 6,
    createdAt: "2026-08-23T10:00:00Z",
    modifiedAt: "2026-08-23T10:00:01Z",
    accessedAt: "2026-08-23T10:00:01Z",
    isFavorite: false,
    isHidden: false,
    lastModifiedBy: "tester",
  };
}

function dependencies(server: FakeHttpServer) {
  const client = new MyboxClient({ pat: "test-pat", baseUrl: server.baseUrl, timeoutMs: 5_000 });
  return { client, resolver: new RemoteResolver(client) };
}

function foundHandler(
  deleteResponses: Array<{ status: number; headers?: Record<string, string>; body?: unknown }>,
  detailResponse?: { status: number; body?: unknown },
) {
  let deleteIndex = 0;
  let fileSearchCount = 0;
  const originalIsInactive = detailResponse?.status === 404;
  return (request: RecordedRequest) => {
    if (request.path === "/v1/search/resources/folders") {
      return { body: searchPage() };
    }
    if (request.path === "/v1/search/resources/files") {
      fileSearchCount += 1;
      return {
        body: searchPage(originalIsInactive && fileSearchCount > 1 ? [] : [searchResource()]),
      };
    }
    if (request.path === "/v1/drive/resources") {
      return {
        body: listPage(originalIsInactive ? [] : [{ ...resourceDetail(), path: "/report.txt" }]),
      };
    }
    if (request.path === "/v1/drive/resources/resource-1" && request.method === "DELETE") {
      const response = deleteResponses[deleteIndex];
      deleteIndex += 1;
      return response ?? { status: 500, body: { code: "UNEXPECTED", message: "extra delete" } };
    }
    if (request.path === "/v1/drive/resources/resource-1" && request.method === "GET") {
      return detailResponse ?? { body: resourceDetail() };
    }
    return {
      status: 500,
      body: { code: "UNEXPECTED", message: "unexpected request" },
    };
  };
}

describe("delete HTTP operation", () => {
  test("deletes the exact resolved resource ID", async () => {
    const server = await createFakeHttpServer({ handler: foundHandler([{ status: 204 }]) });
    servers.push(server);

    const result = await runDelete("/report.txt", {}, dependencies(server));

    expect(result).toEqual({
      action: "deleted",
      data: { path: "/report.txt", resourceId: "resource-1", type: "file" },
    });
    expect(
      server.requests.filter(
        (request) =>
          request.method === "DELETE" && request.path === "/v1/drive/resources/resource-1",
      ),
    ).toHaveLength(1);
  });

  test("fails missing by default and supports ignore-missing", async () => {
    const server = await createFakeHttpServer({
      handler: (request: RecordedRequest) => {
        if (request.path.startsWith("/v1/search/resources/")) {
          return { body: searchPage() };
        }
        return { status: 500, body: { code: "UNEXPECTED", message: "unexpected mutation" } };
      },
    });
    servers.push(server);

    await expect(runDelete("/missing.txt", {}, dependencies(server))).rejects.toMatchObject({
      kind: "not-found",
    });
    await expect(
      runDelete("/missing.txt", { ignoreMissing: true }, dependencies(server)),
    ).resolves.toEqual({ action: "already-absent", data: { path: "/missing.txt" } });
    expect(server.requests.filter((request) => request.method === "DELETE")).toHaveLength(0);
  });

  test("rejects the root without an API request", async () => {
    const server = await createFakeHttpServer();
    servers.push(server);

    await expect(runDelete("/", {}, dependencies(server))).rejects.toMatchObject({
      kind: "invalid-arguments",
    });
    expect(server.requests).toHaveLength(0);
  });

  test("maps DELETE 404 by ignore-missing mode", async () => {
    const response = { status: 404, body: { code: "NOT_FOUND", message: "gone" } };
    const server = await createFakeHttpServer({ handler: foundHandler([response, response]) });
    servers.push(server);

    await expect(runDelete("/report.txt", {}, dependencies(server))).rejects.toMatchObject({
      kind: "not-found",
    });
    await expect(
      runDelete("/report.txt", { ignoreMissing: true }, dependencies(server)),
    ).resolves.toEqual({ action: "already-absent", data: { path: "/report.txt" } });
  });

  test("reconciles a retryable ambiguous failure only by the original ID", async () => {
    const server = await createFakeHttpServer({
      handler: foundHandler([{ status: 503, body: { code: "BUSY", message: "unknown outcome" } }], {
        status: 404,
        body: { code: "NOT_FOUND", message: "gone" },
      }),
    });
    servers.push(server);

    await expect(runDelete("/report.txt", {}, dependencies(server))).resolves.toEqual({
      action: "deleted",
      data: { path: "/report.txt", resourceId: "resource-1", type: "file" },
    });
    expect(server.requests.filter((request) => request.method === "DELETE")).toHaveLength(1);
    expect(server.requests.filter((request) => request.path.includes("/v1/search/"))).toHaveLength(
      4,
    );
    expect(server.requests.some((request) => request.path === "/v1/drive/resources")).toBe(true);
  });

  test("treats trash-visible detail as deleted when active path and parent listing omit the ID", async () => {
    let fileSearchCount = 0;
    const server = await createFakeHttpServer({
      handler: (request: RecordedRequest) => {
        if (request.path === "/v1/search/resources/folders") {
          return { body: searchPage() };
        }
        if (request.path === "/v1/search/resources/files") {
          fileSearchCount += 1;
          return { body: searchPage(fileSearchCount === 1 ? [searchResource()] : []) };
        }
        if (request.path === "/v1/drive/resources") {
          return { body: listPage() };
        }
        if (request.path === "/v1/drive/resources/resource-1" && request.method === "DELETE") {
          return { status: 503, body: { code: "BUSY", message: "unknown outcome" } };
        }
        if (request.path === "/v1/drive/resources/resource-1" && request.method === "GET") {
          return { body: resourceDetail() };
        }
        return { status: 500, body: { code: "UNEXPECTED", message: "unexpected request" } };
      },
    });
    servers.push(server);

    await expect(runDelete("/report.txt", {}, dependencies(server))).resolves.toMatchObject({
      action: "deleted",
      data: { resourceId: "resource-1" },
    });
    expect(server.requests.filter((request) => request.method === "DELETE")).toHaveLength(1);
    expect(server.requests.filter((request) => request.method === "GET")).not.toContainEqual(
      expect.objectContaining({ path: "/v1/drive/resources/resource-1" }),
    );
  });

  test("fails conservatively when the parent listing still contains the original ID", async () => {
    let fileSearchCount = 0;
    const server = await createFakeHttpServer({
      handler: (request: RecordedRequest) => {
        if (request.path === "/v1/search/resources/folders") {
          return { body: searchPage() };
        }
        if (request.path === "/v1/search/resources/files") {
          fileSearchCount += 1;
          return { body: searchPage(fileSearchCount === 1 ? [searchResource()] : []) };
        }
        if (request.path === "/v1/drive/resources") {
          return { body: listPage([{ ...resourceDetail(), path: "/report.txt" }]) };
        }
        if (request.path === "/v1/drive/resources/resource-1" && request.method === "DELETE") {
          return { status: 503, body: { code: "BUSY", message: "unknown outcome" } };
        }
        return { status: 500, body: { code: "UNEXPECTED", message: "unexpected request" } };
      },
    });
    servers.push(server);

    await expect(runDelete("/report.txt", {}, dependencies(server))).rejects.toMatchObject({
      kind: "api-unavailable",
      status: 503,
    });
    expect(server.requests.filter((request) => request.method === "DELETE")).toHaveLength(1);
  });

  test("never deletes a same-path replacement while reconciling the original ID", async () => {
    let deleted = false;
    const replacement = { ...searchResource(), resourceId: "resource-2" };
    const server = await createFakeHttpServer({
      handler: (request: RecordedRequest) => {
        if (request.path === "/v1/search/resources/folders") {
          return { body: searchPage() };
        }
        if (request.path === "/v1/search/resources/files") {
          return { body: searchPage([deleted ? replacement : searchResource()]) };
        }
        if (request.path === "/v1/drive/resources") {
          return { body: listPage([{ ...resourceDetail(), ...replacement }]) };
        }
        if (request.path === "/v1/drive/resources/resource-1" && request.method === "DELETE") {
          deleted = true;
          return { status: 503, body: { code: "BUSY", message: "unknown outcome" } };
        }
        return { status: 500, body: { code: "UNEXPECTED", message: "unexpected request" } };
      },
    });
    servers.push(server);

    await expect(runDelete("/report.txt", {}, dependencies(server))).resolves.toMatchObject({
      action: "deleted",
      data: { resourceId: "resource-1" },
    });
    const deletes = server.requests.filter((request) => request.method === "DELETE");
    expect(deletes).toHaveLength(1);
    expect(deletes[0]?.path).toBe("/v1/drive/resources/resource-1");
  });

  test("does not repeat DELETE after a 5xx when the same ID remains", async () => {
    const server = await createFakeHttpServer({
      handler: foundHandler([{ status: 503, body: { code: "BUSY", message: "unknown outcome" } }]),
    });
    servers.push(server);

    await expect(runDelete("/report.txt", {}, dependencies(server))).rejects.toMatchObject({
      kind: "api-unavailable",
      status: 503,
    });
    expect(server.requests.filter((request) => request.method === "DELETE")).toHaveLength(1);
  });

  test("reconciles a 429 to success when the original ID is gone", async () => {
    const server = await createFakeHttpServer({
      handler: foundHandler(
        [
          {
            status: 429,
            headers: { "Retry-After": "0" },
            body: { code: "PLAT-429", message: "limited" },
          },
        ],
        { status: 404, body: { code: "NOT_FOUND", message: "gone" } },
      ),
    });
    servers.push(server);

    await expect(runDelete("/report.txt", {}, dependencies(server))).resolves.toMatchObject({
      action: "deleted",
    });
    expect(server.requests.filter((request) => request.method === "DELETE")).toHaveLength(1);
  });

  test("retries one DELETE with the same ID after a 429 when it remains", async () => {
    const server = await createFakeHttpServer({
      handler: foundHandler([
        {
          status: 429,
          headers: { "Retry-After": "0" },
          body: { code: "PLAT-429", message: "limited" },
        },
        { status: 204 },
      ]),
    });
    servers.push(server);

    await expect(runDelete("/report.txt", {}, dependencies(server))).resolves.toMatchObject({
      action: "deleted",
    });
    const deletes = server.requests.filter((request) => request.method === "DELETE");
    expect(deletes).toHaveLength(2);
    expect(new Set(deletes.map((request) => request.path))).toEqual(
      new Set(["/v1/drive/resources/resource-1"]),
    );
  });

  test("returns the second 429 without a third DELETE", async () => {
    const limited = {
      status: 429,
      headers: { "Retry-After": "0" },
      body: { code: "PLAT-429", message: "limited" },
    };
    const server = await createFakeHttpServer({ handler: foundHandler([limited, limited]) });
    servers.push(server);

    await expect(runDelete("/report.txt", {}, dependencies(server))).rejects.toMatchObject({
      kind: "rate-limit",
      retryAfterMs: 0,
    });
    expect(server.requests.filter((request) => request.method === "DELETE")).toHaveLength(2);
  });
});

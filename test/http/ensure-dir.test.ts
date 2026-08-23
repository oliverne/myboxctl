import { afterEach, describe, expect, test } from "bun:test";

import { runEnsureDir } from "../../src/features/ensure-dir.ts";
import { MyboxClient } from "../../src/mybox/client.ts";
import { RemoteResolver } from "../../src/remote/resolver.ts";
import { createFakeHttpServer, type FakeHttpServer, type RecordedRequest } from "./server.ts";

type SearchResource = {
  resourceId: string;
  name: string;
  type: "file" | "folder";
  path?: string;
  parentPath?: string;
};

function searchPage(resources: SearchResource[] = []) {
  return { body: { resources, responseMetaData: {} } };
}

function folder(resourceId: string, path: string): SearchResource {
  return {
    resourceId,
    name: path.split("/").at(-1) ?? "",
    type: "folder",
    path,
  };
}

function file(resourceId: string, path: string): SearchResource {
  const parentPath = path.slice(0, path.lastIndexOf("/")) || "/";
  return {
    resourceId,
    name: path.split("/").at(-1) ?? "",
    type: "file",
    path,
    parentPath,
  };
}

const servers: FakeHttpServer[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.close();
  }
});

function resolverFor(
  server: FakeHttpServer,
  options: { timeoutMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): RemoteResolver {
  const client = new MyboxClient({
    pat: "test-pat",
    baseUrl: server.baseUrl,
    timeoutMs: options.timeoutMs ?? 5_000,
  });
  return new RemoteResolver(client, options.sleep === undefined ? {} : { sleep: options.sleep });
}

describe("ensure-dir HTTP operation", () => {
  test("returns existing without creating an already complete hierarchy", async () => {
    const server = await createFakeHttpServer([searchPage([folder("folder-b", "/a/b")])]);
    servers.push(server);

    const result = await runEnsureDir("/a/b", resolverFor(server));

    expect(result).toEqual({
      action: "existing",
      data: { path: "/a/b", resourceId: "folder-b", createdPaths: [] },
    });
    expect(server.requests.map((request) => request.method)).toEqual(["GET"]);
    expect(server.requests[0]?.path).toBe("/v1/search/resources/folders");
    expect(server.requests[0]?.query.get("path")).toBe("/a/b");
  });

  test("creates missing components from the root and passes each new id to its child", async () => {
    const server = await createFakeHttpServer([
      searchPage(),
      searchPage(),
      searchPage(),
      { status: 201, body: { name: "a", resourceId: "folder-a" } },
      searchPage(),
      { status: 201, body: { name: "b", resourceId: "folder-b" } },
    ]);
    servers.push(server);

    const result = await runEnsureDir("//a//b/", resolverFor(server));

    expect(result).toEqual({
      action: "created",
      data: { path: "/a/b", resourceId: "folder-b", createdPaths: ["/a", "/a/b"] },
    });
    expect(server.requests.filter((request) => request.method === "POST")).toHaveLength(2);
    expect(JSON.parse(server.requests[3]?.bodyText ?? "{}")).toEqual({ folderName: "a" });
    expect(JSON.parse(server.requests[5]?.bodyText ?? "{}")).toEqual({
      folderName: "b",
      parentId: "folder-a",
    });
  });

  test("creates only the missing leaf when its parent already exists", async () => {
    const server = await createFakeHttpServer([
      searchPage(),
      searchPage([folder("folder-a", "/a")]),
      searchPage(),
      { status: 201, body: { name: "b", resourceId: "folder-b" } },
    ]);
    servers.push(server);

    const result = await runEnsureDir("/a/b", resolverFor(server));

    expect(result).toEqual({
      action: "created",
      data: { path: "/a/b", resourceId: "folder-b", createdPaths: ["/a/b"] },
    });
    expect(JSON.parse(server.requests[3]?.bodyText ?? "{}")).toEqual({
      folderName: "b",
      parentId: "folder-a",
    });
  });

  test("returns a type conflict before creating a child below a file", async () => {
    const server = await createFakeHttpServer([
      searchPage(),
      searchPage(),
      searchPage([file("file-a", "/a")]),
    ]);
    servers.push(server);

    await expect(runEnsureDir("/a/b", resolverFor(server))).rejects.toMatchObject({
      kind: "conflict",
    });
    expect(server.requests.filter((request) => request.method === "POST")).toHaveLength(0);
  });

  test("reconciles a 409 with a folder found at the exact path without repeating POST", async () => {
    const server = await createFakeHttpServer([
      searchPage(),
      searchPage(),
      { status: 409, body: { code: "DUPLICATE", message: "already exists" } },
      searchPage([folder("folder-a", "/a")]),
    ]);
    servers.push(server);

    const result = await runEnsureDir("/a", resolverFor(server));

    expect(result).toEqual({
      action: "existing",
      data: { path: "/a", resourceId: "folder-a", createdPaths: [] },
    });
    expect(server.requests.filter((request) => request.method === "POST")).toHaveLength(1);
    expect(server.requests.map((request) => request.method)).toEqual(["GET", "GET", "POST", "GET"]);
  });

  test("reconciles a timed-out create when the folder is then visible", async () => {
    let visible = false;
    const server = await createFakeHttpServer({
      handler: async (request: RecordedRequest) => {
        if (request.method === "POST") {
          visible = true;
          await Bun.sleep(50);
          return { status: 201, body: { name: "a", resourceId: "folder-a" } };
        }
        if (request.path === "/v1/search/resources/folders") {
          return visible ? searchPage([folder("folder-a", "/a")]) : searchPage();
        }
        return searchPage();
      },
    });
    servers.push(server);
    const sleeps: number[] = [];

    const result = await runEnsureDir(
      "/a",
      resolverFor(server, {
        timeoutMs: 10,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      }),
    );

    expect(result).toEqual({
      action: "existing",
      data: { path: "/a", resourceId: "folder-a", createdPaths: [] },
    });
    expect(server.requests.filter((request) => request.method === "POST")).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  test("does not repeat a timed-out POST when reconciliation cannot find the folder", async () => {
    let postCount = 0;
    const server = await createFakeHttpServer({
      handler: async (request: RecordedRequest) => {
        if (request.method === "POST") {
          postCount += 1;
          await Bun.sleep(50);
          return { status: 201, body: { name: "a", resourceId: "folder-a" } };
        }
        return searchPage();
      },
    });
    servers.push(server);
    const sleeps: number[] = [];

    await expect(
      runEnsureDir(
        "/a",
        resolverFor(server, {
          timeoutMs: 10,
          sleep: async (ms) => {
            sleeps.push(ms);
          },
        }),
      ),
    ).rejects.toMatchObject({ kind: "api-unavailable", retryable: true });

    expect(postCount).toBe(1);
    expect(sleeps).toEqual([250, 750, 1_000]);
  });

  test("returns conflict when a 409 reconciles to a file", async () => {
    const server = await createFakeHttpServer([
      searchPage(),
      searchPage(),
      { status: 409, body: { code: "DUPLICATE", message: "already exists" } },
      searchPage(),
      searchPage([file("file-a", "/a")]),
    ]);
    servers.push(server);

    await expect(runEnsureDir("/a", resolverFor(server))).rejects.toMatchObject({
      kind: "conflict",
    });
    expect(server.requests.filter((request) => request.method === "POST")).toHaveLength(1);
  });

  test("treats the root as an existing directory without an API request", async () => {
    const server = await createFakeHttpServer();
    servers.push(server);

    const result = await runEnsureDir("///", resolverFor(server));

    expect(result).toEqual({
      action: "existing",
      data: { path: "/", resourceId: null, createdPaths: [] },
    });
    expect(server.requests).toHaveLength(0);
  });
});

import { afterEach, describe, expect, test } from "bun:test";
import { createFakeHttpServer, type FakeHttpServer } from "../../test/http/server.ts";
import { MyboxClient } from "../mybox/client.ts";
import { RemoteResolver } from "./resolver.ts";

type SearchResource = {
  resourceId: string;
  name: string;
  type: string;
  path?: string;
  parentPath?: string;
};

function searchPage(resources: SearchResource[], nextCursor?: string) {
  return {
    body: {
      resources,
      responseMetaData: nextCursor === undefined ? {} : { nextCursor },
    },
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
  sleep?: (ms: number) => Promise<void>,
): RemoteResolver {
  const client = new MyboxClient({ pat: "test-pat", baseUrl: server.baseUrl, timeoutMs: 5_000 });
  return new RemoteResolver(client, sleep === undefined ? {} : { sleep });
}

describe("RemoteResolver", () => {
  test("resolves a nested file only after exact path filtering and pagination", async () => {
    const server = await createFakeHttpServer([
      searchPage([
        { resourceId: "folder-foo", name: "foo", type: "folder", path: "/foo" },
        { resourceId: "wrong-folder", name: "foo", type: "folder", path: "/foobar" },
      ]),
      searchPage(
        [
          {
            resourceId: "wrong-nested-folder",
            name: "bar.txt",
            type: "folder",
            path: "/foo/bar.txtx",
          },
        ],
        "next",
      ),
      searchPage([
        {
          resourceId: "wrong-nested-folder-2",
          name: "bar.txt",
          type: "folder",
          path: "/not/foo/bar.txt",
        },
      ]),
      searchPage([
        {
          resourceId: "file-1",
          name: "bar.txt",
          type: "file",
          path: "/foo/bar.txt",
          parentPath: "/foo/",
        },
        { resourceId: "partial", name: "bar.txt", type: "file", path: "/foo/bar.txt.bak" },
      ]),
    ]);
    servers.push(server);
    const resolver = resolverFor(server);

    const result = await resolver.resolve("/foo/bar.txt");

    expect(result.kind).toBe("found");
    if (result.kind === "found") {
      expect(result.resource.resourceId).toBe("file-1");
      expect(result.path.normalized).toBe("/foo/bar.txt");
    }
    expect(server.requests.map((request) => request.path)).toEqual([
      "/v1/search/resources/folders",
      "/v1/search/resources/folders",
      "/v1/search/resources/folders",
      "/v1/search/resources/files",
    ]);
    expect(server.requests[3]?.query.get("q")).toBe("bar.txt");
    expect(server.requests[3]?.query.get("parentPath")).toBe("/foo");
    expect(server.requests[3]?.query.has("path")).toBe(false);
    expect(server.requests[2]?.query.get("cursor")).toBe("next");
  });

  test("returns absent for a candidate without enough optional path evidence", async () => {
    const server = await createFakeHttpServer([
      searchPage([{ resourceId: "folder-1", name: "report.md", type: "folder" }]),
      searchPage([{ resourceId: "file-1", name: "report.md", type: "file" }]),
    ]);
    servers.push(server);
    const resolver = resolverFor(server);

    await expect(resolver.resolve("/report.md")).resolves.toMatchObject({ kind: "absent" });
  });

  test("resolves an existing folder without spending a file search request", async () => {
    const server = await createFakeHttpServer([
      searchPage([{ resourceId: "folder-1", name: "reports", type: "folder", path: "/reports" }]),
    ]);
    servers.push(server);
    const resolver = resolverFor(server);

    await expect(resolver.resolveFolderExact("/reports")).resolves.toMatchObject({
      kind: "found",
      resource: { resourceId: "folder-1", type: "folder" },
    });
    expect(server.requests.map((request) => request.path)).toEqual([
      "/v1/search/resources/folders",
    ]);
  });

  test("reports a file used as an intermediate directory as a conflict", async () => {
    const server = await createFakeHttpServer([
      searchPage([]),
      searchPage([
        {
          resourceId: "file-1",
          name: "archive",
          type: "file",
          path: "/archive",
          parentPath: "/",
        },
      ]),
    ]);
    servers.push(server);
    const resolver = resolverFor(server);

    await expect(resolver.resolve("/archive/item.txt")).rejects.toMatchObject({
      kind: "conflict",
    });
    expect(server.requests).toHaveLength(2);
  });

  test("reports ambiguous exact candidates instead of choosing one", async () => {
    const server = await createFakeHttpServer([
      searchPage([
        { resourceId: "folder-1", name: "reports", type: "folder", path: "/reports" },
        { resourceId: "folder-2", name: "reports", type: "folder", path: "/reports/" },
      ]),
    ]);
    servers.push(server);
    const resolver = resolverFor(server);

    await expect(resolver.resolve("/reports")).rejects.toMatchObject({ kind: "conflict" });
    expect(server.requests).toHaveLength(1);
  });

  test("can poll a newly visible path within a bounded schedule", async () => {
    const server = await createFakeHttpServer([
      searchPage([]),
      searchPage([]),
      searchPage([]),
      searchPage([]),
      searchPage([{ resourceId: "folder-1", name: "new", type: "folder", path: "/new" }]),
      searchPage([]),
    ]);
    servers.push(server);
    const sleeps: number[] = [];
    const resolver = resolverFor(server, async (ms) => {
      sleeps.push(ms);
    });

    const result = await resolver.resolve("/new", { poll: true, pollTimesMs: [0, 100, 300] });

    expect(result.kind).toBe("found");
    expect(sleeps).toEqual([100, 200]);
  });
});

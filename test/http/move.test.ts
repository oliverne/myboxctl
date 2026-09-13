import { afterEach, describe, expect, test } from "bun:test";

import { runMove } from "../../src/features/move.ts";
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

function folderResource(resourceIdValue: string, name: string, path: string) {
  return { resourceId: resourceIdValue, parentId: "root-1", name, type: "folder", path };
}

function fileResource(resourceIdValue: string, name: string, parentPath: string) {
  return {
    resourceId: resourceIdValue,
    parentId: parentPath === "/reports" ? "folder-reports" : "folder-archive",
    name,
    type: "file",
    path: `${parentPath === "/" ? "" : parentPath}/${name}`,
    parentPath,
  };
}

function resourceDetail() {
  return {
    resourceId: "file-1",
    parentId: "folder-reports",
    name: "draft.md",
    type: "file",
    size: 6,
    createdAt: "2026-09-13T10:00:00Z",
    modifiedAt: "2026-09-13T10:00:01Z",
    accessedAt: "2026-09-13T10:00:01Z",
    isFavorite: false,
    isHidden: false,
    lastModifiedBy: "tester",
  };
}

function listItem(resourceIdValue: string, name: string, parentPath: string) {
  return {
    ...resourceDetail(),
    resourceId: resourceIdValue,
    name,
    parentId:
      parentPath === "/reports"
        ? "folder-reports"
        : parentPath === "/archive"
          ? "folder-archive"
          : "root-1",
    path: `${parentPath === "/" ? "" : parentPath}/${name}`,
    parentPath,
  };
}

function dependencies(server: FakeHttpServer) {
  const client = new MyboxClient({ pat: "test-pat", baseUrl: server.baseUrl, timeoutMs: 5_000 });
  return { client, resolver: new RemoteResolver(client) };
}

function fastDependencies(server: FakeHttpServer) {
  const client = new MyboxClient({ pat: "test-pat", baseUrl: server.baseUrl, timeoutMs: 5_000 });
  return { client, resolver: new RemoteResolver(client, { sleep: async () => {} }) };
}

function folderItem(resourceIdValue: string, name: string, parentPath: string) {
  return { ...listItem(resourceIdValue, name, parentPath), type: "folder" };
}

type MoveState = {
  moved: boolean;
  movedParent: "/archive" | "/";
  destination: "folder" | "file" | "missing";
  conflict?: boolean;
};

function moveHandler(state: MoveState) {
  return (request: RecordedRequest) => {
    if (request.path === "/v1/search/resources/folders") {
      const path = request.query.get("path");
      if (path === "/reports") {
        return { body: searchPage([folderResource("folder-reports", "reports", "/reports")]) };
      }
      if (path === "/archive" && state.destination === "folder") {
        return { body: searchPage([folderResource("folder-archive", "archive", "/archive")]) };
      }
      return { body: searchPage() };
    }
    if (request.path === "/v1/search/resources/files") {
      const q = request.query.get("q");
      const parentPath = request.query.get("parentPath");
      if (q !== "draft.md") {
        return { body: searchPage() };
      }
      if (state.destination === "file" && parentPath === "/") {
        // used by the "destination is a file" failure path
        return { body: searchPage() };
      }
      const currentParent = state.moved ? state.movedParent : "/reports";
      return parentPath === currentParent
        ? { body: searchPage([fileResource("file-1", "draft.md", parentPath)]) }
        : { body: searchPage() };
    }
    if (request.path === "/v1/drive/folders/folder-reports/resources") {
      return { body: listPage([listItem("file-1", "draft.md", "/reports")]) };
    }
    if (request.path === "/v1/drive/folders/folder-archive/resources") {
      const resources = state.conflict
        ? [listItem("file-2", "draft.md", "/archive")]
        : state.moved
          ? [listItem("file-1", "draft.md", "/archive")]
          : [];
      return { body: listPage(resources) };
    }
    if (request.path === "/v1/drive/resources") {
      const resources = state.moved ? [listItem("file-1", "draft.md", "/")] : [];
      return { body: listPage(resources) };
    }
    if (request.path === "/v1/drive/resources/file-1" && request.method === "GET") {
      return { body: resourceDetail() };
    }
    if (request.path === "/v1/drive/resources/file-1/move" && request.method === "POST") {
      const body = JSON.parse(request.bodyText) as { parentId: string };
      state.moved = true;
      state.movedParent = body.parentId === "root-1" ? "/" : "/archive";
      return { status: 200 };
    }
    return { status: 500, body: { code: "UNEXPECTED", message: "unexpected request" } };
  };
}

describe("move HTTP operation", () => {
  test("moves the exact resolved resource ID once", async () => {
    const state: MoveState = { moved: false, movedParent: "/archive", destination: "folder" };
    const server = await createFakeHttpServer({ handler: moveHandler(state) });
    servers.push(server);

    const result = await runMove("/reports/draft.md", "/archive/", dependencies(server));

    expect(result).toEqual({
      action: "moved",
      data: {
        resourceId: "file-1",
        type: "file",
        path: "/reports/draft.md",
        newPath: "/archive/draft.md",
      },
    });
    const moves = server.requests.filter((request) => request.path.endsWith("/move"));
    expect(moves).toHaveLength(1);
    expect(JSON.parse(moves[0]?.bodyText ?? "{}")).toEqual({ parentId: "folder-archive" });
  });

  test("succeeds without mutation when the destination is the current parent", async () => {
    const state: MoveState = { moved: false, movedParent: "/archive", destination: "folder" };
    const server = await createFakeHttpServer({ handler: moveHandler(state) });
    servers.push(server);

    const result = await runMove("/reports/draft.md", "/reports", dependencies(server));

    expect(result).toEqual({
      action: "unchanged",
      data: {
        resourceId: "file-1",
        type: "file",
        path: "/reports/draft.md",
        newPath: "/reports/draft.md",
      },
    });
    expect(server.requests.filter((request) => request.method === "POST")).toHaveLength(0);
  });

  test("moves to the root using the searched root ID", async () => {
    const state: MoveState = { moved: false, movedParent: "/", destination: "folder" };
    const server = await createFakeHttpServer({
      handler: (request: RecordedRequest) => {
        if (request.path === "/v1/search/resources/folders" && request.query.get("path") === "/") {
          return {
            body: searchPage([
              { resourceId: "root-1", parentId: "root-1", name: "root", path: "/" },
            ]),
          };
        }
        return moveHandler(state)(request);
      },
    });
    servers.push(server);

    const result = await runMove("/reports/draft.md", "/", dependencies(server));

    expect(result.action).toBe("moved");
    expect(result.data.newPath).toBe("/draft.md");
    const moves = server.requests.filter((request) => request.path.endsWith("/move"));
    expect(moves).toHaveLength(1);
    expect(JSON.parse(moves[0]?.bodyText ?? "{}")).toEqual({ parentId: "root-1" });
  });

  test("fails closed on a destination name conflict without mutating", async () => {
    const state: MoveState = {
      moved: false,
      movedParent: "/archive",
      destination: "folder",
      conflict: true,
    };
    const server = await createFakeHttpServer({ handler: moveHandler(state) });
    servers.push(server);

    await expect(
      runMove("/reports/draft.md", "/archive", dependencies(server)),
    ).rejects.toMatchObject({ kind: "conflict", code: "NAME_CONFLICT" });
    expect(server.requests.filter((request) => request.method === "POST")).toHaveLength(0);
  });

  test("reports a missing destination directory", async () => {
    const state: MoveState = { moved: false, movedParent: "/archive", destination: "missing" };
    const server = await createFakeHttpServer({ handler: moveHandler(state) });
    servers.push(server);

    await expect(
      runMove("/reports/draft.md", "/archive", dependencies(server)),
    ).rejects.toMatchObject({ kind: "not-found" });
    expect(server.requests.filter((request) => request.method === "POST")).toHaveLength(0);
  });

  test("rejects a folder move into its own descendant before any request", async () => {
    const state: MoveState = { moved: false, movedParent: "/archive", destination: "folder" };
    const server = await createFakeHttpServer({ handler: moveHandler(state) });
    servers.push(server);

    await expect(
      runMove("/reports", "/reports/archive", dependencies(server)),
    ).rejects.toMatchObject({ kind: "invalid-arguments" });
    await expect(runMove("/reports", "/reports", dependencies(server))).rejects.toMatchObject({
      kind: "invalid-arguments",
    });
    expect(server.requests).toHaveLength(0);
  });

  test("resolves a Unicode-equivalent destination to its actual spelling", async () => {
    const nfcArchive = "\uac00";
    const nfdArchive = "\u1100\u1161";
    const state = { moved: false };
    const server = await createFakeHttpServer({
      handler: (request: RecordedRequest) => {
        if (request.path === "/v1/search/resources/folders") {
          const path = request.query.get("path");
          return path === "/reports"
            ? { body: searchPage([folderResource("folder-reports", "reports", "/reports")]) }
            : { body: searchPage() };
        }
        if (request.path === "/v1/search/resources/files") {
          const q = request.query.get("q");
          const parentPath = request.query.get("parentPath");
          if (q !== "draft.md") {
            return { body: searchPage() };
          }
          const currentParent = state.moved ? `/${nfdArchive}` : "/reports";
          return parentPath === currentParent
            ? { body: searchPage([fileResource("file-1", "draft.md", parentPath)]) }
            : { body: searchPage() };
        }
        if (request.path === "/v1/drive/resources" && request.method === "GET") {
          return { body: listPage([folderItem("folder-nfd", nfdArchive, "/")]) };
        }
        if (request.path === "/v1/drive/folders/folder-nfd/resources") {
          return {
            body: listPage(state.moved ? [listItem("file-1", "draft.md", `/${nfdArchive}`)] : []),
          };
        }
        if (request.path === "/v1/drive/resources/file-1" && request.method === "GET") {
          return { body: resourceDetail() };
        }
        if (request.path === "/v1/drive/resources/file-1/move" && request.method === "POST") {
          state.moved = true;
          return { status: 200 };
        }
        return { status: 500, body: { code: "UNEXPECTED", message: "unexpected request" } };
      },
    });
    servers.push(server);

    const result = await runMove("/reports/draft.md", `/${nfcArchive}`, fastDependencies(server));

    expect(result.action).toBe("moved");
    expect(result.data.newPath).toBe(`/${nfdArchive}/draft.md`);
    const moves = server.requests.filter((request) => request.path.endsWith("/move"));
    expect(moves).toHaveLength(1);
    expect(JSON.parse(moves[0]?.bodyText ?? "{}")).toEqual({ parentId: "folder-nfd" });
  });

  test("rejects a Unicode-equivalent descendant destination before mutating", async () => {
    const nfcFolder = "\uac00";
    const nfdFolder = "\u1100\u1161";
    const server = await createFakeHttpServer({
      handler: (request: RecordedRequest) => {
        if (request.path === "/v1/search/resources/folders") {
          const path = request.query.get("path");
          if (path === `/${nfdFolder}`) {
            return { body: searchPage([folderResource("folder-nfd", nfdFolder, `/${nfdFolder}`)]) };
          }
          if (path === `/${nfdFolder}/inner`) {
            return {
              body: searchPage([folderResource("folder-inner", "inner", `/${nfdFolder}/inner`)]),
            };
          }
          return { body: searchPage() };
        }
        if (request.path === "/v1/search/resources/files") {
          return { body: searchPage() };
        }
        if (request.path === "/v1/drive/resources" && request.method === "GET") {
          return { body: listPage([folderItem("folder-nfd", nfdFolder, "/")]) };
        }
        return { status: 500, body: { code: "UNEXPECTED", message: "unexpected request" } };
      },
    });
    servers.push(server);

    await expect(
      runMove(`/${nfcFolder}`, `/${nfdFolder}/inner`, fastDependencies(server)),
    ).rejects.toMatchObject({ kind: "invalid-arguments" });
    expect(server.requests.filter((request) => request.method === "POST")).toHaveLength(0);
  });

  test("reconciles an applied move when the POST response is lost", async () => {
    const state = { moved: false };
    const server = await createFakeHttpServer({
      handler: (request: RecordedRequest) => {
        if (request.path === "/v1/search/resources/folders") {
          const path = request.query.get("path");
          if (path === "/reports") {
            return { body: searchPage([folderResource("folder-reports", "reports", "/reports")]) };
          }
          if (path === "/archive") {
            return { body: searchPage([folderResource("folder-archive", "archive", "/archive")]) };
          }
          return { body: searchPage() };
        }
        if (request.path === "/v1/search/resources/files") {
          const q = request.query.get("q");
          const parentPath = request.query.get("parentPath");
          if (q !== "draft.md") {
            return { body: searchPage() };
          }
          const currentParent = state.moved ? "/archive" : "/reports";
          return parentPath === currentParent
            ? { body: searchPage([fileResource("file-1", "draft.md", parentPath)]) }
            : { body: searchPage() };
        }
        if (request.path === "/v1/drive/folders/folder-archive/resources") {
          return { body: listPage([]) };
        }
        if (request.path === "/v1/drive/resources/file-1" && request.method === "GET") {
          return { body: resourceDetail() };
        }
        if (request.path === "/v1/drive/resources/file-1/move" && request.method === "POST") {
          state.moved = true;
          return { status: 503, body: { code: "PLAT-500", message: "uncertain" } };
        }
        return { status: 500, body: { code: "UNEXPECTED", message: "unexpected request" } };
      },
    });
    servers.push(server);

    const result = await runMove("/reports/draft.md", "/archive", fastDependencies(server));

    expect(result.action).toBe("moved");
    expect(result.data.newPath).toBe("/archive/draft.md");
    expect(server.requests.filter((request) => request.path.endsWith("/move"))).toHaveLength(1);
  });
});

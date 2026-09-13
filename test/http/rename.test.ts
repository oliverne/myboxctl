import { afterEach, describe, expect, test } from "bun:test";

import { runRename } from "../../src/features/rename.ts";
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
    parentId: "folder-reports",
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

type RenameState = { renamed: boolean; sibling?: string };

function renameHandler(state: RenameState) {
  return (request: RecordedRequest) => {
    if (request.path === "/v1/search/resources/folders") {
      const path = request.query.get("path");
      return path === "/reports"
        ? { body: searchPage([folderResource("folder-reports", "reports", "/reports")]) }
        : { body: searchPage() };
    }
    if (request.path === "/v1/search/resources/files") {
      const q = request.query.get("q");
      const current = state.renamed ? "final.md" : "draft.md";
      return q === current
        ? { body: searchPage([fileResource("file-1", current, "/reports")]) }
        : { body: searchPage() };
    }
    if (request.path === "/v1/drive/folders/folder-reports/resources") {
      const siblings = [listItem("file-1", state.renamed ? "final.md" : "draft.md", "/reports")];
      if (state.sibling !== undefined) {
        siblings.push(listItem("file-2", state.sibling, "/reports"));
      }
      return { body: listPage(siblings) };
    }
    if (request.path === "/v1/drive/resources/file-1" && request.method === "GET") {
      return { body: resourceDetail() };
    }
    if (request.path === "/v1/drive/resources/file-1/rename" && request.method === "POST") {
      state.renamed = true;
      return { status: 200, body: { name: JSON.parse(request.bodyText).name } };
    }
    return { status: 500, body: { code: "UNEXPECTED", message: "unexpected request" } };
  };
}

type RenameReconcileState = {
  renamed: boolean;
  apply: boolean;
  status: number;
  invalidBody?: boolean;
};

function renameReconcileHandler(state: RenameReconcileState) {
  return (request: RecordedRequest) => {
    if (request.path === "/v1/search/resources/folders") {
      const path = request.query.get("path");
      return path === "/reports"
        ? { body: searchPage([folderResource("folder-reports", "reports", "/reports")]) }
        : { body: searchPage() };
    }
    if (request.path === "/v1/search/resources/files") {
      const q = request.query.get("q");
      const current = state.renamed ? "final.md" : "draft.md";
      return q === current
        ? { body: searchPage([fileResource("file-1", current, "/reports")]) }
        : { body: searchPage() };
    }
    if (request.path === "/v1/drive/folders/folder-reports/resources") {
      return {
        body: listPage([listItem("file-1", state.renamed ? "final.md" : "draft.md", "/reports")]),
      };
    }
    if (request.path === "/v1/drive/resources/file-1" && request.method === "GET") {
      return { body: resourceDetail() };
    }
    if (request.path === "/v1/drive/resources/file-1/rename" && request.method === "POST") {
      if (state.apply) {
        state.renamed = true;
      }
      if (state.invalidBody === true) {
        return { status: state.status, body: {} };
      }
      return { status: state.status, body: { code: "PLAT-500", message: "uncertain" } };
    }
    return { status: 500, body: { code: "UNEXPECTED", message: "unexpected request" } };
  };
}

describe("rename HTTP operation", () => {
  test("renames the exact resolved resource ID once", async () => {
    const state: RenameState = { renamed: false };
    const server = await createFakeHttpServer({ handler: renameHandler(state) });
    servers.push(server);

    const result = await runRename("/reports/draft.md", "final.md", dependencies(server));

    expect(result).toEqual({
      action: "renamed",
      data: {
        resourceId: "file-1",
        type: "file",
        path: "/reports/draft.md",
        newPath: "/reports/final.md",
      },
    });
    const renames = server.requests.filter(
      (request) => request.path === "/v1/drive/resources/file-1/rename",
    );
    expect(renames).toHaveLength(1);
    expect(JSON.parse(renames[0]?.bodyText ?? "{}")).toEqual({ name: "final.md" });
  });

  test("succeeds without mutation when the name is unchanged", async () => {
    const state: RenameState = { renamed: false };
    const server = await createFakeHttpServer({ handler: renameHandler(state) });
    servers.push(server);

    const result = await runRename("/reports/draft.md", "draft.md", dependencies(server));

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

  test("fails closed on a sibling name conflict without mutating", async () => {
    const state: RenameState = { renamed: false, sibling: "final.md" };
    const server = await createFakeHttpServer({ handler: renameHandler(state) });
    servers.push(server);

    await expect(
      runRename("/reports/draft.md", "final.md", dependencies(server)),
    ).rejects.toMatchObject({ kind: "conflict", code: "NAME_CONFLICT" });
    expect(server.requests.filter((request) => request.method === "POST")).toHaveLength(0);
  });

  test("rejects a non-portable name before any request", async () => {
    const state: RenameState = { renamed: false };
    const server = await createFakeHttpServer({ handler: renameHandler(state) });
    servers.push(server);

    await expect(
      runRename("/reports/draft.md", "nested/final.md", dependencies(server)),
    ).rejects.toMatchObject({ kind: "invalid-arguments" });
    await expect(
      runRename("/reports/draft.md", "final?.md", dependencies(server)),
    ).rejects.toMatchObject({ code: "NON_PORTABLE_NAME" });
    expect(server.requests).toHaveLength(0);
  });

  test("reports an unconfirmed result without repeating the mutation", async () => {
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
          return q === "draft.md"
            ? { body: searchPage([fileResource("file-1", "draft.md", "/reports")]) }
            : { body: searchPage() };
        }
        if (request.path === "/v1/drive/resources/file-1" && request.method === "GET") {
          return { body: resourceDetail() };
        }
        if (request.path === "/v1/drive/folders/folder-reports/resources") {
          return { body: listPage([listItem("file-1", "draft.md", "/reports")]) };
        }
        if (request.path === "/v1/drive/resources/file-1/rename") {
          return { status: 200, body: { name: "final.md" } };
        }
        return { status: 500, body: { code: "UNEXPECTED", message: "unexpected request" } };
      },
    });
    servers.push(server);

    await expect(
      runRename("/reports/draft.md", "final.md", dependencies(server)),
    ).rejects.toMatchObject({ code: "MUTATION_UNCONFIRMED" });
    expect(server.requests.filter((request) => request.path.endsWith("/rename"))).toHaveLength(1);
  });

  test("fails closed when MYBOX rejects the rename", async () => {
    const state: RenameState = { renamed: false };
    const server = await createFakeHttpServer({
      handler: (request: RecordedRequest) => {
        if (request.path === "/v1/drive/resources/file-1/rename") {
          return { status: 409, body: { code: "PLAT-409", message: "conflict" } };
        }
        return renameHandler(state)(request);
      },
    });
    servers.push(server);

    await expect(
      runRename("/reports/draft.md", "final.md", dependencies(server)),
    ).rejects.toMatchObject({ kind: "conflict", code: "PLAT-409" });
  });

  test("reconciles an applied rename when the POST response is lost", async () => {
    const state = { renamed: false, apply: true, status: 500 };
    const server = await createFakeHttpServer({ handler: renameReconcileHandler(state) });
    servers.push(server);

    const result = await runRename("/reports/draft.md", "final.md", fastDependencies(server));

    expect(result.action).toBe("renamed");
    expect(result.data.newPath).toBe("/reports/final.md");
    expect(server.requests.filter((request) => request.path.endsWith("/rename"))).toHaveLength(1);
  });

  test("rethrows the original failure when the resource did not move", async () => {
    const state = { renamed: false, apply: false, status: 503 };
    const server = await createFakeHttpServer({ handler: renameReconcileHandler(state) });
    servers.push(server);

    await expect(
      runRename("/reports/draft.md", "final.md", fastDependencies(server)),
    ).rejects.toMatchObject({ kind: "api-unavailable", status: 503 });
    expect(server.requests.filter((request) => request.path.endsWith("/rename"))).toHaveLength(1);
  });

  test("reconciles a malformed success body by resource ID", async () => {
    const state = { renamed: false, apply: true, status: 200, invalidBody: true };
    const server = await createFakeHttpServer({ handler: renameReconcileHandler(state) });
    servers.push(server);

    const result = await runRename("/reports/draft.md", "final.md", fastDependencies(server));

    expect(result.action).toBe("renamed");
    expect(server.requests.filter((request) => request.path.endsWith("/rename"))).toHaveLength(1);
  });

  test("verifies the postcondition using the resolved NFD parent spelling", async () => {
    const nfcParent = "\uac00";
    const nfdParent = "\u1100\u1161";
    const state = { renamed: false };
    const server = await createFakeHttpServer({
      handler: (request: RecordedRequest) => {
        if (request.path === "/v1/search/resources/folders") {
          return { body: searchPage() };
        }
        if (request.path === "/v1/search/resources/files") {
          const q = request.query.get("q");
          const parentPath = request.query.get("parentPath");
          const current = state.renamed ? "final.md" : "draft.md";
          return q === current && parentPath === `/${nfdParent}`
            ? { body: searchPage([fileResource("file-1", current, `/${nfdParent}`)]) }
            : { body: searchPage() };
        }
        if (request.path === "/v1/drive/resources" && request.method === "GET") {
          return { body: listPage([folderItem("folder-nfd", nfdParent, "/")]) };
        }
        if (request.path === "/v1/drive/folders/folder-reports/resources") {
          return {
            body: listPage([
              listItem("file-1", state.renamed ? "final.md" : "draft.md", "/reports"),
            ]),
          };
        }
        if (request.path === "/v1/drive/resources/file-1" && request.method === "GET") {
          return { body: resourceDetail() };
        }
        if (request.path === "/v1/drive/resources/file-1/rename" && request.method === "POST") {
          state.renamed = true;
          return { status: 200, body: { name: "final.md" } };
        }
        return { status: 500, body: { code: "UNEXPECTED", message: "unexpected request" } };
      },
    });
    servers.push(server);

    const result = await runRename(`/${nfcParent}/draft.md`, "final.md", fastDependencies(server));

    expect(result.action).toBe("renamed");
    expect(result.data.path).toBe(`/${nfdParent}/draft.md`);
    expect(result.data.newPath).toBe(`/${nfdParent}/final.md`);
    expect(server.requests.filter((request) => request.path.endsWith("/rename"))).toHaveLength(1);
  });
});

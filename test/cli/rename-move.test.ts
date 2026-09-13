import { afterEach, describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFakeHttpServer, type FakeHttpServer, type RecordedRequest } from "../http/server.ts";

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

function fileResource(name: string, parentPath: string) {
  return {
    resourceId: "file-1",
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
    parentId: parentPath === "/reports" ? "folder-reports" : "folder-archive",
    path: `${parentPath === "/" ? "" : parentPath}/${name}`,
    parentPath,
  };
}

type RelocationState = { renamed: boolean; moved: boolean; conflict?: boolean };

function relocationHandler(state: RelocationState) {
  return (request: RecordedRequest) => {
    if (request.path === "/v1/search/resources/folders") {
      const path = request.query.get("path");
      if (path === "/reports") {
        return {
          body: searchPage([
            {
              resourceId: "folder-reports",
              parentId: "root-1",
              name: "reports",
              type: "folder",
              path,
            },
          ]),
        };
      }
      if (path === "/archive") {
        return {
          body: searchPage([
            {
              resourceId: "folder-archive",
              parentId: "root-1",
              name: "archive",
              type: "folder",
              path,
            },
          ]),
        };
      }
      return { body: searchPage() };
    }
    if (request.path === "/v1/search/resources/files") {
      const q = request.query.get("q");
      const parentPath = request.query.get("parentPath") ?? "/";
      const current = state.renamed ? "final.md" : "draft.md";
      if (!state.moved && q === current && parentPath === "/reports") {
        return { body: searchPage([fileResource(current, "/reports")]) };
      }
      if (state.moved && q === "draft.md" && parentPath === "/archive") {
        return { body: searchPage([fileResource("draft.md", "/archive")]) };
      }
      return { body: searchPage() };
    }
    if (request.path === "/v1/drive/folders/folder-reports/resources") {
      const resources = [
        listItem("file-1", state.renamed ? "final.md" : "draft.md", "/reports"),
        ...(state.conflict === true ? [listItem("file-2", "final.md", "/reports")] : []),
      ];
      return { body: listPage(resources) };
    }
    if (request.path === "/v1/drive/folders/folder-archive/resources") {
      const resources = state.conflict ? [listItem("file-2", "draft.md", "/archive")] : [];
      return { body: listPage(resources) };
    }
    if (request.path === "/v1/drive/resources/file-1" && request.method === "GET") {
      return { body: resourceDetail() };
    }
    if (request.path === "/v1/drive/resources/file-1/rename" && request.method === "POST") {
      state.renamed = true;
      return { status: 200, body: { name: JSON.parse(request.bodyText).name } };
    }
    if (request.path === "/v1/drive/resources/file-1/move" && request.method === "POST") {
      state.moved = true;
      return { status: 200 };
    }
    return { status: 500, body: { code: "UNEXPECTED", message: "unexpected request" } };
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

describe("rename and move command subprocess contract", () => {
  test("renames an exact file and emits one JSON envelope", async () => {
    const state: RelocationState = { renamed: false, moved: false };
    const server = await createFakeHttpServer({ handler: relocationHandler(state) });
    servers.push(server);

    const result = await runCli(
      ["rename", "/reports/draft.md", "final.md", "--json"],
      server.baseUrl,
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      schemaVersion: 1,
      ok: true,
      command: "rename",
      action: "renamed",
      data: {
        resourceId: "file-1",
        type: "file",
        path: "/reports/draft.md",
        newPath: "/reports/final.md",
      },
    });
    expect(server.requests.filter((request) => request.path.endsWith("/rename"))).toHaveLength(1);
  });

  test("prints a human result for a rename", async () => {
    const state: RelocationState = { renamed: false, moved: false };
    const server = await createFakeHttpServer({ handler: relocationHandler(state) });
    servers.push(server);

    const result = await runCli(["rename", "/reports/draft.md", "final.md"], server.baseUrl);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("Renamed /reports/draft.md -> /reports/final.md\n");
  });

  test("fails a sibling conflict with exit 5 and no mutation", async () => {
    const state: RelocationState = { renamed: false, moved: false, conflict: true };
    const server = await createFakeHttpServer({ handler: relocationHandler(state) });
    servers.push(server);

    const result = await runCli(
      ["rename", "/reports/draft.md", "final.md", "--json"],
      server.baseUrl,
    );

    expect(result.exitCode).toBe(5);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      command: "rename",
      error: { kind: "conflict", code: "NAME_CONFLICT" },
    });
    expect(server.requests.filter((request) => request.method === "POST")).toHaveLength(0);
  });

  test("rejects a non-portable new name with exit 2 before any request", async () => {
    const state: RelocationState = { renamed: false, moved: false };
    const server = await createFakeHttpServer({ handler: relocationHandler(state) });
    servers.push(server);

    const result = await runCli(
      ["rename", "/reports/draft.md", "../escape.md", "--json"],
      server.baseUrl,
    );

    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: {
        kind: "invalid-arguments",
        code: "NAME_NOT_SINGLE_COMPONENT",
        message:
          'The new name must be a single path component: ../escape.md. Pass only the new name, or use "myboxctl move" to change its location.',
      },
    });
    expect(server.requests).toHaveLength(0);
  });

  test("moves a file into an existing directory", async () => {
    const state: RelocationState = { renamed: false, moved: false };
    const server = await createFakeHttpServer({ handler: relocationHandler(state) });
    servers.push(server);

    const result = await runCli(
      ["move", "/reports/draft.md", "/archive/", "--json"],
      server.baseUrl,
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      command: "move",
      action: "moved",
      data: { resourceId: "file-1", path: "/reports/draft.md", newPath: "/archive/draft.md" },
    });
    expect(server.requests.filter((request) => request.path.endsWith("/move"))).toHaveLength(1);
  });

  test("reports an unchanged move without mutation", async () => {
    const state: RelocationState = { renamed: false, moved: false };
    const server = await createFakeHttpServer({ handler: relocationHandler(state) });
    servers.push(server);

    const result = await runCli(["move", "/reports/draft.md", "/reports"], server.baseUrl);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("Already in destination: /reports/draft.md\n");
    expect(server.requests.filter((request) => request.method === "POST")).toHaveLength(0);
  });

  test("rejects a move into the source descendant with exit 2", async () => {
    const state: RelocationState = { renamed: false, moved: false };
    const server = await createFakeHttpServer({ handler: relocationHandler(state) });
    servers.push(server);

    const result = await runCli(["move", "/reports", "/reports/archive", "--json"], server.baseUrl);

    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: { kind: "invalid-arguments" },
    });
    expect(server.requests).toHaveLength(0);
  });

  test("documents both commands in the root help", async () => {
    const subprocess = Bun.spawn(["bun", "run", "src/cli.ts", "--help"], {
      cwd: process.cwd(),
      env: { ...process.env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, exitCode] = await Promise.all([
      new Response(subprocess.stdout).text(),
      subprocess.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("rename [options] <remote-path> <new-name>");
    expect(stdout).toContain("move [options] <remote-path> <destination-directory>");
  });
});

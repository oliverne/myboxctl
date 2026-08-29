import { afterEach, describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFakeHttpServer, type FakeHttpServer, type RecordedRequest } from "../http/server.ts";

type ResourceInput = {
  resourceId: string;
  name: string;
  type: "file" | "folder";
  size?: number;
  modifiedAt?: string;
  path?: string;
  parentPath?: string;
};

function resource(input: ResourceInput) {
  return {
    parentId: "parent-1",
    size: input.size ?? 0,
    createdAt: "2026-08-22T10:00:00Z",
    modifiedAt: input.modifiedAt ?? "2026-08-22T10:00:00Z",
    accessedAt: "2026-08-22T10:00:00Z",
    isFavorite: false,
    isHidden: false,
    lastModifiedBy: "tester",
    ...input,
  };
}

function page(resources: ResourceInput[]) {
  return {
    resources: resources.map(resource),
    responseMetaData: {},
    fileCount: resources.filter((item) => item.type === "file").length,
    subFolderCount: resources.filter((item) => item.type === "folder").length,
  };
}

async function runCli(
  args: string[],
  baseUrl: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
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

const servers: FakeHttpServer[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.close();
  }
});

describe("read command subprocess contract", () => {
  test.each([
    [["stat", "--json"], "stat"],
    [["unknown", "--json"], "unknown"],
  ] as const)("renders Commander argument errors as JSON for %j", async (args, command) => {
    const server = await createFakeHttpServer();
    servers.push(server);

    const result = await runCli([...args], server.baseUrl);

    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      command,
      error: { kind: "invalid-arguments", retryable: false },
    });
    expect(result.stderr).toBe("");
    expect(server.requests).toHaveLength(0);
  });

  test("stat root returns a folder without inventing a resource id", async () => {
    const server = await createFakeHttpServer({
      handler: () => ({ body: page([]) }),
    });
    servers.push(server);

    const result = await runCli(["stat", "/", "--json"], server.baseUrl);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      command: "stat",
      action: "found",
      data: { resource: { path: "/", name: "/", type: "folder" } },
    });
    expect(result.stderr).toBe("");
    expect(server.requests).toHaveLength(0);
  });

  test("stat resolves an exact nested file and emits stable metadata", async () => {
    const detail = resource({
      resourceId: "file-1",
      name: "report #1.txt",
      type: "file",
      size: 12,
      modifiedAt: "2026-08-22T11:00:00Z",
    });
    const server = await createFakeHttpServer({
      handler: (request: RecordedRequest) => {
        if (request.path === "/v1/search/resources/folders") {
          return request.query.get("path") === "/reports"
            ? {
                body: {
                  resources: [
                    resource({
                      resourceId: "folder-1",
                      name: "reports",
                      type: "folder",
                      path: "/reports",
                    }),
                  ],
                  responseMetaData: {},
                },
              }
            : { body: { resources: [], responseMetaData: {} } };
        }
        if (request.path === "/v1/search/resources/files") {
          return request.query.get("q") === "report #1.txt"
            ? {
                body: {
                  resources: [
                    {
                      resourceId: "file-1",
                      name: "report #1.txt",
                      type: "file",
                      path: "/reports/report #1.txt",
                      parentPath: "/reports/",
                    },
                  ],
                  responseMetaData: {},
                },
              }
            : { body: { resources: [], responseMetaData: {} } };
        }
        if (request.path === "/v1/drive/resources/file-1") {
          return { body: detail };
        }
        return { status: 500, body: { code: "UNEXPECTED", message: "unexpected request" } };
      },
    });
    servers.push(server);

    const result = await runCli(["stat", "/reports/report #1.txt", "--json"], server.baseUrl);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      command: "stat",
      action: "found",
      data: {
        resource: {
          resourceId: "file-1",
          path: "/reports/report #1.txt",
          name: "report #1.txt",
          type: "file",
          size: 12,
          modifiedAt: "2026-08-22T11:00:00Z",
        },
      },
    });
    expect(server.requests[2]?.query.get("parentPath")).toBe("/reports");
  });

  test("ls uses direct-child pagination and deterministic folder-first ordering", async () => {
    const server = await createFakeHttpServer({
      handler: (request: RecordedRequest) => {
        if (request.path === "/v1/drive/resources") {
          return {
            body: page([
              { resourceId: "file-z", name: "z.txt", type: "file" },
              { resourceId: "folder-a", name: "가이드", type: "folder" },
              { resourceId: "folder-b", name: "Alpha", type: "folder" },
              { resourceId: "file-a", name: "a.txt", type: "file" },
            ]),
          };
        }
        return { status: 500, body: { code: "UNEXPECTED", message: "unexpected request" } };
      },
    });
    servers.push(server);

    const result = await runCli(["ls", "/", "--json"], server.baseUrl);

    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout) as {
      data: { resources: Array<{ name: string; path: string }> };
    };
    expect(output.data.resources.map((item) => item.name)).toEqual([
      "Alpha",
      "가이드",
      "a.txt",
      "z.txt",
    ]);
    expect(output.data.resources.map((item) => item.path)).toEqual([
      "/Alpha",
      "/가이드",
      "/a.txt",
      "/z.txt",
    ]);
  });

  test("stat reports an absent path as a successful lookup", async () => {
    const server = await createFakeHttpServer([{ body: {} }, { body: {} }]);
    servers.push(server);

    const result = await runCli(["stat", "/missing", "--json"], server.baseUrl);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      command: "stat",
      action: "absent",
      data: { resource: null },
    });
  });

  test("ls reports absent directories and file targets with their documented exit codes", async () => {
    const absentServer = await createFakeHttpServer([
      { body: { resources: [], responseMetaData: {} } },
      { body: { resources: [], responseMetaData: {} } },
    ]);
    const fileServer = await createFakeHttpServer([
      { body: { resources: [], responseMetaData: {} } },
      {
        body: {
          resources: [
            {
              resourceId: "file-1",
              name: "file.txt",
              type: "file",
              path: "/file.txt",
              parentPath: "/",
            },
          ],
          responseMetaData: {},
        },
      },
    ]);
    servers.push(absentServer, fileServer);

    const absent = await runCli(["ls", "/missing", "--json"], absentServer.baseUrl);
    const file = await runCli(["ls", "/file.txt", "--json"], fileServer.baseUrl);

    expect(absent.exitCode).toBe(4);
    expect(JSON.parse(absent.stdout)).toMatchObject({
      ok: false,
      command: "ls",
      error: { kind: "not-found" },
    });
    expect(file.exitCode).toBe(5);
    expect(JSON.parse(file.stdout)).toMatchObject({
      ok: false,
      command: "ls",
      error: { kind: "conflict" },
    });
  });

  test.each([
    "/foo/../bar",
    `/foo/before${String.fromCodePoint(0x1f)}after`,
    `/foo/before${String.fromCodePoint(0x7f)}after`,
  ])("invalid remote path %j uses the JSON failure envelope and exit code 2", async (remotePath) => {
    const server = await createFakeHttpServer({
      handler: () => ({
        status: 500,
        body: { code: "UNEXPECTED", message: "no request expected" },
      }),
    });
    servers.push(server);

    const result = await runCli(["stat", remotePath, "--json"], server.baseUrl);

    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      command: "stat",
      error: { kind: "invalid-remote-path", retryable: false },
    });
    expect(server.requests).toHaveLength(0);
  });
});

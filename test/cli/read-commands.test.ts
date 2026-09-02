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
    [["info", "--json"], "info"],
    [["unknown", "--json"], "unknown"],
    [["info", "/", "--json", "--verbose", "--quiet"], "info"],
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

  test("renders one human error on stderr and leaves stdout empty", async () => {
    const server = await createFakeHttpServer();
    servers.push(server);
    const result = await runCli(["info", "/invalid/../path"], server.baseUrl);
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr.trim().split("\n")[0]).toStartWith("Error: ");
    expect(result.stderr.match(/^Error:/gm)).toHaveLength(1);
  });

  test("info root returns a folder without inventing a resource id", async () => {
    const server = await createFakeHttpServer({
      handler: () => ({ body: page([]) }),
    });
    servers.push(server);

    const result = await runCli(["info", "/", "--json"], server.baseUrl);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      schemaVersion: 1,
      command: "info",
      action: "found",
      data: {
        resource: {
          resourceId: null,
          path: "/",
          name: "/",
          type: "folder",
          sizeBytes: null,
          modifiedAt: null,
        },
      },
    });
    expect(result.stderr).toBe("");
    expect(server.requests).toHaveLength(0);
  });

  test("info resolves an exact nested file and emits normalized metadata", async () => {
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

    const result = await runCli(["info", "/reports/report #1.txt", "--json"], server.baseUrl);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      schemaVersion: 1,
      command: "info",
      action: "found",
      data: {
        resource: {
          resourceId: "file-1",
          path: "/reports/report #1.txt",
          name: "report #1.txt",
          type: "file",
          sizeBytes: 12,
          modifiedAt: "2026-08-22T11:00:00.000Z",
        },
      },
    });
    expect(server.requests[2]?.query.get("parentPath")).toBe("/reports");
  });

  test("list uses direct-child pagination and deterministic folder-first ordering", async () => {
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

    const result = await runCli(["list", "/", "--json"], server.baseUrl);

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

  test("human list output explains columns and empty results", async () => {
    const server = await createFakeHttpServer({
      handler: () => ({ body: page([]) }),
    });
    servers.push(server);

    const result = await runCli(["list"], server.baseUrl);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("No items in /.\n");
    expect(result.stderr).toBe("");
  });

  test("human list table keeps NAME as the last column for long and CJK names", async () => {
    const server = await createFakeHttpServer({
      handler: (request: RecordedRequest) => {
        if (request.path === "/v1/drive/resources") {
          return {
            body: page([
              {
                resourceId: "f1",
                name: "a-very-long-ascii-file-name-that-exceeds-the-original-column-width.txt",
                type: "file",
                size: 123456,
                modifiedAt: "2026-09-01T00:00:00Z",
              },
              {
                resourceId: "f2",
                name: "아주긴한글파일이름보고서문서.pdf",
                type: "file",
                size: 7890,
              },
              {
                resourceId: "f3",
                name: "Mixed영어한글파일이름_2026.xlsx",
                type: "file",
                size: 42,
                modifiedAt: "2026-09-02T12:34:56Z",
              },
              { resourceId: "fd", name: "Reports", type: "folder" },
            ]),
          };
        }
        return { status: 500, body: { code: "UNEXPECTED", message: "no request expected" } };
      },
    });
    servers.push(server);

    const result = await runCli(["list", "/"], server.baseUrl);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("TYPE    SIZE      MODIFIED             NAME");
    expect(result.stdout).toContain(
      "a-very-long-ascii-file-name-that-exceeds-the-original-column-width.txt",
    );
    expect(result.stdout).toContain("아주긴한글파일이름보고서문서.pdf");
    expect(result.stdout).toContain("Mixed영어한글파일이름_2026.xlsx");

    const names = [
      "a-very-long-ascii-file-name-that-exceeds-the-original-column-width.txt",
      "아주긴한글파일이름보고서문서.pdf",
      "Mixed영어한글파일이름_2026.xlsx",
      "Reports",
    ];
    const dataLines = result.stdout
      .split("\n")
      .filter((line) => line.startsWith("file ") || line.startsWith("folder "));
    expect(dataLines).toHaveLength(names.length);
    for (const name of names) {
      const row = dataLines.find((line) => line.trimEnd().endsWith(name));
      if (row === undefined) {
        throw new Error(`missing list row for ${name}`);
      }
      expect(/^(file|folder) /.test(row)).toBe(true);
    }
  });

  test("info reports an absent path as not-found", async () => {
    const server = await createFakeHttpServer([{ body: {} }, { body: {} }]);
    servers.push(server);

    const result = await runCli(["info", "/missing", "--json"], server.baseUrl);

    expect(result.exitCode).toBe(4);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      command: "info",
      error: { kind: "not-found" },
    });
  });

  test("list reports absent paths and file targets with their documented exit codes", async () => {
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
      { body: resource({ resourceId: "file-1", name: "file.txt", type: "file", size: 4 }) },
    ]);
    servers.push(absentServer, fileServer);

    const absent = await runCli(["list", "/missing", "--json"], absentServer.baseUrl);
    const file = await runCli(["list", "/file.txt", "--json"], fileServer.baseUrl);

    expect(absent.exitCode).toBe(4);
    expect(JSON.parse(absent.stdout)).toMatchObject({
      ok: false,
      command: "list",
      error: { kind: "not-found" },
    });
    expect(file.exitCode).toBe(0);
    expect(JSON.parse(file.stdout)).toMatchObject({
      ok: true,
      schemaVersion: 1,
      command: "list",
      action: "listed",
      data: { resources: [{ name: "file.txt", type: "file", sizeBytes: 4 }] },
    });
  });

  test.each([
    "/foo/../bar",
    `/foo/before${String.fromCodePoint(0x1f)}after`,
    `/foo/before${String.fromCodePoint(0x7f)}after`,
  ])(
    "invalid remote path %j uses the JSON failure envelope and exit code 2",
    async (remotePath) => {
      const server = await createFakeHttpServer({
        handler: () => ({
          status: 500,
          body: { code: "UNEXPECTED", message: "no request expected" },
        }),
      });
      servers.push(server);

      const result = await runCli(["info", remotePath, "--json"], server.baseUrl);

      expect(result.exitCode).toBe(2);
      expect(JSON.parse(result.stdout)).toMatchObject({
        ok: false,
        command: "info",
        error: { kind: "invalid-remote-path", retryable: false },
      });
      expect(server.requests).toHaveLength(0);
    },
  );
});

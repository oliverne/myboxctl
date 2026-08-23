import { afterEach, describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFakeHttpServer, type FakeHttpServer, type RecordedRequest } from "../http/server.ts";

function searchPage(resources: unknown[] = []) {
  return {
    resources,
    responseMetaData: {},
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

describe("ensure-dir command subprocess contract", () => {
  test("creates a missing Unicode hierarchy and emits one JSON success envelope", async () => {
    let nextFolderId = 0;
    const server = await createFakeHttpServer({
      handler: (request: RecordedRequest) => {
        if (request.method === "POST") {
          nextFolderId += 1;
          const body = JSON.parse(request.bodyText) as { folderName: string };
          return {
            status: 201,
            body: { name: body.folderName, resourceId: `folder-${nextFolderId}` },
          };
        }
        return { body: searchPage() };
      },
    });
    servers.push(server);

    const result = await runCli(["ensure-dir", "/agents/한글/reports/", "--json"], server.baseUrl);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      command: "ensure-dir",
      action: "created",
      data: {
        path: "/agents/한글/reports",
        resourceId: "folder-3",
        createdPaths: ["/agents", "/agents/한글", "/agents/한글/reports"],
      },
    });
    expect(result.stderr).toBe("");
    expect(server.requests.filter((request) => request.method === "POST")).toHaveLength(3);
    const createRequests = server.requests.filter((request) => request.method === "POST");
    expect(JSON.parse(createRequests[2]?.bodyText ?? "{}")).toEqual({
      folderName: "reports",
      parentId: "folder-2",
    });
  });

  test("returns existing for root without contacting MYBOX", async () => {
    const server = await createFakeHttpServer();
    servers.push(server);

    const result = await runCli(["ensure-dir", "/", "--json"], server.baseUrl);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      command: "ensure-dir",
      action: "existing",
      data: { path: "/", resourceId: null, createdPaths: [] },
    });
    expect(result.stderr).toBe("");
    expect(server.requests).toHaveLength(0);
  });

  test("maps an intermediate file to conflict and does not create a folder", async () => {
    const server = await createFakeHttpServer({
      handler: (request: RecordedRequest) => {
        if (request.path === "/v1/search/resources/files") {
          return {
            body: searchPage([
              {
                resourceId: "file-agents",
                name: "agents",
                type: "file",
                path: "/agents",
                parentPath: "/",
              },
            ]),
          };
        }
        return { body: searchPage() };
      },
    });
    servers.push(server);

    const result = await runCli(["ensure-dir", "/agents/reports", "--json"], server.baseUrl);

    expect(result.exitCode).toBe(5);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      command: "ensure-dir",
      error: { kind: "conflict", retryable: false },
    });
    expect(result.stderr).toBe("");
    expect(server.requests.filter((request) => request.method === "POST")).toHaveLength(0);
  });
});

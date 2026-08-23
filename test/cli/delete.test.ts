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

describe("delete command subprocess contract", () => {
  test("deletes an exact file and emits one JSON envelope", async () => {
    const server = await createFakeHttpServer({
      handler: (request: RecordedRequest) => {
        if (request.path === "/v1/search/resources/folders") {
          return { body: searchPage() };
        }
        if (request.path === "/v1/search/resources/files") {
          return {
            body: searchPage([
              {
                resourceId: "file-1",
                name: "report.txt",
                type: "file",
                path: "/report.txt",
                parentPath: "/",
              },
            ]),
          };
        }
        if (request.path === "/v1/drive/resources/file-1" && request.method === "DELETE") {
          return { status: 204 };
        }
        return { status: 500, body: { code: "UNEXPECTED", message: "unexpected request" } };
      },
    });
    servers.push(server);

    const result = await runCli(["delete", "/report.txt", "--json"], server.baseUrl);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      command: "delete",
      action: "deleted",
      data: { path: "/report.txt", resourceId: "file-1", type: "file" },
    });
  });

  test("distinguishes default and strict absent behavior", async () => {
    const server = await createFakeHttpServer({
      handler: (request: RecordedRequest) => {
        if (request.path.startsWith("/v1/search/resources/")) {
          return { body: searchPage() };
        }
        return { status: 500, body: { code: "UNEXPECTED", message: "unexpected mutation" } };
      },
    });
    servers.push(server);

    const regular = await runCli(["delete", "/missing.txt", "--json"], server.baseUrl);
    expect(regular.exitCode).toBe(0);
    expect(regular.stderr).toBe("");
    expect(JSON.parse(regular.stdout)).toEqual({
      ok: true,
      command: "delete",
      action: "already-absent",
      data: { path: "/missing.txt" },
    });

    const strict = await runCli(["delete", "/missing.txt", "--strict", "--json"], server.baseUrl);
    expect(strict.exitCode).toBe(4);
    expect(strict.stderr).toBe("");
    expect(JSON.parse(strict.stdout)).toMatchObject({
      ok: false,
      command: "delete",
      error: { kind: "not-found" },
    });
    expect(server.requests.filter((request) => request.method === "DELETE")).toHaveLength(0);
  });

  test("rejects root before contacting MYBOX", async () => {
    const server = await createFakeHttpServer();
    servers.push(server);

    const result = await runCli(["delete", "/", "--json"], server.baseUrl);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      command: "delete",
      error: { kind: "invalid-arguments" },
    });
    expect(server.requests).toHaveLength(0);
  });
});

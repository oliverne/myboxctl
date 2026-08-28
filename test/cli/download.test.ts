import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFakeHttpServer, type FakeHttpServer, type RecordedRequest } from "../http/server.ts";

const servers: FakeHttpServer[] = [];
const directories: string[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) server.close();
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

function searchPage(resources: unknown[] = []) {
  return { resources, responseMetaData: {} };
}

function detail(size: number) {
  return {
    resourceId: "file-1",
    parentId: "root",
    name: "한글 report.txt",
    type: "file",
    size,
    createdAt: "2026-08-27T11:00:00Z",
    modifiedAt: "2026-08-27T12:00:00Z",
    accessedAt: "2026-08-27T12:00:00Z",
    isFavorite: false,
    isHidden: false,
    lastModifiedBy: "tester",
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
        `myboxctl-download-rate-limit-${crypto.randomUUID()}.json`,
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

describe("download command subprocess contract", () => {
  test("streams an exact file and emits one safe JSON envelope", async () => {
    const bytes = new TextEncoder().encode("download 한글 content");
    let server: FakeHttpServer;
    server = await createFakeHttpServer({
      handler: (request: RecordedRequest) => {
        if (request.path === "/v1/search/resources/folders") return { body: searchPage() };
        if (request.path === "/v1/search/resources/files") {
          return {
            body: searchPage([
              {
                resourceId: "file-1",
                name: "한글 report.txt",
                type: "file",
                path: "/한글 report.txt",
                parentPath: "/",
              },
            ]),
          };
        }
        if (request.path === "/v1/drive/resources/file-1")
          return { body: detail(bytes.byteLength) };
        if (request.path === "/v1/drive/files/file-1/download") {
          return {
            body: { downloadUrl: `${server.baseUrl}/signed?token=secret-value`, expiresIn: 600 },
          };
        }
        if (request.path === "/signed") return { rawBody: bytes };
        return { status: 500, body: { code: "UNEXPECTED", message: "unexpected request" } };
      },
    });
    servers.push(server);
    const directory = await mkdtemp(join(tmpdir(), "myboxctl-download-cli-"));
    directories.push(directory);
    const destination = join(directory, "한글 local.txt");

    const result = await runCli(
      ["download", "/한글 report.txt", destination, "--json"],
      server.baseUrl,
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      command: "download",
      action: "downloaded",
      data: {
        remotePath: "/한글 report.txt",
        localPath: destination,
        resourceId: "file-1",
        size: bytes.byteLength,
        modifiedAt: "2026-08-27T12:00:00Z",
      },
    });
    expect(new Uint8Array(await readFile(destination))).toEqual(bytes);
    expect(result.stdout).not.toContain("secret-value");
    const signedRequest = server.requests.find((request) => request.path === "/signed");
    expect(signedRequest?.headers.authorization).toBeUndefined();
  });

  test("preserves an existing destination without issuing a download URL", async () => {
    const bytes = new TextEncoder().encode("remote");
    const server = await createFakeHttpServer({
      handler: (request: RecordedRequest) => {
        if (request.path === "/v1/search/resources/folders") return { body: searchPage() };
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
        if (request.path === "/v1/drive/resources/file-1")
          return { body: detail(bytes.byteLength) };
        return { status: 500, body: { code: "URL_MUST_NOT_BE_ISSUED", message: "unexpected" } };
      },
    });
    servers.push(server);
    const directory = await mkdtemp(join(tmpdir(), "myboxctl-download-cli-"));
    directories.push(directory);
    const destination = join(directory, "existing.txt");
    await writeFile(destination, "keep");

    const result = await runCli(["download", "/report.txt", destination, "--json"], server.baseUrl);

    expect(result.exitCode).toBe(5);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      command: "download",
      error: { kind: "conflict" },
    });
    expect(await readFile(destination, "utf8")).toBe("keep");
    expect(server.requests.filter((request) => request.path.includes("/download"))).toHaveLength(0);
  });

  const testPosixSignal = process.platform === "win32" ? test.skip : test;

  testPosixSignal("removes partial files when SIGINT aborts a signed transfer", async () => {
    let server: FakeHttpServer;
    server = await createFakeHttpServer({
      handler: (request: RecordedRequest) => {
        if (request.path === "/v1/search/resources/folders") return { body: searchPage() };
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
        if (request.path === "/v1/drive/resources/file-1") return { body: detail(100) };
        if (request.path === "/v1/drive/files/file-1/download") {
          return { body: { downloadUrl: `${server.baseUrl}/signed`, expiresIn: 600 } };
        }
        if (request.path === "/signed") {
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new Uint8Array([1]));
              },
            }),
          );
        }
        return { status: 500, body: { code: "UNEXPECTED", message: "unexpected request" } };
      },
    });
    servers.push(server);
    const directory = await mkdtemp(join(tmpdir(), "myboxctl-download-cli-"));
    directories.push(directory);
    const destination = join(directory, "interrupted.txt");
    const subprocess = Bun.spawn(
      ["bun", "run", "src/cli.ts", "download", "/report.txt", destination, "--json"],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          MYBOX_PAT: "test-pat",
          MYBOX_BASE_URL: server.baseUrl,
          MYBOX_TIMEOUT_MS: "30000",
          MYBOX_RATE_LIMIT_STATE_PATH: join(
            tmpdir(),
            `myboxctl-download-rate-limit-${crypto.randomUUID()}.json`,
          ),
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (server.requests.some((request) => request.path === "/signed")) break;
      await Bun.sleep(10);
    }
    expect(server.requests.some((request) => request.path === "/signed")).toBe(true);
    subprocess.kill("SIGINT");
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(subprocess.stdout).text(),
      new Response(subprocess.stderr).text(),
      subprocess.exited,
    ]);

    expect(exitCode).toBe(6);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toMatchObject({
      ok: false,
      command: "download",
      error: { kind: "api-unavailable", retryable: true },
    });
    await expect(readFile(destination)).rejects.toMatchObject({ code: "ENOENT" });
    const tempFiles = await Array.fromAsync(
      new Bun.Glob(".*.myboxctl-*.tmp").scan({ cwd: directory, onlyFiles: true }),
    );
    expect(tempFiles).toEqual([]);
  });
});

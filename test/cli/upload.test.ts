import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFakeHttpServer, type FakeHttpServer, type RecordedRequest } from "../http/server.ts";

const servers: FakeHttpServer[] = [];
const directories: string[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.close();
  }
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

function searchPage(resources: unknown[] = []) {
  return { resources, responseMetaData: {} };
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

describe("upload command subprocess contract", () => {
  test("uploads a local file and emits one JSON envelope", async () => {
    const directory = await mkdtemp(join(tmpdir(), "myboxctl-upload-cli-"));
    directories.push(directory);
    const localPath = join(directory, "한글 report.txt");
    await writeFile(localPath, "content");
    const server = await createFakeHttpServer({
      handler: (request: RecordedRequest) => {
        if (request.path.startsWith("/v1/search/resources/")) {
          return { body: searchPage() };
        }
        if (request.path === "/v1/drive/files") {
          return {
            status: 201,
            body: { uploadUrl: `${server.baseUrl}/storage/upload`, offset: 0 },
          };
        }
        if (request.path === "/storage/upload") {
          return { body: { resourceId: "file-1", name: "report.txt", fileSize: 7 } };
        }
        if (request.path === "/v1/drive/resources/file-1") {
          return {
            body: {
              resourceId: "file-1",
              parentId: "parent-1",
              name: "report.txt",
              type: "file",
              size: 7,
              createdAt: "2026-08-23T10:00:00Z",
              modifiedAt: "2026-08-23T10:00:01Z",
              accessedAt: "2026-08-23T10:00:01Z",
              isFavorite: false,
              isHidden: false,
              lastModifiedBy: "tester",
            },
          };
        }
        return { status: 500, body: { code: "UNEXPECTED", message: "unexpected request" } };
      },
    });
    servers.push(server);

    const result = await runCli(["upload", localPath, "/report.txt", "--json"], server.baseUrl);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      command: "upload",
      action: "uploaded",
      data: {
        path: "/report.txt",
        resourceId: "file-1",
        size: 7,
        modifiedAt: "2026-08-23T10:00:01Z",
      },
    });
    expect(result.stderr).toBe("");
    expect(
      server.requests.find((request) => request.path === "/storage/upload")?.bodyText,
    ).toContain("content\r\n--");
  });
});

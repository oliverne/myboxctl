import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, open, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MyboxClient } from "../../src/mybox/client.ts";
import { MyboxDownloader } from "../../src/mybox/download.ts";
import { createFakeHttpServer, type FakeHttpServer } from "./server.ts";

const servers: FakeHttpServer[] = [];
const directories: string[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) server.close();
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function tempFile() {
  const directory = await mkdtemp(join(tmpdir(), "myboxctl-download-http-"));
  directories.push(directory);
  const path = join(directory, "content.bin");
  return { path, handle: await open(path, "w+") };
}

describe("MYBOX download transport", () => {
  test("issues a download URL exactly once with PAT auth", async () => {
    const server = await createFakeHttpServer([
      { status: 200, body: { downloadUrl: "https://storage.example.test/file", expiresIn: 600 } },
    ]);
    servers.push(server);
    const client = new MyboxClient({ pat: "raw-pat", baseUrl: server.baseUrl, timeoutMs: 5_000 });

    await expect(client.createDownloadUrl("file /한글")).resolves.toMatchObject({ expiresIn: 600 });
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]?.path).toBe("/v1/drive/files/file%20%2F%ED%95%9C%EA%B8%80/download");
    expect(server.requests[0]?.headers.authorization).toBe("Bearer raw-pat");
  });

  test("does not retry an ambiguous URL issuance failure", async () => {
    const server = await createFakeHttpServer([
      { status: 503, body: { code: "TEMP", message: "temporary" } },
      { status: 200, body: { downloadUrl: "https://storage.example.test/file", expiresIn: 600 } },
    ]);
    servers.push(server);
    const client = new MyboxClient({ pat: "token", baseUrl: server.baseUrl, timeoutMs: 5_000 });

    await expect(client.createDownloadUrl("file-1")).rejects.toMatchObject({
      kind: "api-unavailable",
      retryable: true,
    });
    expect(server.requests).toHaveLength(1);
  });

  test("streams signed content once without an Authorization header", async () => {
    const bytes = new TextEncoder().encode("한글 streamed content");
    const server = await createFakeHttpServer([{ status: 200, rawBody: bytes }]);
    servers.push(server);
    const local = await tempFile();
    const downloader = new MyboxDownloader();

    const received = await downloader.downloadContent({
      downloadUrl: `${server.baseUrl}/signed?token=secret-value`,
      fileHandle: local.handle,
      expectedSize: bytes.byteLength,
      signal: AbortSignal.timeout(5_000),
    });
    await local.handle.close();

    expect(received).toBe(bytes.byteLength);
    expect(new Uint8Array(await readFile(local.path))).toEqual(bytes);
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]?.method).toBe("GET");
    expect(server.requests[0]?.headers.authorization).toBeUndefined();
  });

  test("rejects content longer than metadata without exposing its URL", async () => {
    const server = await createFakeHttpServer([{ status: 200, rawBody: "too long" }]);
    servers.push(server);
    const local = await tempFile();
    const downloader = new MyboxDownloader();

    const error = await downloader
      .downloadContent({
        downloadUrl: `${server.baseUrl}/signed?token=secret-value`,
        fileHandle: local.handle,
        expectedSize: 2,
        signal: AbortSignal.timeout(5_000),
      })
      .catch((value: unknown) => value);
    await local.handle.close();

    expect(error).toMatchObject({ kind: "api-unavailable", code: "DOWNLOAD_CONTENT_FAILED" });
    expect(JSON.stringify(error)).not.toContain("secret-value");
    expect(server.requests).toHaveLength(1);
  });
});

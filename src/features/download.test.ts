import { afterEach, describe, expect, test } from "bun:test";
import type { FileHandle } from "node:fs/promises";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MyboxClient } from "../mybox/client.ts";
import type { MyboxDownloader } from "../mybox/download.ts";
import { parseRemotePath } from "../remote/path.ts";
import type { RemoteResolver } from "../remote/resolver.ts";
import { runDownload } from "./download.ts";

const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("download command cleanup", () => {
  test("removes a partial temp file when its signal is aborted", async () => {
    const directory = await mkdtemp(join(tmpdir(), "myboxctl-download-abort-"));
    directories.push(directory);
    const destination = join(directory, "result.txt");
    const path = parseRemotePath("/report.txt");
    if (path.kind === "root") throw new Error("test path must be a child");
    const resource = {
      resourceId: "file-1",
      name: "report.txt",
      type: "file",
      path: "/report.txt",
      parentPath: "/",
    };
    const detail = {
      resourceId: "file-1",
      parentId: "root",
      name: "report.txt",
      type: "file",
      size: 100,
      createdAt: "2026-08-27T11:00:00Z",
      modifiedAt: "2026-08-27T12:00:00Z",
      accessedAt: "2026-08-27T12:00:00Z",
      isFavorite: false,
      isHidden: false,
      lastModifiedBy: "tester",
    };
    const started = Promise.withResolvers<void>();
    const controller = new AbortController();
    const operation = runDownload(
      path.normalized,
      destination,
      {},
      {
        resolver: {
          resolveExact: async () => ({ kind: "found", path, resource }),
          detail: async () => detail,
        } as unknown as RemoteResolver,
        client: {
          createDownloadUrl: async () => ({
            downloadUrl: "https://storage.example.test/file?token=secret",
            expiresIn: 600,
          }),
          getResource: async () => detail,
        } as unknown as MyboxClient,
        downloader: {
          downloadContent: async ({
            fileHandle,
            signal,
          }: {
            fileHandle: FileHandle;
            signal: AbortSignal;
          }) => {
            await fileHandle.writeFile("partial");
            started.resolve();
            await new Promise<void>((_, reject) => {
              signal.addEventListener(
                "abort",
                () => reject(new DOMException("aborted", "AbortError")),
                { once: true },
              );
            });
            return 0;
          },
        } as unknown as MyboxDownloader,
        timeoutMs: 30_000,
        signal: controller.signal,
      },
    );

    await started.promise;
    controller.abort();
    await expect(operation).rejects.toMatchObject({ name: "AbortError" });
    await expect(readFile(destination)).rejects.toMatchObject({ code: "ENOENT" });
    const tempFiles = await Array.fromAsync(
      new Bun.Glob(".*.myboxctl-*.tmp").scan({ cwd: directory, onlyFiles: true }),
    );
    expect(tempFiles).toEqual([]);
  });
});

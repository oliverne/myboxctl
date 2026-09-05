import { afterEach, describe, expect, test } from "bun:test";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DomainError } from "../errors.ts";
import type { MyboxClient } from "../mybox/client.ts";
import type { MyboxDownloader } from "../mybox/download.ts";
import type { MyboxUploader } from "../mybox/upload.ts";
import type { RemoteResolver } from "../remote/resolver.ts";
import { runDownloadCommand } from "./download-command.ts";
import { runRecursiveDownload } from "./recursive-download.ts";
import { runRecursiveUpload } from "./recursive-upload.ts";
import { runUploadCommand } from "./upload-command.ts";

const temporaryDirectories: string[] = [];
afterEach(async () =>
  Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  ),
);
async function fixture(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "myboxctl-recursive-"));
  temporaryDirectories.push(path);
  return path;
}

describe("recursive transfer", () => {
  test("requires --recursive before a folder transfer can mutate", async () => {
    const localRoot = await fixture();
    const remoteFolder = {
      kind: "found",
      path: {
        kind: "child",
        normalized: "/remote",
        basename: "remote",
        parentPath: "/",
        components: ["remote"],
      },
      resource: { resourceId: "folder-id", name: "remote", type: "folder" },
    } as const;
    const resolver = {
      resolveCanonical: async () => remoteFolder,
    } as unknown as RemoteResolver;
    await expect(
      runUploadCommand(
        localRoot,
        "/remote",
        {},
        {
          resolver,
          client: {} as MyboxClient,
          uploader: {} as MyboxUploader,
          timeoutMs: 1_000,
        },
      ),
    ).rejects.toMatchObject({ kind: "invalid-arguments" });
    await expect(
      runDownloadCommand(
        "/remote",
        undefined,
        {},
        {
          resolver,
          client: {} as MyboxClient,
          downloader: {} as MyboxDownloader,
          timeoutMs: 1_000,
        },
      ),
    ).rejects.toMatchObject({ kind: "conflict" });
  });

  test("uploads an empty folder with one exclusive create", async () => {
    const root = await fixture();
    const calls: unknown[] = [];
    const resolver = {
      resolveCanonical: async () => ({ kind: "absent", resource: null }),
      resolveForMutation: async () => ({ kind: "absent", resource: null }),
      createFolder: async (input: unknown) => {
        calls.push(input);
        return { resourceId: "created-root", name: "remote" };
      },
    } as unknown as RemoteResolver;
    const result = await runRecursiveUpload(
      root,
      "/remote",
      { recursive: true },
      { resolver, client: {} as MyboxClient, uploader: {} as MyboxUploader, timeoutMs: 1_000 },
    );
    expect(result.data).toMatchObject({
      remotePath: "/remote",
      resourceId: "created-root",
      filesUploaded: 0,
      foldersCreated: 1,
      bytesUploaded: 0,
    });
    expect(calls).toEqual([{ folderName: "remote" }]);
  });

  test("downloads an empty remote folder and verifies the tree twice", async () => {
    const parent = await fixture();
    let listings = 0;
    const resolver = {
      listChildren: async () => {
        listings += 1;
        return [];
      },
    } as unknown as RemoteResolver;
    const root = {
      kind: "found",
      path: {
        kind: "child",
        normalized: "/remote",
        basename: "remote",
        parentPath: "/",
        components: ["remote"],
      },
      resource: { resourceId: "folder-id", name: "remote", type: "folder" },
    } as const;
    const result = await runRecursiveDownload(
      "/remote",
      join(parent, "copy"),
      { resolver, client: {} as MyboxClient, downloader: {} as MyboxDownloader, timeoutMs: 1_000 },
      root,
    );
    expect(result.data).toMatchObject({
      filesDownloaded: 0,
      foldersCreated: 1,
      bytesDownloaded: 0,
    });
    expect((await lstat(join(parent, "copy"))).isDirectory()).toBe(true);
    expect(listings).toBe(2);
  });

  test("uploads nested and empty folders with created parent IDs and no file path search", async () => {
    const root = await fixture();
    await mkdir(join(root, "nested", "empty"), { recursive: true });
    await writeFile(join(root, "nested", "a.txt"), "abc");
    let mutationResolutions = 0;
    const resolver = {
      resolveCanonical: async () => ({ kind: "absent", resource: null }),
      resolveForMutation: async () => {
        mutationResolutions += 1;
        return { kind: "absent", resource: null };
      },
      createFolder: async (input: { folderName: string }) => ({
        resourceId: `${input.folderName}-id`,
        name: input.folderName,
      }),
    } as unknown as RemoteResolver;
    const reservations: unknown[] = [];
    const client = {
      getStorage: async () => ({ maxFileBytes: 100 }),
      createUpload: async (input: unknown) => {
        reservations.push(input);
        return { uploadUrl: "https://upload.test" };
      },
      getResource: async () => ({
        resourceId: "file-id",
        type: "file",
        name: "a.txt",
        size: 3,
        modifiedAt: "2026-01-01T00:00:00.000Z",
      }),
    } as unknown as MyboxClient;
    const uploader = {
      uploadContent: async () => ({ resourceId: "file-id", name: "a.txt", fileSize: 3 }),
    } as unknown as MyboxUploader;
    const result = await runRecursiveUpload(
      root,
      "/remote",
      { recursive: true },
      { resolver, client, uploader, timeoutMs: 1_000 },
    );
    expect(result.data).toMatchObject({ filesUploaded: 1, foldersCreated: 3, bytesUploaded: 3 });
    expect(reservations).toEqual([
      expect.objectContaining({ parentId: "nested-id", fileName: "a.txt", fileSize: 3 }),
    ]);
    expect(mutationResolutions).toBe(3);
  });

  test("reports an uncertain root create without repeating the mutation", async () => {
    const root = await fixture();
    let resolutions = 0;
    let creates = 0;
    const resolver = {
      resolveCanonical: async () => ({ kind: "absent", resource: null }),
      resolveForMutation: async () => {
        resolutions += 1;
        if (resolutions === 1) return { kind: "absent", resource: null };
        throw new DomainError("api-unavailable", "reconcile failed", { retryable: true });
      },
      createFolder: async () => {
        creates += 1;
        throw new DomainError("api-unavailable", "response lost", { retryable: true });
      },
    } as unknown as RemoteResolver;
    const failure = runRecursiveUpload(
      root,
      "/remote",
      { recursive: true },
      { resolver, client: {} as MyboxClient, uploader: {} as MyboxUploader, timeoutMs: 1_000 },
    );
    await expect(failure).rejects.toMatchObject({
      code: "FOLDER_CREATION_UNCERTAIN",
      partialTransfer: { rootCreated: null, mutationMayHaveOccurred: true },
    });
    expect(creates).toBe(1);
  });

  test("preserves a partial tree when an intermediate remote folder mutation fails", async () => {
    const root = await fixture();
    await mkdir(join(root, "nested"));
    await writeFile(join(root, "nested", "a.txt"), "abc");
    const createdFolders: string[] = [];
    let uploads = 0;
    const resolver = {
      resolveCanonical: async () => ({ kind: "absent", resource: null }),
      resolveForMutation: async () => ({ kind: "absent", resource: null }),
      createFolder: async (input: { folderName: string }) => {
        createdFolders.push(input.folderName);
        if (input.folderName === "nested") {
          throw new DomainError("api-unavailable", "remote folder mutation failed", {
            code: "REMOTE_MUTATION_FAILED",
            requestId: "request-folder-failure",
            retryable: false,
            status: 503,
          });
        }
        return { resourceId: "remote-root-id", name: input.folderName };
      },
    } as unknown as RemoteResolver;
    const client = {
      getStorage: async () => ({ maxFileBytes: 100 }),
      createUpload: async () => ({ uploadUrl: "https://upload.test" }),
    } as unknown as MyboxClient;
    const uploader = {
      uploadContent: async () => {
        uploads += 1;
        return { resourceId: "file-id", name: "a.txt", fileSize: 3 };
      },
    } as unknown as MyboxUploader;

    const failure = runRecursiveUpload(
      root,
      "/remote",
      { recursive: true },
      { resolver, client, uploader, timeoutMs: 1_000 },
    );

    await expect(failure).rejects.toMatchObject({
      kind: "api-unavailable",
      code: "REMOTE_MUTATION_FAILED",
      requestId: "request-folder-failure",
      status: 503,
      partialTransfer: {
        direction: "upload",
        remoteRootPath: "/remote",
        rootCreated: true,
        filesCompleted: 0,
        foldersCompleted: 1,
        supportingFoldersCreated: 0,
        bytesCompleted: 0,
        mutationMayHaveOccurred: true,
      },
    });
    expect(createdFolders).toEqual(["remote", "nested"]);
    expect(uploads).toBe(0);
  });

  test("downloads a nested file and empty folder with two detail reads", async () => {
    const parent = await fixture();
    const modifiedAt = "2026-01-01T00:00:00.000Z";
    const resource = {
      resourceId: "file-id",
      parentId: "nested-id",
      name: "a.txt",
      type: "file",
      size: 3,
      createdAt: modifiedAt,
      modifiedAt,
      accessedAt: modifiedAt,
      isFavorite: false,
      isHidden: false,
      lastModifiedBy: "tester",
    };
    const folderResource = (resourceId: string, parentId: string, name: string) => ({
      ...resource,
      resourceId,
      parentId,
      name,
      type: "folder",
      size: 0,
    });
    let listings = 0;
    let details = 0;
    const resolver = {
      listChildren: async (_path: string, folderId: string) => {
        listings += 1;
        if (folderId === "folder-id") {
          return [folderResource("nested-id", "folder-id", "nested")];
        }
        if (folderId === "nested-id") {
          return [folderResource("empty-id", "nested-id", "empty"), resource];
        }
        return [];
      },
      detail: async () => {
        details += 1;
        return resource;
      },
    } as unknown as RemoteResolver;
    const client = {
      createDownloadUrl: async () => ({ downloadUrl: "https://download.test", expiresIn: 600 }),
      getResource: async () => {
        details += 1;
        return resource;
      },
    } as unknown as MyboxClient;
    const downloader = {
      downloadContent: async (input: {
        fileHandle: { writeFile(value: string): Promise<void> };
        onProgress?: (value: number) => void;
      }) => {
        await input.fileHandle.writeFile("abc");
        input.onProgress?.(3);
        return 3;
      },
    } as unknown as MyboxDownloader;
    const events: Array<{ event: string; data: { transferredBytes?: number } }> = [];
    const root = {
      kind: "found",
      path: {
        kind: "child",
        normalized: "/remote",
        basename: "remote",
        parentPath: "/",
        components: ["remote"],
      },
      resource: { resourceId: "folder-id", name: "remote", type: "folder" },
    } as const;
    const result = await runRecursiveDownload(
      "/remote",
      join(parent, "copy"),
      {
        resolver,
        client,
        downloader,
        timeoutMs: 1_000,
        eventSink: {
          emit: (event) =>
            events.push({
              event: event.event,
              data: event.data as { transferredBytes?: number },
            }),
        },
      },
      root,
    );
    expect(await readFile(join(parent, "copy", "nested", "a.txt"), "utf8")).toBe("abc");
    expect((await lstat(join(parent, "copy", "nested", "empty"))).isDirectory()).toBe(true);
    expect(result.data).toMatchObject({
      filesDownloaded: 1,
      foldersCreated: 3,
      bytesDownloaded: 3,
    });
    expect({ listings, details }).toEqual({ listings: 6, details: 2 });
    expect(
      events
        .filter((event) => event.event.startsWith("download.transfer-"))
        .map((event) => [event.event, event.data.transferredBytes]),
    ).toEqual([
      ["download.transfer-started", 0],
      ["download.transfer-progress", 3],
      ["download.transfer-completed", 3],
    ]);
  });

  test("keeps completed uploads and does not retry after recursive SIGINT", async () => {
    const root = await fixture();
    await writeFile(join(root, "a.txt"), "a");
    await writeFile(join(root, "b.txt"), "b");
    const controller = new AbortController();
    let foldersCreated = 0;
    let reservations = 0;
    let uploads = 0;
    let activeUpload: { name: string; size: number } | undefined;
    const resolver = {
      resolveCanonical: async () => ({ kind: "absent", resource: null }),
      resolveForMutation: async () => ({ kind: "absent", resource: null }),
      createFolder: async () => {
        foldersCreated += 1;
        return { resourceId: "remote-root-id", name: "remote" };
      },
    } as unknown as RemoteResolver;
    const client = {
      getStorage: async () => ({ maxFileBytes: 100 }),
      createUpload: async (input: { fileName: string; fileSize: number }) => {
        reservations += 1;
        activeUpload = { name: input.fileName, size: input.fileSize };
        return { uploadUrl: "https://upload.test" };
      },
      getResource: async (resourceId: string) => ({
        resourceId,
        parentId: "remote-root-id",
        name: activeUpload?.name ?? "a.txt",
        type: "file",
        size: activeUpload?.size ?? 1,
        createdAt: "2026-01-01T00:00:00.000Z",
        modifiedAt: "2026-01-01T00:00:00.000Z",
        accessedAt: "2026-01-01T00:00:00.000Z",
        isFavorite: false,
        isHidden: false,
        lastModifiedBy: "tester",
      }),
    } as unknown as MyboxClient;
    const uploader = {
      uploadContent: async (input: { fileName: string; fileSize: number }) => {
        uploads += 1;
        if (uploads === 1) {
          controller.abort();
          return { resourceId: "a-id", name: input.fileName, fileSize: input.fileSize };
        }
        throw new DOMException("aborted", "AbortError");
      },
    } as unknown as MyboxUploader;

    const failure = runRecursiveUpload(
      root,
      "/remote",
      { recursive: true },
      {
        resolver,
        client,
        uploader,
        timeoutMs: 1_000,
        signal: controller.signal,
      },
    );

    await expect(failure).rejects.toMatchObject({
      kind: "api-unavailable",
      partialTransfer: {
        rootCreated: true,
        filesCompleted: 1,
        foldersCompleted: 1,
        bytesCompleted: 1,
        mutationMayHaveOccurred: true,
      },
    });
    expect({ foldersCreated, reservations, uploads }).toEqual({
      foldersCreated: 1,
      reservations: 2,
      uploads: 2,
    });
  });

  test("keeps completed downloads and removes only the active recursive temp file on SIGINT", async () => {
    const parent = await fixture();
    const controller = new AbortController();
    const modifiedAt = "2026-01-01T00:00:00.000Z";
    const resources = ["a.txt", "b.txt"].map((name) => ({
      resourceId: `${name}-id`,
      parentId: "folder-id",
      name,
      type: "file",
      size: 1,
      createdAt: modifiedAt,
      modifiedAt,
      accessedAt: modifiedAt,
      isFavorite: false,
      isHidden: false,
      lastModifiedBy: "tester",
    }));
    const root = {
      kind: "found",
      path: {
        kind: "child",
        normalized: "/remote",
        basename: "remote",
        parentPath: "/",
        components: ["remote"],
      },
      resource: { resourceId: "folder-id", name: "remote", type: "folder" },
    } as const;
    const resolver = {
      listChildren: async () => resources,
      detail: async (resolution: { resource: unknown }) => resolution.resource,
    } as unknown as RemoteResolver;
    const client = {
      createDownloadUrl: async () => ({ downloadUrl: "https://download.test", expiresIn: 600 }),
      getResource: async (resourceId: string) =>
        resources.find((item) => item.resourceId === resourceId),
    } as unknown as MyboxClient;
    let downloads = 0;
    const downloader = {
      downloadContent: async (input: {
        fileHandle: { writeFile(value: Uint8Array): Promise<void> };
        signal?: AbortSignal;
      }) => {
        downloads += 1;
        if (downloads === 1) {
          await input.fileHandle.writeFile(new Uint8Array([1]));
          controller.abort();
          return 1;
        }
        expect(input.signal?.aborted).toBe(true);
        throw new DOMException("aborted", "AbortError");
      },
    } as unknown as MyboxDownloader;

    const failure = runRecursiveDownload(
      "/remote",
      join(parent, "copy"),
      {
        resolver,
        client,
        downloader,
        timeoutMs: 1_000,
        signal: controller.signal,
      },
      root,
    );

    await expect(failure).rejects.toMatchObject({
      kind: "api-unavailable",
      partialTransfer: {
        rootCreated: true,
        filesCompleted: 1,
        foldersCompleted: 1,
        bytesCompleted: 1,
        mutationMayHaveOccurred: true,
      },
    });
    expect(await readFile(join(parent, "copy", "a.txt"))).toEqual(Buffer.from([1]));
    await expect(readFile(join(parent, "copy", "b.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(
      await Array.fromAsync(
        new Bun.Glob(".*.myboxctl-*.tmp").scan({ cwd: join(parent, "copy"), onlyFiles: true }),
      ),
    ).toEqual([]);
  });

  test("preserves completed downloads when an intermediate remote transfer fails", async () => {
    const parent = await fixture();
    const modifiedAt = "2026-01-01T00:00:00.000Z";
    const resources = ["a.txt", "b.txt"].map((name) => ({
      resourceId: `${name}-id`,
      parentId: "folder-id",
      name,
      type: "file",
      size: 1,
      createdAt: modifiedAt,
      modifiedAt,
      accessedAt: modifiedAt,
      isFavorite: false,
      isHidden: false,
      lastModifiedBy: "tester",
    }));
    const root = {
      kind: "found",
      path: {
        kind: "child",
        normalized: "/remote",
        basename: "remote",
        parentPath: "/",
        components: ["remote"],
      },
      resource: { resourceId: "folder-id", name: "remote", type: "folder" },
    } as const;
    const resolver = {
      listChildren: async () => resources,
      detail: async (resolution: { resource: unknown }) => resolution.resource,
    } as unknown as RemoteResolver;
    const client = {
      createDownloadUrl: async () => ({ downloadUrl: "https://download.test", expiresIn: 600 }),
      getResource: async (resourceId: string) =>
        resources.find((item) => item.resourceId === resourceId),
    } as unknown as MyboxClient;
    let downloads = 0;
    const downloader = {
      downloadContent: async (input: {
        fileHandle: { writeFile(value: Uint8Array): Promise<void> };
      }) => {
        downloads += 1;
        if (downloads === 1) {
          await input.fileHandle.writeFile(new Uint8Array([1]));
          return 1;
        }
        throw new DomainError("api-unavailable", "remote file transfer failed", {
          code: "REMOTE_TRANSFER_FAILED",
          requestId: "request-file-failure",
          retryable: false,
          status: 503,
        });
      },
    } as unknown as MyboxDownloader;

    const failure = runRecursiveDownload(
      "/remote",
      join(parent, "copy"),
      { resolver, client, downloader, timeoutMs: 1_000 },
      root,
    );

    await expect(failure).rejects.toMatchObject({
      kind: "api-unavailable",
      code: "REMOTE_TRANSFER_FAILED",
      requestId: "request-file-failure",
      status: 503,
      partialTransfer: {
        direction: "download",
        rootCreated: true,
        filesCompleted: 1,
        foldersCompleted: 1,
        bytesCompleted: 1,
        mutationMayHaveOccurred: true,
      },
    });
    expect(downloads).toBe(2);
    expect(await readFile(join(parent, "copy", "a.txt"))).toEqual(Buffer.from([1]));
    await expect(readFile(join(parent, "copy", "b.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(
      await Array.fromAsync(
        new Bun.Glob(".*.myboxctl-*.tmp").scan({ cwd: join(parent, "copy"), onlyFiles: true }),
      ),
    ).toEqual([]);
  });

  test("fails closed when a manifest file is replaced after the remote root is created", async () => {
    const root = await fixture();
    const filePath = join(root, "a.txt");
    await writeFile(filePath, "before");
    let uploads = 0;
    const resolver = {
      resolveCanonical: async () => ({ kind: "absent", resource: null }),
      resolveForMutation: async () => ({ kind: "absent", resource: null }),
      createFolder: async () => {
        await rm(filePath);
        await writeFile(filePath, "after");
        return { resourceId: "remote-root-id", name: "remote" };
      },
    } as unknown as RemoteResolver;
    const client = {
      getStorage: async () => ({ maxFileBytes: 100 }),
      createUpload: async () => ({ uploadUrl: "https://upload.test" }),
    } as unknown as MyboxClient;
    const uploader = {
      uploadContent: async () => {
        uploads += 1;
        return { resourceId: "file-id", name: "a.txt", fileSize: 5 };
      },
    } as unknown as MyboxUploader;

    const failure = runRecursiveUpload(
      root,
      "/remote",
      { recursive: true },
      { resolver, client, uploader, timeoutMs: 1_000 },
    );

    await expect(failure).rejects.toMatchObject({
      kind: "local-file-changed",
      partialTransfer: {
        rootCreated: true,
        filesCompleted: 0,
        foldersCompleted: 1,
        mutationMayHaveOccurred: true,
      },
    });
    expect(uploads).toBe(0);
  });

  test("fails closed when a manifest directory is replaced by a symlink", async () => {
    const root = await fixture();
    const nested = join(root, "nested");
    await mkdir(nested);
    await writeFile(join(nested, "a.txt"), "inside");
    const outside = await fixture();
    await writeFile(join(outside, "a.txt"), "outside");
    let uploads = 0;
    const resolver = {
      resolveCanonical: async () => ({ kind: "absent", resource: null }),
      resolveForMutation: async () => ({ kind: "absent", resource: null }),
      createFolder: async (input: { folderName: string }) => {
        if (input.folderName === "nested") {
          await rm(nested, { recursive: true, force: true });
          await symlink(outside, nested);
        }
        return { resourceId: `${input.folderName}-id`, name: input.folderName };
      },
    } as unknown as RemoteResolver;
    const client = {
      getStorage: async () => ({ maxFileBytes: 100 }),
      createUpload: async () => ({ uploadUrl: "https://upload.test" }),
    } as unknown as MyboxClient;
    const uploader = {
      uploadContent: async () => {
        uploads += 1;
        return { resourceId: "file-id", name: "a.txt", fileSize: 6 };
      },
    } as unknown as MyboxUploader;

    const failure = runRecursiveUpload(
      root,
      "/remote",
      { recursive: true },
      { resolver, client, uploader, timeoutMs: 1_000 },
    );

    await expect(failure).rejects.toMatchObject({
      kind: "local-file",
      partialTransfer: {
        rootCreated: true,
        filesCompleted: 0,
        foldersCompleted: 2,
        mutationMayHaveOccurred: true,
      },
    });
    expect(uploads).toBe(0);
    expect(await readFile(join(outside, "a.txt"), "utf8")).toBe("outside");
  });

  test("does not commit outside the destination when its ancestor becomes a symlink", async () => {
    const parent = await fixture();
    const outside = await fixture();
    const localRoot = join(parent, "copy");
    const modifiedAt = "2026-01-01T00:00:00.000Z";
    const resources = ["a.txt", "b.txt"].map((name) => ({
      resourceId: `${name}-id`,
      parentId: "folder-id",
      name,
      type: "file",
      size: 1,
      createdAt: modifiedAt,
      modifiedAt,
      accessedAt: modifiedAt,
      isFavorite: false,
      isHidden: false,
      lastModifiedBy: "tester",
    }));
    const root = {
      kind: "found",
      path: {
        kind: "child",
        normalized: "/remote",
        basename: "remote",
        parentPath: "/",
        components: ["remote"],
      },
      resource: { resourceId: "folder-id", name: "remote", type: "folder" },
    } as const;
    const resolver = {
      listChildren: async () => resources,
      detail: async (resolution: { resource: unknown }) => resolution.resource,
    } as unknown as RemoteResolver;
    const client = {
      createDownloadUrl: async () => ({ downloadUrl: "https://download.test", expiresIn: 600 }),
      getResource: async (resourceId: string) =>
        resources.find((item) => item.resourceId === resourceId),
    } as unknown as MyboxClient;
    const downloader = {
      downloadContent: async (input: {
        fileHandle: { writeFile(value: Uint8Array): Promise<void> };
      }) => {
        await input.fileHandle.writeFile(new Uint8Array([1]));
        return 1;
      },
    } as unknown as MyboxDownloader;
    let beforeCommitCalls = 0;

    const failure = runRecursiveDownload(
      "/remote",
      localRoot,
      {
        resolver,
        client,
        downloader,
        timeoutMs: 1_000,
        beforeCommit: async () => {
          beforeCommitCalls += 1;
          if (beforeCommitCalls === 1) {
            await rm(localRoot, { recursive: true, force: true });
            await symlink(outside, localRoot);
          }
        },
      },
      root,
    );

    await expect(failure).rejects.toMatchObject({
      kind: "local-file-changed",
      partialTransfer: {
        rootCreated: true,
        filesCompleted: 0,
        foldersCompleted: 1,
        mutationMayHaveOccurred: true,
      },
    });
    expect(beforeCommitCalls).toBe(1);
    expect((await lstat(localRoot)).isSymbolicLink()).toBe(true);
    await expect(readFile(join(outside, "a.txt"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});

import type { Stats } from "node:fs";
import { lstat, mkdir, realpath } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { DomainError, normalizeError, type PartialTransfer } from "../errors.ts";
import { noOpEventSink } from "../observability.ts";
import { parseRemotePath } from "../remote/path.ts";
import type { FoundResolution } from "../remote/resolver.ts";
import { type DownloadDependencies, runDownload } from "./download.ts";
import { assertPortableName, buildRemoteTreeManifest, sameRemoteTree } from "./tree-manifest.ts";

export type RecursiveDownloadResult = {
  action: "downloaded";
  data: {
    type: "folder";
    remotePath: string;
    localPath: string;
    resourceId: string;
    filesDownloaded: number;
    foldersCreated: number;
    bytesDownloaded: number;
  };
};

function withPartial(error: unknown, partial: PartialTransfer): DomainError {
  const normalized = normalizeError(error);
  return new DomainError(normalized.kind, normalized.message, {
    retryable: normalized.retryable,
    cause: normalized.cause,
    partialTransfer: partial,
    ...(normalized.code === undefined ? {} : { code: normalized.code }),
    ...(normalized.requestId === undefined ? {} : { requestId: normalized.requestId }),
    ...(normalized.status === undefined ? {} : { status: normalized.status }),
    ...(normalized.retryAfterMs === undefined ? {} : { retryAfterMs: normalized.retryAfterMs }),
  });
}

function sameIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.mtimeMs === right.mtimeMs;
}

function sameNode(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

async function inspect(path: string): Promise<Stats | undefined> {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new DomainError(
      "local-file",
      `The local download path could not be inspected: ${path}.`,
      { cause: error },
    );
  }
}

async function destinationFor(name: string, destination: string | undefined): Promise<string> {
  if (destination === undefined || destination === ".") return `./${name}`;
  const current = await inspect(destination);
  if (current?.isSymbolicLink())
    throw new DomainError(
      "local-file",
      "The local download destination cannot be a symbolic link.",
    );
  if (current?.isDirectory()) return join(destination, name);
  if (current !== undefined)
    throw new DomainError("conflict", `The local destination already exists: ${destination}.`);
  if (destination.endsWith("/") || destination.endsWith("\\"))
    throw new DomainError(
      "local-file",
      `The local download directory does not exist: ${destination}.`,
    );
  return destination;
}

async function createLocalDirectory(path: string): Promise<void> {
  try {
    await mkdir(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new DomainError("conflict", `The local destination already exists: ${path}.`, {
        cause: error,
      });
    }
    throw new DomainError(
      "local-file",
      `The local destination directory could not be created: ${path}.`,
      {
        cause: error,
      },
    );
  }
}

export async function runRecursiveDownload(
  remotePath: string,
  localDestination: string | undefined,
  dependencies: DownloadDependencies,
  root: FoundResolution,
): Promise<RecursiveDownloadResult> {
  const parsed = parseRemotePath(remotePath);
  if (parsed.kind === "root")
    throw new DomainError("invalid-arguments", "The MYBOX root cannot be downloaded recursively.");
  if (root.resource.type.toLowerCase() !== "folder")
    throw new DomainError("conflict", "Recursive download requires a remote folder.");
  assertPortableName(root.resource.name);
  const manifest = await buildRemoteTreeManifest(parsed.normalized, root, dependencies.resolver);
  const localRoot = await destinationFor(
    basename(root.resource.name.replaceAll("\\", "/")),
    localDestination,
  );
  const files = manifest.entries.filter((entry) => entry.type === "file");
  const totalBytes = files.reduce((sum, entry) => sum + entry.size, 0);
  const quota = dependencies.downloadQuota ?? { plan: null, isDefault: true, dailyLimit: 500 };
  (dependencies.eventSink ?? noOpEventSink).emit({
    type: "event",
    level: files.length > quota.dailyLimit ? "warning" : "info",
    event: "download.quota-advisory",
    data: {
      plan: quota.plan,
      isDefault: quota.isDefault,
      expectedDownloads: files.length,
      dailyLimit: quota.dailyLimit,
    },
  });

  let rootCreated: boolean | null = false;
  let foldersCompleted = 0;
  let filesCompleted = 0;
  let bytesCompleted = 0;
  const partial = (): PartialTransfer => ({
    direction: "download",
    remoteRootPath: parsed.normalized,
    localRootPath: localRoot,
    rootCreated,
    filesCompleted,
    foldersCompleted,
    supportingFoldersCreated: 0,
    bytesCompleted,
    mutationMayHaveOccurred: rootCreated === null || foldersCompleted > 0 || filesCompleted > 0,
  });
  try {
    if (await inspect(localRoot))
      throw new DomainError("conflict", `The local destination already exists: ${localRoot}.`);
    const parentPath = dirname(localRoot);
    const inspectedParent = await inspect(parentPath);
    if (
      inspectedParent === undefined ||
      !inspectedParent.isDirectory() ||
      inspectedParent.isSymbolicLink()
    )
      throw new DomainError(
        "local-file",
        "The local download destination parent must be an existing real directory.",
      );
    const parentReal = await realpath(parentPath);
    await createLocalDirectory(localRoot);
    rootCreated = true;
    foldersCompleted = 1;
    const directoryStats = new Map<string, Stats>();
    const rootStats = await lstat(localRoot);
    let parentExpected = await lstat(parentPath);
    if (!sameNode(inspectedParent, parentExpected) || (await realpath(parentPath)) !== parentReal) {
      throw new DomainError(
        "local-file-changed",
        "The local destination parent changed while creating the download root.",
      );
    }
    directoryStats.set("", rootStats);
    const assertTree = async (relativeParent: string): Promise<void> => {
      const parentAfter = await lstat(parentPath);
      if (!sameIdentity(parentExpected, parentAfter) || (await realpath(parentPath)) !== parentReal)
        throw new DomainError(
          "local-file-changed",
          "The local destination parent changed during download.",
        );
      const components = relativeParent === "" ? [] : relativeParent.split("/");
      for (let index = 0; index <= components.length; index += 1) {
        const relative = components.slice(0, index).join("/");
        const expected = directoryStats.get(relative);
        if (expected === undefined)
          throw new DomainError("unexpected", "The local destination tree identity was lost.");
        const current = await lstat(
          relative === "" ? localRoot : join(localRoot, ...components.slice(0, index)),
        );
        if (current.isSymbolicLink() || !current.isDirectory() || !sameIdentity(expected, current))
          throw new DomainError(
            "local-file-changed",
            "The local destination tree changed during download.",
          );
      }
    };
    for (const folder of manifest.entries.filter((entry) => entry.type === "folder")) {
      const relativeParent = folder.relativePath.includes("/")
        ? folder.relativePath.slice(0, folder.relativePath.lastIndexOf("/"))
        : "";
      await assertTree(relativeParent);
      const path = join(localRoot, ...folder.relativePath.split("/"));
      await createLocalDirectory(path);
      const localParentPath =
        relativeParent === "" ? localRoot : join(localRoot, ...relativeParent.split("/"));
      directoryStats.set(relativeParent, await lstat(localParentPath));
      directoryStats.set(folder.relativePath, await lstat(path));
      foldersCompleted += 1;
    }
    for (const file of files) {
      const relativeParent = file.relativePath.includes("/")
        ? file.relativePath.slice(0, file.relativePath.lastIndexOf("/"))
        : "";
      await assertTree(relativeParent);
      const remoteFilePath = `${parsed.normalized}/${file.relativePath}`.replace("//", "/");
      const remoteFileParsed = parseRemotePath(remoteFilePath);
      if (remoteFileParsed.kind === "root")
        throw new DomainError("unexpected", "The recursive download file path was invalid.");
      const resolved: FoundResolution = {
        kind: "found",
        path: remoteFileParsed,
        resource: {
          resourceId: file.resourceId,
          name: file.name,
          type: "file",
          parentId: file.parentId,
          size: file.size,
          modifiedAt: file.modifiedAt,
        },
      };
      await runDownload(
        remoteFilePath,
        join(localRoot, ...file.relativePath.split("/")),
        {},
        {
          ...dependencies,
          expectedRemote: file,
          progressContext: {
            relativePath: file.relativePath,
            filesCompleted,
            totalFiles: files.length,
            cumulativeBytes: bytesCompleted,
            totalBytes,
          },
        },
        resolved,
      );
      const localParentPath =
        relativeParent === "" ? localRoot : join(localRoot, ...relativeParent.split("/"));
      directoryStats.set(relativeParent, await lstat(localParentPath));
      parentExpected = await lstat(parentPath);
      filesCompleted += 1;
      bytesCompleted += file.size;
    }
    for (const relativePath of directoryStats.keys()) await assertTree(relativePath);
    const finalManifest = await buildRemoteTreeManifest(
      parsed.normalized,
      root,
      dependencies.resolver,
    );
    if (!sameRemoteTree(manifest, finalManifest))
      throw new DomainError("conflict", "The remote folder changed during download.", {
        code: "REMOTE_CHANGED",
      });
    return {
      action: "downloaded",
      data: {
        type: "folder",
        remotePath: parsed.normalized,
        localPath: localRoot,
        resourceId: root.resource.resourceId,
        filesDownloaded: filesCompleted,
        foldersCreated: foldersCompleted,
        bytesDownloaded: bytesCompleted,
      },
    };
  } catch (error) {
    const current = partial();
    if (current.mutationMayHaveOccurred) throw withPartial(error, current);
    throw error;
  }
}

import { basename, posix } from "node:path";

import { DomainError, normalizeError, type PartialTransfer } from "../errors.ts";
import { parseRemoteDestination } from "../remote/destination.ts";
import { parseRemotePath } from "../remote/path.ts";
import type { RemoteResolver } from "../remote/resolver.ts";
import { runEnsureDir } from "./ensure-dir.ts";
import {
  assertLocalTreeUnchanged,
  assertPortableName,
  buildLocalTreeManifest,
} from "./tree-manifest.ts";
import { runUpload, type UploadDependencies } from "./upload.ts";
import type { UploadCommandOptions } from "./upload-command.ts";

export type RecursiveUploadResult = {
  action: "uploaded";
  data: {
    type: "folder";
    remotePath: string;
    localPath: string;
    resourceId: string;
    filesUploaded: number;
    foldersCreated: number;
    bytesUploaded: number;
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

function remoteJoin(root: string, relativePath: string): string {
  return posix.join(root, ...relativePath.split("/"));
}

async function createExclusiveFolder(
  path: string,
  parentId: string | undefined,
  resolver: RemoteResolver,
): Promise<string> {
  const parsed = parseRemotePath(path);
  if (parsed.kind === "root")
    throw new DomainError("invalid-arguments", "The remote root cannot be a transfer root.");
  const existing = await resolver.resolveForMutation(parsed);
  if (existing.kind === "found")
    throw new DomainError("conflict", `A remote resource already exists at ${path}.`);
  try {
    const created = await resolver.createFolder({
      folderName: parsed.basename,
      ...(parentId === undefined ? {} : { parentId }),
    });
    if (created.name !== parsed.basename) {
      throw new DomainError(
        "api-unavailable",
        `Creation of ${path} returned an uncertain result.`,
        {
          code: "FOLDER_CREATION_UNCERTAIN",
        },
      );
    }
    return created.resourceId;
  } catch (error) {
    const normalized = normalizeError(error);
    if (normalized.status === 409)
      throw new DomainError("conflict", `A remote resource already exists at ${path}.`, {
        cause: error,
      });
    if (normalized.retryable || normalized.code === "API_RESPONSE_INVALID") {
      let found = false;
      try {
        const reconciled = await resolver.resolveForMutation(parsed, { poll: true });
        found = reconciled.kind === "found";
      } catch {
        // The original mutation outcome remains authoritative and uncertain.
      }
      throw new DomainError(
        "api-unavailable",
        found
          ? `Creation of ${path} may have succeeded, but ownership is uncertain.`
          : `Creation of ${path} has an uncertain outcome.`,
        { code: "FOLDER_CREATION_UNCERTAIN", retryable: false, cause: error },
      );
    }
    throw error;
  }
}

async function resolveRecursiveUploadRoot(
  localPath: string,
  remoteDestination: string | undefined,
  options: UploadCommandOptions,
  resolver: RemoteResolver,
): Promise<string> {
  const name = basename(localPath);
  assertPortableName(name);
  if (remoteDestination === undefined || remoteDestination === "/") return `/${name}`;
  const destination = parseRemoteDestination(remoteDestination);
  if (destination.path.kind === "root") return `/${name}`;
  const resolved = await resolver.resolveCanonical(destination.path);
  if (resolved.kind === "found") {
    if (resolved.resource.type.toLowerCase() !== "folder") {
      throw new DomainError(
        "conflict",
        `The recursive upload destination is not a directory: ${destination.path.normalized}.`,
      );
    }
    return `${destination.path.normalized}/${name}`;
  }
  if (destination.directoryIntent) {
    if (!options.mkdir) {
      throw new DomainError(
        "not-found",
        `The remote upload directory was not found: ${destination.path.normalized}.`,
      );
    }
    return `${destination.path.normalized}/${name}`;
  }
  return destination.path.normalized;
}

export async function runRecursiveUpload(
  localPath: string,
  remoteDestination: string | undefined,
  options: UploadCommandOptions,
  dependencies: UploadDependencies,
): Promise<RecursiveUploadResult> {
  if (options.force)
    throw new DomainError(
      "invalid-arguments",
      "--force cannot be used for recursive folder upload.",
    );
  const manifest = await buildLocalTreeManifest(localPath);
  const remoteRoot = await resolveRecursiveUploadRoot(
    localPath,
    remoteDestination,
    options,
    dependencies.resolver,
  );
  const parsedRoot = parseRemotePath(remoteRoot);
  if (parsedRoot.kind === "root")
    throw new DomainError("unexpected", "The recursive upload target was invalid.");

  let supportingFoldersCreated = 0;
  let rootCreated: boolean | null = false;
  let filesCompleted = 0;
  let foldersCompleted = 0;
  let bytesCompleted = 0;
  const partial = (): PartialTransfer => ({
    direction: "upload",
    remoteRootPath: remoteRoot,
    localRootPath: localPath,
    rootCreated,
    filesCompleted,
    foldersCompleted,
    supportingFoldersCreated,
    bytesCompleted,
    mutationMayHaveOccurred:
      rootCreated === null ||
      foldersCompleted > 0 ||
      filesCompleted > 0 ||
      supportingFoldersCreated > 0,
  });

  try {
    await assertLocalTreeUnchanged(manifest);
    let parentId: string | undefined;
    const parentPath = posix.dirname(remoteRoot);
    if (parentPath !== "/") {
      if (options.mkdir) {
        const ensured = await runEnsureDir(parentPath, dependencies.resolver);
        supportingFoldersCreated = ensured.data.createdPaths.length;
        parentId = ensured.data.resourceId ?? undefined;
      } else {
        const parent = await dependencies.resolver.resolveCanonical(parentPath);
        if (parent.kind !== "found" || parent.resource.type.toLowerCase() !== "folder")
          throw new DomainError(
            "not-found",
            `The remote parent directory was not found: ${parentPath}.`,
          );
        parentId = parent.resource.resourceId;
      }
    }
    try {
      parentId = await createExclusiveFolder(remoteRoot, parentId, dependencies.resolver);
      rootCreated = true;
      foldersCompleted = 1;
    } catch (error) {
      if (normalizeError(error).code === "FOLDER_CREATION_UNCERTAIN") rootCreated = null;
      throw error;
    }

    const folderIds = new Map<string, string>([["", parentId]]);
    for (const entry of manifest.entries.filter((item) => item.type === "folder")) {
      const relativeParent =
        posix.dirname(entry.relativePath) === "." ? "" : posix.dirname(entry.relativePath);
      const entryParentId = folderIds.get(relativeParent);
      if (entryParentId === undefined)
        throw new DomainError("unexpected", "The recursive upload lost a parent folder ID.");
      const id = await createExclusiveFolder(
        remoteJoin(remoteRoot, entry.relativePath),
        entryParentId,
        dependencies.resolver,
      );
      folderIds.set(entry.relativePath, id);
      foldersCompleted += 1;
    }
    for (const entry of manifest.entries.filter((item) => item.type === "file")) {
      await assertLocalTreeUnchanged(manifest);
      const relativeParent =
        posix.dirname(entry.relativePath) === "." ? "" : posix.dirname(entry.relativePath);
      const entryParentId = folderIds.get(relativeParent);
      if (entryParentId === undefined)
        throw new DomainError("unexpected", "The recursive upload lost a parent folder ID.");
      const remotePath = remoteJoin(remoteRoot, entry.relativePath);
      const parsed = parseRemotePath(remotePath);
      if (parsed.kind === "root")
        throw new DomainError("unexpected", "The recursive file target was invalid.");
      await runUpload(
        entry.path,
        remotePath,
        {},
        dependencies,
        { kind: "absent", path: parsed, resource: null },
        { parentId: entryParentId, expectedFile: entry.identity },
      );
      filesCompleted += 1;
      bytesCompleted += entry.identity.size;
    }
    await assertLocalTreeUnchanged(manifest);
    return {
      action: "uploaded",
      data: {
        type: "folder",
        remotePath: remoteRoot,
        localPath,
        resourceId: parentId,
        filesUploaded: filesCompleted,
        foldersCreated: foldersCompleted,
        bytesUploaded: bytesCompleted,
      },
    };
  } catch (error) {
    const current = partial();
    if (current.mutationMayHaveOccurred) throw withPartial(error, current);
    throw error;
  }
}

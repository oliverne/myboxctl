import { posix } from "node:path";

import { DomainError, type PartialTransfer } from "../errors.ts";
import { parseRemotePath } from "../remote/path.ts";
import { runEnsureDir } from "./ensure-dir.ts";
import {
  createExclusiveFolder,
  type RecursiveUploadResult,
  remoteJoin,
  resolveRecursiveUploadRoot,
  withPartial,
} from "./recursive-upload.ts";
import {
  assertLocalTreeUnchanged,
  buildLocalTreeManifest,
  buildRemoteTreeManifest,
  type LocalTreeManifest,
  type RemoteTreeEntry,
} from "./tree-manifest.ts";
import { runUpload, type UploadDependencies } from "./upload.ts";
import {
  acquireCheckpointLock,
  commitCheckpointFile,
  createCheckpointFile,
  createInitialCheckpoint,
  manifestFingerprint,
  readCheckpointFile,
  removeCheckpointFile,
  type UploadCheckpoint,
} from "./upload-checkpoint.ts";
import type { UploadCommandOptions } from "./upload-command.ts";

type CheckpointRun = {
  path: string;
  data: UploadCheckpoint;
};

export type CheckpointedUploadDependencies = UploadDependencies;

function localFileError(message: string, code: string): DomainError {
  return new DomainError("local-file", message, { code });
}

function conflict(message: string, code: string): DomainError {
  return new DomainError("conflict", message, { code });
}

function uncertain(message: string): DomainError {
  return new DomainError("api-unavailable", message, { code: "RESUME_UNCERTAIN" });
}

function relativeParent(relativePath: string): string {
  const parent = posix.dirname(relativePath);
  return parent === "." ? "" : parent;
}

async function commit(run: CheckpointRun, clock: () => Date): Promise<void> {
  run.data.updatedAt = clock().toISOString();
  await commitCheckpointFile(run.path, run.data);
}

function partialFrom(
  run: CheckpointRun,
  remoteRoot: string,
  localPath: string,
  supportingFoldersCreated: number,
): PartialTransfer {
  const files = Object.values(run.data.files);
  const folders = Object.keys(run.data.folders);
  const rootInFlight =
    run.data.inFlight?.kind === "folder" && run.data.inFlight.relativePath === "";
  return {
    direction: "upload",
    remoteRootPath: remoteRoot,
    localRootPath: localPath,
    rootCreated: run.data.remote.rootResourceId === null ? (rootInFlight ? null : false) : true,
    filesCompleted: files.length,
    foldersCompleted: folders.length,
    supportingFoldersCreated,
    bytesCompleted: files.reduce((total, file) => total + file.size, 0),
    mutationMayHaveOccurred:
      run.data.remote.rootResourceId !== null ||
      folders.length > 0 ||
      files.length > 0 ||
      run.data.inFlight !== null ||
      supportingFoldersCreated > 0,
  };
}

/**
 * Verifies every completed folder/file record against a freshly listed remote tree and rejects
 * remote entries this checkpoint does not own. Any in-flight path is resolved by the caller.
 */
function verifyRemoteEntries(
  checkpoint: UploadCheckpoint,
  entries: readonly RemoteTreeEntry[],
): void {
  const byPath = new Map(entries.map((entry) => [entry.relativePath, entry]));
  for (const [relativePath, folder] of Object.entries(checkpoint.folders)) {
    if (relativePath === "") continue;
    const entry = byPath.get(relativePath);
    if (
      entry === undefined ||
      entry.type !== "folder" ||
      entry.resourceId !== folder.resourceId ||
      entry.name !== folder.name ||
      entry.parentId !== folder.parentId
    ) {
      throw conflict(
        `The remote transfer tree does not match the checkpoint at ${relativePath}.`,
        "RESUME_REMOTE_MISMATCH",
      );
    }
  }
  for (const [relativePath, file] of Object.entries(checkpoint.files)) {
    const entry = byPath.get(relativePath);
    if (
      entry === undefined ||
      entry.type !== "file" ||
      entry.resourceId !== file.resourceId ||
      entry.name !== file.name ||
      entry.parentId !== file.parentId ||
      entry.size !== file.size ||
      entry.modifiedAt !== file.modifiedAt
    ) {
      throw conflict(
        `The remote transfer tree does not match the checkpoint at ${relativePath}.`,
        "RESUME_REMOTE_MISMATCH",
      );
    }
  }
  for (const entry of entries) {
    if (
      Object.hasOwn(checkpoint.folders, entry.relativePath) ||
      Object.hasOwn(checkpoint.files, entry.relativePath)
    ) {
      continue;
    }
    if (checkpoint.inFlight !== null && checkpoint.inFlight.relativePath === entry.relativePath) {
      continue;
    }
    throw conflict(
      `The remote transfer tree contains an entry this checkpoint does not own: ${entry.relativePath}.`,
      "RESUME_REMOTE_UNEXPECTED",
    );
  }
}

async function prepareResume(
  run: CheckpointRun,
  manifest: LocalTreeManifest,
  remoteRoot: string,
  dependencies: UploadDependencies,
  clock: () => Date,
): Promise<void> {
  const checkpoint = run.data;
  if (checkpoint.state !== "in-progress") {
    throw localFileError(
      `The upload checkpoint is already completed: ${run.path}.`,
      "CHECKPOINT_COMPLETED",
    );
  }
  if (checkpoint.remote.rootPath !== remoteRoot) {
    throw conflict(
      `The checkpoint belongs to a different remote root: ${checkpoint.remote.rootPath}.`,
      "RESUME_ROOT_MISMATCH",
    );
  }
  if (
    checkpoint.localRoot.realPath !== manifest.rootRealPath ||
    JSON.stringify(checkpoint.localRoot.identity) !== JSON.stringify(manifest.rootIdentity) ||
    checkpoint.manifestFingerprint !== manifestFingerprint(manifest)
  ) {
    throw new DomainError(
      "local-file-changed",
      "The local upload tree does not match the checkpoint.",
      { code: "RESUME_LOCAL_MISMATCH" },
    );
  }

  const parsed = parseRemotePath(remoteRoot);
  if (parsed.kind === "root") {
    throw new DomainError("unexpected", "The recursive upload target was invalid.");
  }
  const rootResolution = await dependencies.resolver.resolveForMutation(parsed, { poll: true });

  if (checkpoint.remote.rootResourceId === null) {
    if (rootResolution.kind !== "absent") {
      throw uncertain(
        "The transfer root may have been created before the checkpoint committed, so its ownership is uncertain.",
      );
    }
    checkpoint.inFlight = null;
    await commit(run, clock);
    return;
  }

  if (rootResolution.kind !== "found") {
    throw conflict(
      "The checkpoint transfer root is missing from the remote drive.",
      "RESUME_ROOT_MISSING",
    );
  }
  if (rootResolution.resource.resourceId !== checkpoint.remote.rootResourceId) {
    throw conflict(
      "The remote resource at the transfer root does not match the checkpoint.",
      "RESUME_ROOT_MISMATCH",
    );
  }
  const detail = await dependencies.client.getResource(checkpoint.remote.rootResourceId);
  if (
    detail.resourceId !== checkpoint.remote.rootResourceId ||
    detail.type.toLowerCase() !== "folder" ||
    detail.name !== posix.basename(remoteRoot)
  ) {
    throw conflict(
      "The remote transfer root metadata does not match the checkpoint.",
      "RESUME_ROOT_MISMATCH",
    );
  }

  const remoteManifest = await buildRemoteTreeManifest(
    remoteRoot,
    rootResolution,
    dependencies.resolver,
  );
  verifyRemoteEntries(checkpoint, remoteManifest.entries);

  if (checkpoint.inFlight !== null) {
    const inFlight = checkpoint.inFlight;
    const found = remoteManifest.entries.find(
      (entry) => entry.relativePath === inFlight.relativePath,
    );
    if (found !== undefined) {
      throw uncertain(
        `The ${inFlight.kind} mutation for ${inFlight.relativePath || "/"} may have completed, but the checkpoint never recorded its resource ID.`,
      );
    }
    checkpoint.inFlight = null;
    await commit(run, clock);
  }
}

async function verifyFinalRemoteTree(
  run: CheckpointRun,
  remoteRoot: string,
  dependencies: UploadDependencies,
): Promise<void> {
  const rootResourceId = run.data.remote.rootResourceId;
  if (rootResourceId === null) {
    throw new DomainError("unexpected", "The recursive upload completed without a remote root ID.");
  }
  const parsed = parseRemotePath(remoteRoot);
  if (parsed.kind === "root") {
    throw new DomainError("unexpected", "The recursive upload target was invalid.");
  }
  const resolution = await dependencies.resolver.resolveForMutation(parsed, { poll: true });
  if (resolution.kind !== "found" || resolution.resource.resourceId !== rootResourceId) {
    throw conflict(
      "The remote transfer root changed while the upload was running.",
      "RESUME_REMOTE_MISMATCH",
    );
  }
  const remoteManifest = await buildRemoteTreeManifest(
    remoteRoot,
    resolution,
    dependencies.resolver,
  );
  verifyRemoteEntries(run.data, remoteManifest.entries);
}

export async function runCheckpointedRecursiveUpload(
  checkpointPath: string,
  resume: boolean,
  localPath: string,
  remoteDestination: string | undefined,
  options: UploadCommandOptions,
  dependencies: UploadDependencies,
): Promise<RecursiveUploadResult> {
  const now = dependencies.now ?? (() => Date.now());
  const clock = () => new Date(now());
  const manifest = await buildLocalTreeManifest(localPath);
  const remoteRoot = await resolveRecursiveUploadRoot(
    localPath,
    remoteDestination,
    options,
    dependencies.resolver,
  );
  const parsedRoot = parseRemotePath(remoteRoot);
  if (parsedRoot.kind === "root") {
    throw new DomainError("unexpected", "The recursive upload target was invalid.");
  }

  const lock = await acquireCheckpointLock(checkpointPath);
  let run: CheckpointRun | undefined;
  let supportingFoldersCreated = 0;
  let filesUploaded = 0;
  let foldersCreated = 0;
  let bytesUploaded = 0;

  try {
    if (resume) {
      run = { path: checkpointPath, data: await readCheckpointFile(checkpointPath) };
      await prepareResume(run, manifest, remoteRoot, dependencies, clock);
    } else {
      run = {
        path: checkpointPath,
        data: createInitialCheckpoint(manifest, remoteRoot, clock),
      };
      await createCheckpointFile(checkpointPath, run.data);
    }

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
        if (parent.kind !== "found" || parent.resource.type.toLowerCase() !== "folder") {
          throw new DomainError(
            "not-found",
            `The remote parent directory was not found: ${parentPath}.`,
          );
        }
        parentId = parent.resource.resourceId;
      }
    }

    let rootId = run.data.remote.rootResourceId;
    if (rootId === null) {
      const rootName = posix.basename(remoteRoot);
      run.data.inFlight = {
        kind: "folder",
        relativePath: "",
        parentId: parentId ?? null,
        name: rootName,
      };
      await commit(run, clock);
      rootId = await createExclusiveFolder(remoteRoot, parentId, dependencies.resolver);
      run.data.folders[""] = { resourceId: rootId, parentId: parentId ?? null, name: rootName };
      run.data.remote.rootResourceId = rootId;
      run.data.inFlight = null;
      await commit(run, clock);
      foldersCreated += 1;
    }

    const folderIds = new Map<string, string>([["", rootId]]);
    for (const [relativePath, record] of Object.entries(run.data.folders)) {
      if (relativePath !== "") folderIds.set(relativePath, record.resourceId);
    }

    for (const entry of manifest.entries.filter((item) => item.type === "folder")) {
      if (run.data.folders[entry.relativePath] !== undefined) continue;
      const entryParentId = folderIds.get(relativeParent(entry.relativePath));
      if (entryParentId === undefined) {
        throw new DomainError("unexpected", "The recursive upload lost a parent folder ID.");
      }
      run.data.inFlight = {
        kind: "folder",
        relativePath: entry.relativePath,
        parentId: entryParentId,
        name: entry.name,
      };
      await commit(run, clock);
      const id = await createExclusiveFolder(
        remoteJoin(remoteRoot, entry.relativePath),
        entryParentId,
        dependencies.resolver,
      );
      run.data.folders[entry.relativePath] = {
        resourceId: id,
        parentId: entryParentId,
        name: entry.name,
      };
      run.data.inFlight = null;
      await commit(run, clock);
      folderIds.set(entry.relativePath, id);
      foldersCreated += 1;
    }

    for (const entry of manifest.entries.filter((item) => item.type === "file")) {
      if (run.data.files[entry.relativePath] !== undefined) continue;
      await assertLocalTreeUnchanged(manifest);
      const entryParentId = folderIds.get(relativeParent(entry.relativePath));
      if (entryParentId === undefined) {
        throw new DomainError("unexpected", "The recursive upload lost a parent folder ID.");
      }
      const remotePath = remoteJoin(remoteRoot, entry.relativePath);
      const parsed = parseRemotePath(remotePath);
      if (parsed.kind === "root") {
        throw new DomainError("unexpected", "The recursive file target was invalid.");
      }
      run.data.inFlight = {
        kind: "file",
        relativePath: entry.relativePath,
        parentId: entryParentId,
        name: entry.name,
        local: entry.identity,
      };
      await commit(run, clock);
      const result = await runUpload(
        entry.path,
        remotePath,
        {},
        dependencies,
        { kind: "absent", path: parsed, resource: null },
        { parentId: entryParentId, expectedFile: entry.identity },
      );
      run.data.files[entry.relativePath] = {
        resourceId: result.data.resourceId,
        parentId: entryParentId,
        name: entry.name,
        size: result.data.size,
        modifiedAt: result.data.modifiedAt,
        local: entry.identity,
      };
      run.data.inFlight = null;
      await commit(run, clock);
      filesUploaded += 1;
      bytesUploaded += entry.identity.size;
    }

    await assertLocalTreeUnchanged(manifest);
    await verifyFinalRemoteTree(run, remoteRoot, dependencies);
    run.data.state = "completed";
    run.data.inFlight = null;
    await commit(run, clock);
    await removeCheckpointFile(run.path);

    const completedFiles = Object.values(run.data.files);
    return {
      action: "uploaded",
      data: {
        type: "folder",
        remotePath: remoteRoot,
        localPath,
        resourceId: rootId,
        filesUploaded,
        foldersCreated,
        bytesUploaded,
        filesSkipped: completedFiles.length - filesUploaded,
        foldersSkipped: Object.keys(run.data.folders).length - foldersCreated,
        bytesSkipped: completedFiles.reduce((total, file) => total + file.size, 0) - bytesUploaded,
        checkpointPath: run.path,
        resumed: resume,
      },
    };
  } catch (error) {
    if (run === undefined) throw error;
    const partial = partialFrom(run, remoteRoot, localPath, supportingFoldersCreated);
    if (partial.mutationMayHaveOccurred) throw withPartial(error, partial);
    throw error;
  } finally {
    await lock.release();
  }
}

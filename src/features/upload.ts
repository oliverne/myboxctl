import type { Stats } from "node:fs";
import { type FileHandle, lstat, open } from "node:fs/promises";

import { apiResponseError, DomainError, normalizeError } from "../errors.ts";
import type { CreateUploadInput, MyboxClient } from "../mybox/client.ts";
import type { UploadContentResponse } from "../mybox/contract.ts";
import type { MyboxUploader } from "../mybox/upload.ts";
import { type EventSink, noOpEventSink } from "../observability.ts";
import { type ChildRemotePath, canonicalRemotePath, parseRemotePath } from "../remote/path.ts";
import type { FoundResolution, PathResolution, RemoteResolver } from "../remote/resolver.ts";
import { runEnsureDir } from "./ensure-dir.ts";

export type UploadOptions = {
  overwrite?: boolean;
  mkdir?: boolean;
};

export type UploadDependencies = {
  client: MyboxClient;
  resolver: RemoteResolver;
  uploader: MyboxUploader;
  timeoutMs: number;
  eventSink?: EventSink;
  now?: () => number;
  signal?: AbortSignal;
};

export type UploadData = {
  path: string;
  resourceId: string;
  size: number;
  modifiedAt: string;
};

export type UploadResult = {
  action: "uploaded" | "overwritten";
  data: UploadData;
};

export type UploadExecutionHints = {
  parentId?: string;
  expectedFile?: { dev: number; ino: number; size: number; mtimeMs: number };
};

function localFileError(message: string, cause?: unknown): DomainError {
  return new DomainError("local-file", message, { cause, retryable: false });
}

async function openLocalFile(path: string): Promise<{ handle: FileHandle; stats: Stats }> {
  let handle: FileHandle;
  try {
    handle = await open(path, "r");
  } catch (error) {
    throw localFileError(`The local upload file could not be opened: ${path}.`, error);
  }

  try {
    const stats = await handle.stat();
    if (!stats.isFile()) {
      throw localFileError(`The local upload path is not a regular file: ${path}.`);
    }
    if (!Number.isSafeInteger(stats.size) || stats.size < 0) {
      throw localFileError(`The local upload file size is unsupported: ${path}.`);
    }
    return { handle, stats };
  } catch (error) {
    await handle.close();
    if (error instanceof DomainError) {
      throw error;
    }
    throw localFileError(`The local upload file could not be inspected: ${path}.`, error);
  }
}

async function assertWithinStorageLimit(fileSize: number, client: MyboxClient): Promise<void> {
  const storage = await client.getStorage();
  if (fileSize > storage.maxFileBytes) {
    throw new DomainError(
      "invalid-arguments",
      "The local upload file exceeds the MYBOX maximum file size.",
      { code: "FILE_TOO_LARGE" },
    );
  }
}

function isFolder(resolution: FoundResolution): boolean {
  return resolution.resource.type.toLowerCase() === "folder";
}

async function resolveParentId(
  target: ChildRemotePath,
  options: UploadOptions,
  resolver: RemoteResolver,
): Promise<string | undefined> {
  const parent = parseRemotePath(target.parentPath);
  if (parent.kind === "root") {
    return undefined;
  }

  if (options.mkdir) {
    const ensured = await runEnsureDir(parent.normalized, resolver);
    if (ensured.data.resourceId === null) {
      throw new DomainError("unexpected", "The upload parent directory has no resource ID.");
    }
    return ensured.data.resourceId;
  }

  const resolution = await resolver.resolveCanonical(parent);
  if (resolution.kind === "absent") {
    throw new DomainError(
      "not-found",
      `The remote parent directory was not found: ${parent.normalized}.`,
    );
  }
  if (resolution.kind === "root") {
    return undefined;
  }
  if (!isFolder(resolution)) {
    throw new DomainError(
      "conflict",
      `The remote upload parent is not a directory: ${parent.normalized}.`,
    );
  }
  return resolution.resource.resourceId;
}

function reservationOffset(offset: number | undefined, fileSize: number): number {
  const value = offset ?? 0;
  if (!Number.isSafeInteger(value) || value < 0 || value > fileSize) {
    throw apiResponseError("MYBOX returned an invalid upload offset.");
  }
  return value;
}

async function postconditionFromId(
  resourceId: string,
  target: ChildRemotePath,
  fileSize: number,
  client: MyboxClient,
): Promise<UploadData> {
  const detail = await client.getResource(resourceId);
  if (
    detail.resourceId !== resourceId ||
    detail.type.toLowerCase() !== "file" ||
    detail.name !== target.basename ||
    detail.size !== fileSize
  ) {
    throw apiResponseError("MYBOX upload postcondition did not match the local file.");
  }
  return {
    path: target.normalized,
    resourceId,
    size: detail.size,
    modifiedAt: detail.modifiedAt,
  };
}

async function postconditionWithoutResponse(
  target: ChildRemotePath,
  fileSize: number,
  dependencies: UploadDependencies,
): Promise<UploadData> {
  const resolution = await dependencies.resolver.resolveFileExact(target, { poll: true });
  if (resolution.kind !== "found") {
    throw apiResponseError("MYBOX did not expose the completed upload.");
  }
  return postconditionFromId(resolution.resource.resourceId, target, fileSize, dependencies.client);
}

function assertContentResponse(
  response: UploadContentResponse,
  target: ChildRemotePath,
  fileSize: number,
): void {
  if (response.name !== target.basename || response.fileSize !== fileSize) {
    throw apiResponseError("MYBOX upload completion did not match the local file.");
  }
}

function stableFile(before: Stats, after: Stats): boolean {
  return (
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.size === after.size &&
    before.mtimeMs === after.mtimeMs
  );
}

function matchesExpectedFile(
  stats: Stats,
  expected: NonNullable<UploadExecutionHints["expectedFile"]>,
): boolean {
  return (
    stats.dev === expected.dev &&
    stats.ino === expected.ino &&
    stats.size === expected.size &&
    stats.mtimeMs === expected.mtimeMs
  );
}

function targetWithName(target: ChildRemotePath, name: string): ChildRemotePath {
  const path = target.parentPath === "/" ? `/${name}` : `${target.parentPath}/${name}`;
  const parsed = parseRemotePath(path);
  if (parsed.kind === "root") {
    throw new DomainError("unexpected", "The effective upload target was invalid.");
  }
  return parsed;
}

export async function runUpload(
  localPath: string,
  remotePath: string,
  options: UploadOptions,
  dependencies: UploadDependencies,
  targetResolution?: PathResolution,
  hints: UploadExecutionHints = {},
): Promise<UploadResult> {
  const eventSink = dependencies.eventSink ?? noOpEventSink;
  const now = dependencies.now ?? (() => Date.now());
  const transferSignal = () => {
    const timeout = AbortSignal.timeout(dependencies.timeoutMs);
    return dependencies.signal === undefined
      ? timeout
      : AbortSignal.any([dependencies.signal, timeout]);
  };
  const startStage = (stage: "reservation" | "transfer" | "postcondition") => {
    const startedAt = now();
    eventSink.emit({
      type: "event",
      level: "info",
      event: "upload.stage-started",
      data: { stage },
    });
    return () =>
      eventSink.emit({
        type: "event",
        level: "info",
        event: "upload.stage-completed",
        data: { stage, elapsedMs: Math.max(0, now() - startedAt) },
      });
  };
  const target = parseRemotePath(remotePath);
  if (target.kind === "root") {
    throw new DomainError(
      "invalid-arguments",
      "A file cannot be uploaded to the remote root path.",
    );
  }

  if (hints.expectedFile !== undefined) {
    const pathStats = await lstat(localPath).catch((error) => {
      throw new DomainError(
        "local-file-changed",
        "The local upload file changed after the tree manifest was built.",
        { cause: error },
      );
    });
    if (
      pathStats.isSymbolicLink() ||
      !pathStats.isFile() ||
      !matchesExpectedFile(pathStats, hints.expectedFile)
    ) {
      throw new DomainError(
        "local-file-changed",
        "The local upload file changed after the tree manifest was built.",
      );
    }
  }
  const local = await openLocalFile(localPath);
  try {
    if (hints.expectedFile !== undefined && !matchesExpectedFile(local.stats, hints.expectedFile)) {
      throw new DomainError(
        "local-file-changed",
        "The local upload file changed after the tree manifest was built.",
      );
    }
    await assertWithinStorageLimit(local.stats.size, dependencies.client);
    const parentId =
      hints.parentId ?? (await resolveParentId(target, options, dependencies.resolver));
    const existing = targetResolution ?? (await dependencies.resolver.resolveForMutation(target));
    if (existing.kind === "root") {
      throw new DomainError("unexpected", "The upload target resolution was invalid.");
    }
    if (existing.kind === "found" && isFolder(existing)) {
      throw new DomainError(
        "conflict",
        `A remote directory already exists at ${target.normalized}.`,
      );
    }
    if (existing.kind === "found" && !options.overwrite) {
      throw new DomainError("conflict", `A remote file already exists at ${target.normalized}.`);
    }

    const action = existing.kind === "found" ? "overwritten" : "uploaded";
    const canonicalTarget = canonicalRemotePath(target);
    if (canonicalTarget.kind === "root") {
      throw new DomainError("unexpected", "The canonical upload target was invalid.");
    }
    const effectiveTarget =
      existing.kind === "found"
        ? targetWithName(canonicalTarget, existing.resource.name)
        : canonicalTarget;
    const modifiedTime = new Date(local.stats.mtimeMs).toISOString();
    const reservationInput: CreateUploadInput = {
      fileName: effectiveTarget.basename,
      fileSize: local.stats.size,
      isOverwrite: action === "overwritten",
      resume: true,
      modifiedTime,
      ...(parentId === undefined ? {} : { parentId }),
    };

    let finishStage = startStage("reservation");
    let reservation = await dependencies.client.createUpload(reservationInput);
    finishStage();
    let offset = reservationOffset(reservation.offset, local.stats.size);
    if (offset > 0) {
      eventSink.emit({
        type: "event",
        level: "warning",
        event: "upload.resume",
        data: { offset, totalBytes: local.stats.size },
      });
    }
    let completion: UploadContentResponse | undefined;
    if (offset < local.stats.size || local.stats.size === 0) {
      try {
        finishStage = startStage("transfer");
        completion = await dependencies.uploader.uploadContent({
          uploadUrl: reservation.uploadUrl,
          fileHandle: local.handle,
          fileName: effectiveTarget.basename,
          fileSize: local.stats.size,
          offset,
          resume: offset > 0,
          signal: transferSignal(),
        });
        finishStage();
      } catch (error) {
        const failure = normalizeError(error);
        if (!failure.retryable) {
          throw failure;
        }

        finishStage = startStage("reservation");
        reservation = await dependencies.client.createUpload(reservationInput);
        finishStage();
        offset = reservationOffset(reservation.offset, local.stats.size);
        eventSink.emit({
          type: "event",
          level: "warning",
          event: "upload.resume",
          data: { offset, totalBytes: local.stats.size },
        });
        if (offset < local.stats.size || local.stats.size === 0) {
          finishStage = startStage("transfer");
          completion = await dependencies.uploader.uploadContent({
            uploadUrl: reservation.uploadUrl,
            fileHandle: local.handle,
            fileName: effectiveTarget.basename,
            fileSize: local.stats.size,
            offset,
            resume: true,
            signal: transferSignal(),
          });
          finishStage();
        }
      }
    }

    finishStage = startStage("postcondition");
    let data: UploadData;
    if (completion === undefined) {
      data = await postconditionWithoutResponse(effectiveTarget, local.stats.size, dependencies);
    } else {
      assertContentResponse(completion, effectiveTarget, local.stats.size);
      data = await postconditionFromId(
        completion.resourceId,
        effectiveTarget,
        local.stats.size,
        dependencies.client,
      );
    }
    finishStage();

    let after: Stats;
    try {
      after = await local.handle.stat();
    } catch (error) {
      throw new DomainError(
        "local-file-changed",
        "The local upload file could not be inspected after the upload.",
        { cause: error },
      );
    }
    if (!stableFile(local.stats, after)) {
      throw new DomainError(
        "local-file-changed",
        "The local upload file changed while it was being uploaded.",
      );
    }

    return { action, data };
  } finally {
    await local.handle.close();
  }
}

export const upload = runUpload;

import { randomUUID } from "node:crypto";
import { lstat, open, readFile, rename, rm, unlink } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname } from "node:path";
import { z } from "zod";

import { DomainError } from "../errors.ts";
import type { LocalTreeManifest } from "./tree-manifest.ts";

const identitySchema = z.strictObject({
  dev: z.number(),
  ino: z.number(),
  mtimeMs: z.number(),
});

const fileIdentitySchema = z.strictObject({
  dev: z.number(),
  ino: z.number(),
  mtimeMs: z.number(),
  size: z.number().int().nonnegative(),
});

const checkpointFolderSchema = z.strictObject({
  resourceId: z.string().min(1),
  parentId: z.string().min(1).nullable(),
  name: z.string().min(1),
});

const checkpointFileSchema = z.strictObject({
  resourceId: z.string().min(1),
  parentId: z.string().min(1),
  name: z.string().min(1),
  size: z.number().int().nonnegative(),
  modifiedAt: z.string().min(1),
  local: fileIdentitySchema,
});

const inFlightSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("folder"),
    relativePath: z.string(),
    parentId: z.string().min(1).nullable(),
    name: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal("file"),
    relativePath: z.string().min(1),
    parentId: z.string().min(1),
    name: z.string().min(1),
    local: fileIdentitySchema,
  }),
]);

export const uploadCheckpointSchema = z.strictObject({
  schemaVersion: z.literal(1),
  command: z.literal("upload"),
  state: z.enum(["in-progress", "completed"]),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  localRoot: z.strictObject({
    path: z.string().min(1),
    realPath: z.string().min(1),
    identity: identitySchema,
  }),
  manifestFingerprint: z.string().min(1),
  remote: z.strictObject({
    rootPath: z.string().min(1),
    rootResourceId: z.string().min(1).nullable(),
  }),
  folders: z.record(z.string(), checkpointFolderSchema),
  files: z.record(z.string(), checkpointFileSchema),
  inFlight: inFlightSchema.nullable(),
});

export type UploadCheckpoint = z.infer<typeof uploadCheckpointSchema>;
export type UploadCheckpointFolder = z.infer<typeof checkpointFolderSchema>;
export type UploadCheckpointFile = z.infer<typeof checkpointFileSchema>;
export type UploadCheckpointInFlight = z.infer<typeof inFlightSchema>;
export type UploadCheckpointIdentity = z.infer<typeof identitySchema>;

function localFileError(message: string, cause?: unknown, code?: string): DomainError {
  return new DomainError("local-file", message, {
    cause,
    ...(code === undefined ? {} : { code }),
  });
}

export function manifestFingerprint(manifest: LocalTreeManifest): string {
  const canonical = {
    rootRealPath: manifest.rootRealPath,
    rootIdentity: manifest.rootIdentity,
    entries: manifest.entries.map((entry) => ({
      type: entry.type,
      relativePath: entry.relativePath,
      name: entry.name,
      identity: entry.identity,
    })),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(canonical));
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(bytes);
  return hasher.digest("hex");
}

export function createInitialCheckpoint(
  manifest: LocalTreeManifest,
  remoteRootPath: string,
  now: () => Date,
): UploadCheckpoint {
  const timestamp = now().toISOString();
  return {
    schemaVersion: 1,
    command: "upload",
    state: "in-progress",
    createdAt: timestamp,
    updatedAt: timestamp,
    localRoot: {
      path: manifest.rootPath,
      realPath: manifest.rootRealPath,
      identity: manifest.rootIdentity,
    },
    manifestFingerprint: manifestFingerprint(manifest),
    remote: { rootPath: remoteRootPath, rootResourceId: null },
    folders: {},
    files: {},
    inFlight: null,
  };
}

function serializeCheckpoint(checkpoint: UploadCheckpoint): string {
  return `${JSON.stringify(checkpoint)}\n`;
}

function assertValidCheckpoint(value: unknown, path: string): UploadCheckpoint {
  const parsed = uploadCheckpointSchema.safeParse(value);
  if (!parsed.success) {
    throw localFileError(
      `The upload checkpoint is not a valid myboxctl checkpoint: ${path}.`,
      parsed.error,
      "CHECKPOINT_INVALID",
    );
  }
  return parsed.data;
}

async function assertCheckpointParent(path: string): Promise<void> {
  const parent = dirname(path);
  let stats: Awaited<ReturnType<typeof lstat>>;
  try {
    stats = await lstat(parent);
  } catch (error) {
    throw localFileError(
      `The upload checkpoint directory does not exist: ${parent}.`,
      error,
      "CHECKPOINT_PARENT_MISSING",
    );
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw localFileError(
      `The upload checkpoint parent is not a real directory: ${parent}.`,
      undefined,
      "CHECKPOINT_PARENT_INVALID",
    );
  }
}

export async function createCheckpointFile(
  path: string,
  checkpoint: UploadCheckpoint,
): Promise<void> {
  await assertCheckpointParent(path);
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(path, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw localFileError(
        `The upload checkpoint already exists: ${path}.`,
        error,
        "CHECKPOINT_EXISTS",
      );
    }
    throw localFileError(`The upload checkpoint could not be created: ${path}.`, error);
  }
  try {
    await handle.writeFile(serializeCheckpoint(checkpoint), "utf8");
    await handle.sync();
  } catch (error) {
    throw localFileError(`The upload checkpoint could not be written: ${path}.`, error);
  } finally {
    await handle.close();
  }
}

export async function readCheckpointFile(path: string): Promise<UploadCheckpoint> {
  let contents: string;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    throw localFileError(
      `The upload checkpoint could not be read: ${path}.`,
      error,
      "CHECKPOINT_UNREADABLE",
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch (error) {
    throw localFileError(
      `The upload checkpoint is not valid JSON: ${path}.`,
      error,
      "CHECKPOINT_INVALID",
    );
  }
  return assertValidCheckpoint(value, path);
}

export async function commitCheckpointFile(
  path: string,
  checkpoint: UploadCheckpoint,
): Promise<void> {
  await assertCheckpointParent(path);
  const temporary = `${path}.${randomUUID()}.tmp`;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(serializeCheckpoint(checkpoint), "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, path);
  } catch (error) {
    if (handle !== undefined) {
      await handle.close().catch(() => undefined);
    }
    await rm(temporary, { force: true }).catch(() => undefined);
    throw localFileError(`The upload checkpoint could not be committed: ${path}.`, error);
  }
  await syncCheckpointDirectory(dirname(path));
}

/** Best-effort directory durability; directory fsync is unsupported on some platforms. */
async function syncCheckpointDirectory(directory: string): Promise<void> {
  try {
    const handle = await open(directory, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Directory sync is not available on every platform.
  }
}

export async function removeCheckpointFile(path: string): Promise<void> {
  await rm(path, { force: true });
}

export type CheckpointLock = {
  readonly path: string;
  release(): Promise<void>;
};

export type CheckpointLockOptions = {
  host?: string;
  pid?: number;
  token?: string;
  now?: () => Date;
  isProcessAlive?: (pid: number) => boolean;
};

type LockPayload = {
  schemaVersion?: unknown;
  token?: unknown;
  pid?: unknown;
  host?: unknown;
  startedAt?: unknown;
};

function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function parseLockPayload(contents: string): LockPayload | undefined {
  try {
    const value: unknown = JSON.parse(contents);
    return typeof value === "object" && value !== null ? (value as LockPayload) : undefined;
  } catch {
    return undefined;
  }
}

function lockedError(path: string, detail: string): DomainError {
  return localFileError(
    `The upload checkpoint is locked by another process (${detail}): ${path}.`,
    undefined,
    "CHECKPOINT_LOCKED",
  );
}

/**
 * Acquires an exclusive local lock next to the checkpoint. A lock left by a crashed process is
 * reclaimed only when the owner host matches and the process is provably gone.
 */
export async function acquireCheckpointLock(
  checkpointPath: string,
  options: CheckpointLockOptions = {},
): Promise<CheckpointLock> {
  const host = options.host ?? hostname();
  const pid = options.pid ?? process.pid;
  const token = options.token ?? randomUUID();
  const now = options.now ?? (() => new Date());
  const isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive;
  const lockPath = `${checkpointPath}.lock`;
  const payload = `${JSON.stringify({
    schemaVersion: 1,
    token,
    pid,
    host,
    startedAt: now().toISOString(),
  })}\n`;

  const release = async (): Promise<void> => {
    let contents: string;
    try {
      contents = await readFile(lockPath, "utf8");
    } catch {
      return;
    }
    if (parseLockPayload(contents)?.token !== token) return;
    await unlink(lockPath).catch(() => undefined);
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let handle: Awaited<ReturnType<typeof open>>;
    try {
      handle = await open(lockPath, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw localFileError(
          `The upload checkpoint lock could not be created: ${lockPath}.`,
          error,
        );
      }
      let contents: string;
      try {
        contents = await readFile(lockPath, "utf8");
      } catch {
        throw lockedError(lockPath, "the lock metadata is unreadable");
      }
      const existing = parseLockPayload(contents);
      if (existing === undefined || typeof existing.pid !== "number" || existing.host !== host) {
        throw lockedError(lockPath, "the lock owner cannot be verified");
      }
      if (isProcessAlive(existing.pid)) {
        throw lockedError(lockPath, `process ${existing.pid} is still running`);
      }
      await unlink(lockPath).catch((unlinkError: NodeJS.ErrnoException) => {
        if (unlinkError.code !== "ENOENT") {
          throw localFileError(
            `The stale upload checkpoint lock could not be removed: ${lockPath}.`,
            unlinkError,
          );
        }
      });
      continue;
    }
    try {
      await handle.writeFile(payload, "utf8");
      await handle.sync();
    } catch (error) {
      await handle.close().catch(() => undefined);
      await unlink(lockPath).catch(() => undefined);
      throw localFileError(`The upload checkpoint lock could not be written: ${lockPath}.`, error);
    }
    await handle.close();
    return { path: lockPath, release };
  }
  throw lockedError(lockPath, "a stale lock could not be reclaimed");
}

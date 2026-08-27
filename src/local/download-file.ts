import type { Stats } from "node:fs";
import { link, lstat, open, rename, unlink } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import { DomainError } from "../errors.ts";

export type PreparedDownloadFile = {
  localPath: string;
  destinationPath: string;
  tempPath: string;
  handle: Awaited<ReturnType<typeof open>>;
  destinationStats?: Stats;
};

function localFileError(message: string, cause?: unknown): DomainError {
  return new DomainError("local-file", message, { cause, retryable: false });
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

function sameFile(left: Stats, right: Stats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

async function destinationStats(path: string): Promise<Stats | undefined> {
  try {
    return await lstat(path);
  } catch (error) {
    if (isMissing(error)) {
      return undefined;
    }
    throw localFileError("The local download destination could not be inspected.", error);
  }
}

export async function prepareDownloadFile(
  localPath: string,
  overwrite: boolean,
): Promise<PreparedDownloadFile> {
  const destinationPath = resolve(localPath);
  const parentPath = dirname(destinationPath);
  let parent: Stats;
  try {
    parent = await lstat(parentPath);
  } catch (error) {
    throw localFileError("The local download parent directory does not exist.", error);
  }
  if (parent.isSymbolicLink() || !parent.isDirectory()) {
    throw localFileError("The local download parent is not a real directory.");
  }

  const existing = await destinationStats(destinationPath);
  if (existing !== undefined && !existing.isFile()) {
    throw localFileError("The local download destination is not a regular file.");
  }
  if (existing !== undefined && !overwrite) {
    throw new DomainError("conflict", "The local download destination already exists.");
  }

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const tempPath = resolve(
      parentPath,
      `.${basename(destinationPath)}.myboxctl-${crypto.randomUUID()}.tmp`,
    );
    try {
      const handle = await open(tempPath, "wx", 0o600);
      return {
        localPath,
        destinationPath,
        tempPath,
        handle,
        ...(existing === undefined ? {} : { destinationStats: existing }),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code !== "EEXIST") {
        throw localFileError("A temporary download file could not be created.", error);
      }
    }
  }
  throw localFileError("A unique temporary download file could not be created.");
}

export async function commitDownloadFile(file: PreparedDownloadFile): Promise<void> {
  if (file.destinationStats === undefined) {
    try {
      await link(file.tempPath, file.destinationPath);
      await unlink(file.tempPath);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code === "EEXIST") {
        throw new DomainError(
          "conflict",
          "The local download destination was created concurrently.",
        );
      }
      throw localFileError("The downloaded file could not be committed.", error);
    }
  }

  const current = await destinationStats(file.destinationPath);
  if (current === undefined || !current.isFile() || !sameFile(file.destinationStats, current)) {
    throw new DomainError("conflict", "The local download destination changed during transfer.");
  }
  try {
    await rename(file.tempPath, file.destinationPath);
  } catch (error) {
    throw localFileError(
      "The downloaded file could not atomically replace the destination.",
      error,
    );
  }
}

export async function removeDownloadTemp(file: PreparedDownloadFile): Promise<void> {
  await unlink(file.tempPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") {
      throw error;
    }
  });
}

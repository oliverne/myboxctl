import { lstat } from "node:fs/promises";
import { basename, join } from "node:path";

import { DomainError } from "../errors.ts";
import { parseRemotePath } from "../remote/path.ts";
import type { FoundResolution, RemoteResolver } from "../remote/resolver.ts";
import {
  type DownloadDependencies,
  type DownloadResult,
  resolveDownloadFile,
  runDownload,
} from "./download.ts";

export type DownloadCommandOptions = { overwrite?: boolean };

export type DownloadCommandResult = {
  action: "downloaded";
  data: Omit<DownloadResult["data"], "size"> & { sizeBytes: number };
};

function remoteBaseName(
  remotePath: string,
  resolver: RemoteResolver,
  resolved?: FoundResolution,
): Promise<string> {
  return (async () => {
    const parsed = parseRemotePath(remotePath);
    if (parsed.kind === "root") {
      throw new DomainError("invalid-arguments", "The remote root cannot be downloaded as a file.");
    }
    const resolution = await resolveDownloadFile(remotePath, resolver, resolved);
    const name = basename(resolution.resource.name.replaceAll("\\", "/"));
    if (name.length === 0 || name === "." || name === "..") {
      throw new DomainError("api-unavailable", "MYBOX returned an invalid remote file name.");
    }
    return name;
  })();
}

async function isExistingDirectory(path: string): Promise<boolean> {
  try {
    const stats = await lstat(path);
    return stats.isDirectory() && !stats.isSymbolicLink();
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      return false;
    }
    throw new DomainError("local-file", "The local download destination could not be inspected.", {
      cause: error,
    });
  }
}

export async function resolveDownloadDestination(
  remotePath: string,
  localDestination: string | undefined,
  resolver: RemoteResolver,
  resolved?: FoundResolution,
): Promise<string> {
  const name = await remoteBaseName(remotePath, resolver, resolved);
  if (localDestination === undefined) {
    return `./${name}`;
  }

  if (localDestination === ".") {
    return `./${name}`;
  }

  const directoryIntent = localDestination.endsWith("/") || localDestination.endsWith("\\");
  if (await isExistingDirectory(localDestination)) {
    const joined = join(localDestination, name);
    return localDestination.startsWith("./") && !joined.startsWith("./") ? `./${joined}` : joined;
  }
  if (directoryIntent) {
    throw new DomainError(
      "local-file",
      `The local download directory does not exist: ${localDestination}.`,
    );
  }
  return localDestination;
}

export async function runDownloadCommand(
  remotePath: string,
  localDestination: string | undefined,
  options: DownloadCommandOptions,
  dependencies: DownloadDependencies,
): Promise<DownloadCommandResult> {
  const resolved = await resolveDownloadFile(remotePath, dependencies.resolver);
  const target = await resolveDownloadDestination(
    remotePath,
    localDestination,
    dependencies.resolver,
    resolved,
  );
  const result = await runDownload(remotePath, target, options, dependencies, resolved);
  return {
    ...result,
    data: {
      remotePath: result.data.remotePath,
      localPath: result.data.localPath,
      resourceId: result.data.resourceId,
      modifiedAt: result.data.modifiedAt,
      sizeBytes: result.data.size,
    },
  };
}

export const downloadCommand = runDownloadCommand;

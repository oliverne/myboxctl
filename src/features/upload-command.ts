import { basename } from "node:path";

import { DomainError } from "../errors.ts";
import { parseRemoteDestination } from "../remote/destination.ts";
import { canonicalRemotePath } from "../remote/path.ts";
import { runEnsureDir } from "./ensure-dir.ts";
import { type PutResult, runPut } from "./put/command.ts";
import type { UploadDependencies } from "./upload.ts";

export type UploadCommandOptions = {
  force?: boolean;
  mkdir?: boolean;
};

export type UploadCommandResult = {
  action: PutResult["action"];
  data: Omit<PutResult["data"], "size"> & { sizeBytes: number };
};

function localBaseName(localPath: string): string {
  const value = basename(localPath);
  if (value.length === 0 || value === "." || value === "..") {
    throw new DomainError(
      "local-file",
      `The local upload file has no usable basename: ${localPath}.`,
    );
  }
  return value;
}

function childPath(parentPath: string, name: string): string {
  return parentPath === "/" ? `/${name}` : `${parentPath}/${name}`;
}

export async function resolveUploadDestination(
  localPath: string,
  remoteDestination: string | undefined,
  options: UploadCommandOptions,
  dependencies: UploadDependencies,
): Promise<string> {
  const name = localBaseName(localPath);
  if (remoteDestination === undefined) {
    return childPath("/", name);
  }

  const destination = parseRemoteDestination(remoteDestination);
  if (destination.path.kind === "root") {
    return childPath("/", name);
  }

  const resolution = await dependencies.resolver.resolveCanonical(destination.path);
  if (resolution.kind === "found") {
    if (resolution.resource.type.toLowerCase() === "folder") {
      return childPath(canonicalRemotePath(destination.path).normalized, name);
    }
    if (destination.directoryIntent) {
      throw new DomainError(
        "conflict",
        `The upload destination is a file, not a directory: ${destination.path.normalized}.`,
      );
    }
    return canonicalRemotePath(destination.path).normalized;
  }

  if (destination.directoryIntent) {
    if (!options.mkdir) {
      throw new DomainError(
        "not-found",
        `The remote upload directory was not found: ${destination.path.normalized}.`,
      );
    }
    await runEnsureDir(destination.path.normalized, dependencies.resolver);
    return childPath(canonicalRemotePath(destination.path).normalized, name);
  }

  return canonicalRemotePath(destination.path).normalized;
}

export async function runUploadCommand(
  localPath: string,
  remoteDestination: string | undefined,
  options: UploadCommandOptions,
  dependencies: UploadDependencies,
): Promise<UploadCommandResult> {
  const target = await resolveUploadDestination(
    localPath,
    remoteDestination,
    options,
    dependencies,
  );
  const result = await runPut(localPath, target, options, dependencies);
  return {
    ...result,
    data: {
      path: result.data.path,
      resourceId: result.data.resourceId,
      modifiedAt: result.data.modifiedAt,
      reason: result.data.reason,
      sizeBytes: result.data.size,
    },
  };
}

export const uploadCommand = runUploadCommand;

import { DomainError } from "../errors.ts";
import { canonicalRemotePath, parseRemotePath } from "../remote/path.ts";
import type { RemoteResolver } from "../remote/resolver.ts";
import { createFolderWithReconcile, runEnsureDir } from "./ensure-dir.ts";

export type MkdirOptions = { parents?: boolean };

export type MkdirResult = {
  action: "created" | "existing";
  data: { path: string; resourceId: string | null; createdPaths: string[] };
};

export async function runMkdir(
  remotePath: string,
  options: MkdirOptions,
  resolver: RemoteResolver,
): Promise<MkdirResult> {
  const parsed = parseRemotePath(remotePath);
  if (parsed.kind === "root") {
    if (options.parents) {
      return { action: "existing", data: { path: "/", resourceId: null, createdPaths: [] } };
    }
    throw new DomainError("conflict", "The remote directory already exists: /.");
  }

  if (options.parents) {
    return runEnsureDir(parsed.normalized, resolver);
  }

  const parent = parseRemotePath(parsed.parentPath);
  let parentId: string | undefined;
  if (parent.kind !== "root") {
    const parentResolution = await resolver.resolveCanonical(parent);
    if (parentResolution.kind === "absent") {
      throw new DomainError(
        "not-found",
        `The remote parent directory was not found: ${parent.normalized}.`,
      );
    }
    if (
      parentResolution.kind === "found" &&
      parentResolution.resource.type.toLowerCase() !== "folder"
    ) {
      throw new DomainError(
        "conflict",
        `The remote parent is not a directory: ${parent.normalized}.`,
      );
    }
    if (parentResolution.kind === "found") {
      parentId = parentResolution.resource.resourceId;
    }
  }

  const target = canonicalRemotePath(parsed);
  if (target.kind === "root") {
    throw new DomainError("unexpected", "The canonical mkdir target was invalid.");
  }
  const existing = await resolver.resolveForMutation(parsed);
  if (existing.kind === "found") {
    throw new DomainError("conflict", `The remote directory already exists: ${parsed.normalized}.`);
  }
  if (existing.kind === "root") {
    throw new DomainError("unexpected", "The mkdir target resolution was invalid.");
  }

  const created = await createFolderWithReconcile(resolver, target, parentId);
  return {
    action: "created",
    data: {
      path: target.normalized,
      resourceId: created.resourceId,
      createdPaths: [target.normalized],
    },
  };
}

export const mkdir = runMkdir;

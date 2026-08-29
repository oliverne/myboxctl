import { DomainError, normalizeError } from "../errors.ts";
import {
  type ChildRemotePath,
  canonicalRemotePath,
  hasCanonicalVariants,
  parseRemotePath,
} from "../remote/path.ts";
import type { RemoteResolver } from "../remote/resolver.ts";

export type EnsureDirData = {
  path: string;
  resourceId: string | null;
  createdPaths: string[];
};

export type EnsureDirResult = {
  action: "created" | "existing";
  data: EnsureDirData;
};

function childPath(components: readonly string[], end: number): ChildRemotePath {
  const parsed = parseRemotePath(`/${components.slice(0, end).join("/")}`);
  if (parsed.kind === "root") {
    throw new DomainError("unexpected", "The remote directory path could not be built.");
  }
  return parsed;
}

function shouldReconcile(error: unknown): boolean {
  const normalized = normalizeError(error);
  return (
    normalized.status === 409 ||
    normalized.retryable ||
    (normalized.kind === "api-unavailable" && normalized.code === "API_RESPONSE_INVALID")
  );
}

async function createOrReconcile(
  resolver: RemoteResolver,
  path: ChildRemotePath,
  parentId: string | undefined,
): Promise<{ resourceId: string; created: boolean }> {
  try {
    const created = await resolver.createFolder({
      folderName: path.basename,
      ...(parentId === undefined ? {} : { parentId }),
    });
    return { resourceId: created.resourceId, created: true };
  } catch (error) {
    if (!shouldReconcile(error)) {
      throw error;
    }

    const resolved = await resolver.resolveForMutation(path, { poll: true });
    if (resolved.kind === "found") {
      if (resolved.resource.type.toLowerCase() !== "folder") {
        throw new DomainError("conflict", `A file already exists at ${path.normalized}.`);
      }
      return { resourceId: resolved.resource.resourceId, created: false };
    }
    if (resolved.kind === "absent") {
      throw error;
    }

    throw new DomainError("unexpected", "The remote directory could not be reconciled.");
  }
}

export async function runEnsureDir(
  remotePath: string,
  resolver: RemoteResolver,
): Promise<EnsureDirResult> {
  const parsed = parseRemotePath(remotePath);
  if (parsed.kind === "root") {
    return {
      action: "existing",
      data: { path: parsed.normalized, resourceId: null, createdPaths: [] },
    };
  }

  const hasUnicodeVariants = parsed.components.some(hasCanonicalVariants);
  if (!hasUnicodeVariants) {
    const targetFolder = await resolver.resolveFolderExact(parsed);
    if (targetFolder.kind === "found") {
      return {
        action: "existing",
        data: {
          path: parsed.normalized,
          resourceId: targetFolder.resource.resourceId,
          createdPaths: [],
        },
      };
    }

    let parentId: string | undefined;
    const createdPaths: string[] = [];
    for (let index = 0; index < parsed.components.length; index += 1) {
      const currentPath = childPath(parsed.components, index + 1);
      const resolved =
        index === parsed.components.length - 1
          ? targetFolder
          : await resolver.resolveFolderExact(currentPath);
      if (resolved.kind === "found") {
        if (resolved.resource.type.toLowerCase() !== "folder") {
          throw new DomainError(
            "conflict",
            `A file cannot be used as a directory: ${currentPath.normalized}.`,
          );
        }
        parentId = resolved.resource.resourceId;
        continue;
      }
      if (resolved.kind === "root") {
        throw new DomainError("unexpected", "The remote directory resolution was invalid.");
      }

      const file = await resolver.resolveFileExact(currentPath);
      if (file.kind === "found") {
        throw new DomainError(
          "conflict",
          `A file cannot be used as a directory: ${currentPath.normalized}.`,
        );
      }
      if (file.kind === "root") {
        throw new DomainError("unexpected", "The remote file resolution was invalid.");
      }

      const canonicalPath = canonicalRemotePath(currentPath);
      if (canonicalPath.kind === "root") {
        throw new DomainError("unexpected", "The canonical remote directory path was invalid.");
      }
      const result = await createOrReconcile(resolver, canonicalPath, parentId);
      parentId = result.resourceId;
      if (result.created) {
        createdPaths.push(canonicalPath.normalized);
      }
    }

    return {
      action: createdPaths.length > 0 ? "created" : "existing",
      data: { path: parsed.normalized, resourceId: parentId ?? null, createdPaths },
    };
  }

  let parentId: string | undefined;
  const createdPaths: string[] = [];

  for (let index = 0; index < parsed.components.length; index += 1) {
    const currentPath = childPath(parsed.components, index + 1);
    const resolved = await resolver.resolveForMutation(currentPath);

    if (resolved.kind === "found") {
      if (resolved.resource.type.toLowerCase() !== "folder") {
        throw new DomainError(
          "conflict",
          `A file cannot be used as a directory: ${currentPath.normalized}.`,
        );
      }
      parentId = resolved.resource.resourceId;
      continue;
    }
    if (resolved.kind === "root") {
      throw new DomainError("unexpected", "The remote directory resolution was invalid.");
    }

    const canonicalPath = canonicalRemotePath(currentPath);
    if (canonicalPath.kind === "root") {
      throw new DomainError("unexpected", "The canonical remote directory path was invalid.");
    }
    const result = await createOrReconcile(resolver, canonicalPath, parentId);
    parentId = result.resourceId;
    if (result.created) {
      createdPaths.push(canonicalPath.normalized);
    }
  }

  const canonicalTarget = canonicalRemotePath(parsed);

  return {
    action: createdPaths.length > 0 ? "created" : "existing",
    data: {
      path: canonicalTarget.normalized,
      resourceId: parentId ?? null,
      createdPaths,
    },
  };
}

export const ensureDir = runEnsureDir;

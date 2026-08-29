import { DomainError, normalizeError } from "../errors.ts";
import type { MyboxClient } from "../mybox/client.ts";
import { type ChildRemotePath, parseRemotePath } from "../remote/path.ts";
import type { RemoteResolver } from "../remote/resolver.ts";

export type DeleteOptions = {
  strict?: boolean;
};

export type DeleteData = {
  path: string;
  resourceId?: string;
  type?: string;
};

export type DeleteResult = {
  action: "deleted" | "already-absent";
  data: DeleteData;
};

export type DeleteDependencies = {
  client: MyboxClient;
  resolver: RemoteResolver;
};

function absent(path: string, options: DeleteOptions): DeleteResult {
  if (options.strict) {
    throw new DomainError("not-found", `The remote resource was not found: ${path}.`);
  }
  return { action: "already-absent", data: { path } };
}

function deleted(path: string, resourceId: string, type: string): DeleteResult {
  return { action: "deleted", data: { path, resourceId, type } };
}

async function originalIdIsInactive(
  resolver: RemoteResolver,
  target: ChildRemotePath,
  resourceId: string,
): Promise<boolean> {
  const active = await resolver.resolveCanonical(target);
  if (active.kind === "found" && active.resource.resourceId === resourceId) {
    return false;
  }

  const siblings = await resolver.listChildren(target.parentPath);
  return !siblings.some((resource) => resource.resourceId === resourceId);
}

export async function runDelete(
  remotePath: string,
  options: DeleteOptions,
  dependencies: DeleteDependencies,
): Promise<DeleteResult> {
  const target = parseRemotePath(remotePath);
  if (target.kind === "root") {
    throw new DomainError("invalid-arguments", "The remote root cannot be deleted.");
  }

  const resolution = await dependencies.resolver.resolveForMutation(target);
  if (resolution.kind === "absent") {
    return absent(target.normalized, options);
  }
  if (resolution.kind === "root") {
    throw new DomainError("unexpected", "The delete target resolution was invalid.");
  }

  const resourceId = resolution.resource.resourceId;
  const type = resolution.resource.type.toLowerCase();
  try {
    await dependencies.client.deleteResource(resourceId);
    return deleted(target.normalized, resourceId, type);
  } catch (error) {
    const failure = normalizeError(error);
    if (failure.kind === "not-found") {
      return absent(target.normalized, options);
    }
    if (!failure.retryable) {
      throw failure;
    }

    if (await originalIdIsInactive(dependencies.resolver, target, resourceId)) {
      return deleted(target.normalized, resourceId, type);
    }
    if (failure.status !== 429) {
      throw failure;
    }

    try {
      await dependencies.client.deleteResource(resourceId);
      return deleted(target.normalized, resourceId, type);
    } catch (retryError) {
      const retryFailure = normalizeError(retryError);
      if (retryFailure.kind === "not-found") {
        return deleted(target.normalized, resourceId, type);
      }
      throw retryFailure;
    }
  }
}

export const deleteRemote = runDelete;

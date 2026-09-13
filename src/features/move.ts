import { DomainError, normalizeError } from "../errors.ts";
import { parseRemotePath, type RemotePath } from "../remote/path.ts";
import {
  assertSiblingNameAvailable,
  childPath,
  invalidArgument,
  isUncertainMutationFailure,
  type RelocationData,
  type RelocationDependencies,
  reconcileRelocation,
  resourceType,
  verifyRelocation,
} from "./relocation.ts";

export type MoveResult = {
  action: "moved" | "unchanged";
  data: RelocationData;
};

function isSelfOrDescendant(source: RemotePath, destination: RemotePath): boolean {
  if (source.kind === "root" || destination.kind === "root") {
    return false;
  }
  return (
    destination.normalized === source.normalized ||
    destination.normalized.startsWith(`${source.normalized}/`)
  );
}

function isDescendantPath(sourcePath: string, destinationPath: string): boolean {
  return destinationPath === sourcePath || destinationPath.startsWith(`${sourcePath}/`);
}

type Destination = {
  id: string;
  path: string;
};

async function resolveDestination(
  destination: RemotePath,
  dependencies: RelocationDependencies,
): Promise<Destination> {
  if (destination.kind === "root") {
    return { id: await dependencies.resolver.rootResourceId(), path: "/" };
  }

  const resolution = await dependencies.resolver.resolveForMutation(destination);
  if (resolution.kind === "root") {
    throw new DomainError("unexpected", "The move destination resolution was invalid.");
  }
  if (resolution.kind === "absent") {
    throw new DomainError(
      "not-found",
      `The remote destination directory was not found: ${destination.normalized}.`,
    );
  }
  if (resourceType(resolution) !== "folder") {
    throw new DomainError(
      "conflict",
      `The remote destination is not a directory: ${destination.normalized}.`,
    );
  }
  return { id: resolution.resource.resourceId, path: resolution.path.normalized };
}

export async function runMove(
  remotePath: string,
  destinationDirectory: string,
  dependencies: RelocationDependencies,
): Promise<MoveResult> {
  const source = parseRemotePath(remotePath);
  if (source.kind === "root") {
    throw invalidArgument("The remote root cannot be moved.");
  }

  const destination = parseRemotePath(destinationDirectory);
  if (isSelfOrDescendant(source, destination)) {
    throw invalidArgument(
      `The remote destination must not be the source itself or its descendant: ${destination.normalized}.`,
    );
  }

  const resolution = await dependencies.resolver.resolveForMutation(source);
  if (resolution.kind === "absent") {
    throw new DomainError("not-found", `The remote resource was not found: ${source.normalized}.`);
  }
  if (resolution.kind === "root") {
    throw new DomainError("unexpected", "The move source resolution was invalid.");
  }

  const resourceId = resolution.resource.resourceId;
  const type = resourceType(resolution);
  const name = resolution.resource.name;
  const sourcePath = resolution.path.normalized;
  const resolvedDestination = await resolveDestination(destination, dependencies);

  // Unicode-equivalent spellings can make the raw string check incomplete, so repeat it against the
  // component spellings the resolver actually selected before any mutation.
  if (isDescendantPath(sourcePath, resolvedDestination.path)) {
    throw invalidArgument(
      `The remote destination must not be the source itself or its descendant: ${destination.normalized}.`,
    );
  }

  const detail = await dependencies.resolver.detail(resolution);
  if (detail.parentId === resolvedDestination.id) {
    return {
      action: "unchanged",
      data: { resourceId, type, path: sourcePath, newPath: sourcePath },
    };
  }

  await assertSiblingNameAvailable(dependencies.resolver, {
    parentPath: resolvedDestination.path,
    parentId: resolvedDestination.id,
    name,
    excludeResourceId: resourceId,
  });

  const newPath = childPath(resolvedDestination.path, name);
  const verification = { path: sourcePath, newPath, resourceId };
  try {
    await dependencies.client.moveResource(resourceId, resolvedDestination.id);
  } catch (error) {
    const failure = normalizeError(error);
    if (!isUncertainMutationFailure(failure)) {
      throw failure;
    }
    await reconcileRelocation(dependencies.resolver, verification, failure);
    return { action: "moved", data: { resourceId, type, path: sourcePath, newPath } };
  }

  await verifyRelocation(dependencies.resolver, verification);
  return { action: "moved", data: { resourceId, type, path: sourcePath, newPath } };
}

export const moveRemote = runMove;

import { DomainError, normalizeError } from "../errors.ts";
import { parseRemotePath } from "../remote/path.ts";
import {
  assertNewResourceName,
  assertSiblingNameAvailable,
  childPath,
  isUncertainMutationFailure,
  type RelocationData,
  type RelocationDependencies,
  reconcileRelocation,
  resourceType,
  verifyRelocation,
} from "./relocation.ts";

export type RenameResult = {
  action: "renamed" | "unchanged";
  data: RelocationData;
};

export async function runRename(
  remotePath: string,
  newName: string,
  dependencies: RelocationDependencies,
): Promise<RenameResult> {
  assertNewResourceName(newName);

  const target = parseRemotePath(remotePath);
  if (target.kind === "root") {
    throw new DomainError("invalid-arguments", "The remote root cannot be renamed.");
  }

  const resolution = await dependencies.resolver.resolveForMutation(target);
  if (resolution.kind === "absent") {
    throw new DomainError("not-found", `The remote resource was not found: ${target.normalized}.`);
  }
  if (resolution.kind === "root") {
    throw new DomainError("unexpected", "The rename target resolution was invalid.");
  }

  const resourceId = resolution.resource.resourceId;
  const type = resourceType(resolution);
  const currentPath = resolution.path.normalized;
  const parentPath = resolution.path.parentPath;

  if (resolution.resource.name === newName) {
    return {
      action: "unchanged",
      data: {
        resourceId,
        type,
        path: currentPath,
        newPath: currentPath,
      },
    };
  }

  const detail = await dependencies.resolver.detail(resolution);
  const parentId = detail.parentId;
  const newPath = childPath(parentPath, newName);
  await assertSiblingNameAvailable(dependencies.resolver, {
    parentPath,
    parentId,
    name: newName,
    excludeResourceId: resourceId,
  });

  const verification = { path: currentPath, newPath, resourceId };
  try {
    await dependencies.client.renameResource(resourceId, newName);
  } catch (error) {
    const failure = normalizeError(error);
    if (!isUncertainMutationFailure(failure)) {
      throw failure;
    }
    await reconcileRelocation(dependencies.resolver, verification, failure);
    return { action: "renamed", data: { resourceId, type, path: currentPath, newPath } };
  }

  await verifyRelocation(dependencies.resolver, verification);
  return { action: "renamed", data: { resourceId, type, path: currentPath, newPath } };
}

export const renameRemote = runRename;

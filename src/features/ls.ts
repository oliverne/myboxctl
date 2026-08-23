import { DomainError } from "../errors.ts";
import type { ResourceItem } from "../mybox/contract.ts";
import { parseRemotePath } from "../remote/path.ts";
import type { RemoteResolver } from "../remote/resolver.ts";
import type { PublicResource } from "./stat.ts";

export type LsData = {
  path: string;
  resources: PublicResource[];
};

export type LsResult = {
  action: "listed";
  data: LsData;
};

function compareCodePoint(left: string, right: string): number {
  const leftCodePoints = [...left];
  const rightCodePoints = [...right];
  const length = Math.min(leftCodePoints.length, rightCodePoints.length);
  for (let index = 0; index < length; index += 1) {
    const leftCodePoint = leftCodePoints[index]?.codePointAt(0) ?? 0;
    const rightCodePoint = rightCodePoints[index]?.codePointAt(0) ?? 0;
    if (leftCodePoint !== rightCodePoint) {
      return leftCodePoint - rightCodePoint;
    }
  }
  return leftCodePoints.length - rightCodePoints.length;
}

function childPath(parent: string, name: string): string {
  return parent === "/" ? `/${name}` : `${parent}/${name}`;
}

function compareResources(left: PublicResource, right: PublicResource): number {
  const leftFolder = left.type.toLowerCase() === "folder";
  const rightFolder = right.type.toLowerCase() === "folder";
  if (leftFolder !== rightFolder) {
    return leftFolder ? -1 : 1;
  }

  const nameResult = compareCodePoint(left.name, right.name);
  if (nameResult !== 0) {
    return nameResult;
  }
  return compareCodePoint(left.resourceId ?? "", right.resourceId ?? "");
}

function toPublicResource(resource: ResourceItem, path: string): PublicResource {
  return {
    resourceId: resource.resourceId,
    path,
    name: resource.name,
    type: resource.type,
    size: resource.size,
    modifiedAt: resource.modifiedAt,
  };
}

export async function runLs(remotePath: string, resolver: RemoteResolver): Promise<LsResult> {
  const parsed = parseRemotePath(remotePath);
  const resolution = await resolver.resolve(parsed);
  if (resolution.kind === "absent") {
    throw new DomainError("not-found", `The remote directory was not found: ${parsed.normalized}.`);
  }
  if (resolution.kind === "found" && resolution.resource.type.toLowerCase() !== "folder") {
    throw new DomainError("conflict", `The remote path is not a directory: ${parsed.normalized}.`);
  }

  const folderId = resolution.kind === "found" ? resolution.resource.resourceId : undefined;
  const resources = await resolver.listChildren(parsed, folderId);
  const publicResources = resources.map((resource) =>
    toPublicResource(resource, childPath(parsed.normalized, resource.name)),
  );
  publicResources.sort(compareResources);

  return {
    action: "listed",
    data: { path: parsed.normalized, resources: publicResources },
  };
}

export const ls = runLs;

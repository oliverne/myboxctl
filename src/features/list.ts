import { DomainError } from "../errors.ts";
import { parseRemotePath } from "../remote/path.ts";
import type { RemoteResolver } from "../remote/resolver.ts";
import { childResourcePath, type PublicResource, publicResource } from "./public-resource.ts";

export type ListResult = {
  action: "listed";
  data: { path: string; resources: PublicResource[] };
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

function compareResources(left: PublicResource, right: PublicResource): number {
  if (left.type !== right.type) {
    return left.type === "folder" ? -1 : 1;
  }
  const nameResult = compareCodePoint(left.name, right.name);
  return nameResult !== 0
    ? nameResult
    : compareCodePoint(left.resourceId ?? "", right.resourceId ?? "");
}

export async function runList(remotePath = "/", resolver: RemoteResolver): Promise<ListResult> {
  const parsed = parseRemotePath(remotePath);
  const resolution = await resolver.resolveCanonical(parsed);
  if (resolution.kind === "absent") {
    throw new DomainError("not-found", `The remote resource was not found: ${parsed.normalized}.`);
  }

  if (resolution.kind === "found" && resolution.resource.type.toLowerCase() === "file") {
    const detail = await resolver.detail(resolution);
    return {
      action: "listed",
      data: {
        path: parsed.normalized,
        resources: [publicResource(detail, parsed.normalized)],
      },
    };
  }

  const parentId = resolution.kind === "found" ? resolution.resource.resourceId : undefined;
  const resources = await resolver.listChildren(parsed, parentId);
  const publicResources = resources
    .map((resource) =>
      publicResource(resource, childResourcePath(parsed.normalized, resource.name)),
    )
    .sort(compareResources);

  return { action: "listed", data: { path: parsed.normalized, resources: publicResources } };
}

export const list = runList;

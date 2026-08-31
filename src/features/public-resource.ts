import type { ResourceDetail, ResourceItem, SearchResourceItem } from "../mybox/contract.ts";

export type PublicResource = {
  resourceId: string | null;
  path: string;
  name: string;
  type: "file" | "folder";
  sizeBytes: number | null;
  modifiedAt: string | null;
};

function resourceType(value: string): "file" | "folder" {
  return value.toLowerCase() === "file" ? "file" : "folder";
}

function normalizedModifiedAt(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  return new Date(timestamp).toISOString();
}

function normalizedSize(type: "file" | "folder", value: number | undefined): number | null {
  return type === "file" && value !== undefined ? value : null;
}

export function publicResource(
  resource: ResourceDetail | ResourceItem | SearchResourceItem,
  path: string,
): PublicResource {
  const type = resourceType(resource.type ?? "folder");
  return {
    resourceId: resource.resourceId ?? null,
    path,
    name: resource.name,
    type,
    sizeBytes: normalizedSize(type, resource.size),
    modifiedAt: normalizedModifiedAt(resource.modifiedAt),
  };
}

export function rootResource(): PublicResource {
  return {
    resourceId: null,
    path: "/",
    name: "/",
    type: "folder",
    sizeBytes: null,
    modifiedAt: null,
  };
}

export function childResourcePath(parentPath: string, name: string): string {
  return parentPath === "/" ? `/${name}` : `${parentPath}/${name}`;
}

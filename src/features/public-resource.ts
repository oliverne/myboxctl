import { apiResponseError } from "../errors.ts";
import type { ResourceDetail, ResourceItem, SearchResourceItem } from "../mybox/contract.ts";

export type PublicResource = {
  resourceId: string | null;
  path: string;
  name: string;
  type: "file" | "folder";
  sizeBytes: number | null;
  modifiedAt: string | null;
};

function resourceType(value: string | undefined): "file" | "folder" {
  if (value === undefined) {
    throw apiResponseError("MYBOX resource type was missing from the response.");
  }
  if (value.toLowerCase() === "file") {
    return "file";
  }
  if (value.toLowerCase() === "folder") {
    return "folder";
  }
  throw apiResponseError(`MYBOX returned an unknown resource type: ${value}.`);
}

function normalizedModifiedAt(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw apiResponseError(`MYBOX returned an invalid modifiedAt value: ${value}.`);
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
  const type = resourceType(resource.type);
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

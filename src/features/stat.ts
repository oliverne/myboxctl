import type { RemoteResolver } from "../remote/resolver.ts";

export type PublicResource = {
  resourceId?: string;
  path: string;
  name: string;
  type: string;
  size?: number;
  modifiedAt?: string;
};

export type StatData = {
  resource: PublicResource | null;
};

export type StatResult = {
  action: "found" | "absent";
  data: StatData;
};

function publicResource(
  resource: {
    resourceId: string;
    name: string;
    type: string;
    size: number;
    modifiedAt: string;
  },
  path: string,
): PublicResource {
  return {
    resourceId: resource.resourceId,
    path,
    name: resource.name,
    type: resource.type,
    size: resource.size,
    modifiedAt: resource.modifiedAt,
  };
}

export async function runStat(remotePath: string, resolver: RemoteResolver): Promise<StatResult> {
  const resolution = await resolver.resolveCanonical(remotePath);
  if (resolution.kind === "absent") {
    return { action: "absent", data: { resource: null } };
  }
  if (resolution.kind === "root") {
    return {
      action: "found",
      data: {
        resource: {
          path: "/",
          name: "/",
          type: "folder",
        },
      },
    };
  }

  const detail = await resolver.detail(resolution);
  return {
    action: "found",
    data: { resource: publicResource(detail, resolution.path.normalized) },
  };
}

export const stat = runStat;

import { DomainError } from "../errors.ts";
import { parseRemotePath } from "../remote/path.ts";
import type { RemoteResolver } from "../remote/resolver.ts";
import { type PublicResource, publicResource, rootResource } from "./public-resource.ts";

export type InfoResult = {
  action: "found";
  data: { resource: PublicResource };
};

export async function runInfo(remotePath: string, resolver: RemoteResolver): Promise<InfoResult> {
  const parsed = parseRemotePath(remotePath);
  const resolution = await resolver.resolveCanonical(parsed);
  if (resolution.kind === "absent") {
    throw new DomainError("not-found", `The remote resource was not found: ${parsed.normalized}.`);
  }
  if (resolution.kind === "root") {
    return { action: "found", data: { resource: rootResource() } };
  }

  const detail = await resolver.detail(resolution);
  return {
    action: "found",
    data: { resource: publicResource(detail, resolution.path.normalized) },
  };
}

export const info = runInfo;

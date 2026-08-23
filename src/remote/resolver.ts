import { apiResponseError, DomainError } from "../errors.ts";
import type { MyboxClient } from "../mybox/client.ts";
import type { ResourceDetail, ResourceItem, SearchResourceItem } from "../mybox/contract.ts";
import { type ChildRemotePath, parseRemotePath, type RemotePath } from "./path.ts";

const DEFAULT_POLL_TIMES_MS = [0, 250, 1_000, 2_000] as const;

export type ResolverDependencies = {
  sleep: (ms: number) => Promise<void>;
};

export type ResolveOptions = {
  poll?: boolean;
  pollTimesMs?: readonly number[];
};

export type RootResolution = {
  readonly kind: "root";
  readonly path: Extract<RemotePath, { kind: "root" }>;
  readonly resource: null;
};

export type AbsentResolution = {
  readonly kind: "absent";
  readonly path: ChildRemotePath;
  readonly resource: null;
};

type ResolvedSearchResource = SearchResourceItem & {
  readonly type: string;
};

export type FoundResolution = {
  readonly kind: "found";
  readonly path: ChildRemotePath;
  readonly resource: ResolvedSearchResource;
};

export type PathResolution = RootResolution | AbsentResolution | FoundResolution;

const defaultDependencies: ResolverDependencies = {
  sleep: (ms) => Bun.sleep(ms),
};

function conflict(message: string): DomainError {
  return new DomainError("conflict", message);
}

function normalizedCandidatePath(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  try {
    return parseRemotePath(value).normalized;
  } catch {
    return undefined;
  }
}

function isFolder(resource: SearchResourceItem): boolean {
  return resource.type === undefined || resource.type.toLowerCase() === "folder";
}

function isFile(resource: SearchResourceItem): boolean {
  return resource.type === undefined || resource.type.toLowerCase() === "file";
}

function withResourceType(
  resource: SearchResourceItem,
  type: "file" | "folder",
): ResolvedSearchResource {
  return { ...resource, type: resource.type ?? type };
}

function exactFolderCandidates(
  resources: SearchResourceItem[],
  path: string,
): ResolvedSearchResource[] {
  const matches: ResolvedSearchResource[] = [];
  const seen = new Set<string>();
  for (const resource of resources) {
    if (!isFolder(resource) || normalizedCandidatePath(resource.path) !== path) {
      continue;
    }
    if (!seen.has(resource.resourceId)) {
      seen.add(resource.resourceId);
      matches.push(withResourceType(resource, "folder"));
    }
  }
  return matches;
}

function exactFileCandidates(
  resources: SearchResourceItem[],
  path: ChildRemotePath,
): ResolvedSearchResource[] {
  const matches: ResolvedSearchResource[] = [];
  const seen = new Set<string>();
  for (const resource of resources) {
    if (!isFile(resource) || resource.name !== path.basename) {
      continue;
    }

    const resourcePath = normalizedCandidatePath(resource.path);
    const resourceParent = normalizedCandidatePath(resource.parentPath);
    const hasExactEvidence = resourcePath !== undefined || resourceParent !== undefined;
    if (!hasExactEvidence) {
      continue;
    }
    if (resourcePath !== undefined && resourcePath !== path.normalized) {
      continue;
    }
    if (resourceParent !== undefined && resourceParent !== path.parentPath) {
      continue;
    }

    if (!seen.has(resource.resourceId)) {
      seen.add(resource.resourceId);
      matches.push(withResourceType(resource, "file"));
    }
  }
  return matches;
}

function assertAtMostOne(
  candidates: ResolvedSearchResource[],
  path: string,
  resourceType: "file" | "folder",
): ResolvedSearchResource | undefined {
  if (candidates.length > 1) {
    throw conflict(`More than one exact ${resourceType} resource matches ${path}.`);
  }
  return candidates[0];
}

function joinComponents(components: readonly string[], end: number): string {
  return `/${components.slice(0, end).join("/")}`;
}

export class RemoteResolver {
  readonly client: MyboxClient;
  readonly dependencies: ResolverDependencies;

  constructor(client: MyboxClient, dependencies: Partial<ResolverDependencies> = {}) {
    this.client = client;
    this.dependencies = { ...defaultDependencies, ...dependencies };
  }

  async resolve(input: string | RemotePath, options: ResolveOptions = {}): Promise<PathResolution> {
    const parsed = typeof input === "string" ? parseRemotePath(input) : input;
    if (parsed.kind === "root") {
      return { kind: "root", path: parsed, resource: null };
    }

    const pollTimes = options.poll ? (options.pollTimesMs ?? DEFAULT_POLL_TIMES_MS) : [0];
    let previousTime = 0;
    for (const [index, elapsed] of pollTimes.entries()) {
      if (index > 0) {
        const wait = Math.max(0, elapsed - previousTime);
        if (wait > 0) {
          await this.dependencies.sleep(wait);
        }
      }
      previousTime = elapsed;

      const result = await this.resolveOnce(parsed);
      if (result.kind !== "absent" || index === pollTimes.length - 1) {
        return result;
      }
    }

    throw apiResponseError("MYBOX path resolution polling ended unexpectedly.");
  }

  private async resolveOnce(path: ChildRemotePath): Promise<PathResolution> {
    for (let index = 0; index < path.components.length; index += 1) {
      const currentPath = joinComponents(path.components, index + 1);
      const current = parseRemotePath(currentPath);
      if (current.kind === "root") {
        throw apiResponseError("MYBOX path resolver built an invalid child path.");
      }

      const folders = await this.client.searchFolders({ path: current.normalized });
      const folder = assertAtMostOne(
        exactFolderCandidates(folders, current.normalized),
        current.normalized,
        "folder",
      );

      const files = await this.client.searchFiles({
        q: current.basename,
        parentPath: current.parentPath,
      });
      const file = assertAtMostOne(exactFileCandidates(files, current), current.normalized, "file");

      if (folder !== undefined && file !== undefined) {
        throw conflict(`A file and folder both match the exact path ${current.normalized}.`);
      }
      if (folder === undefined && file === undefined) {
        return { kind: "absent", path, resource: null };
      }
      if (file !== undefined) {
        if (index < path.components.length - 1) {
          throw conflict(`A file cannot be used as a directory: ${current.normalized}.`);
        }
        return { kind: "found", path, resource: file };
      }
      if (index === path.components.length - 1 && folder !== undefined) {
        return { kind: "found", path, resource: folder };
      }
    }

    return { kind: "absent", path, resource: null };
  }

  async detail(resolution: FoundResolution): Promise<ResourceDetail> {
    return this.client.getResource(resolution.resource.resourceId);
  }

  async listChildren(input: string | RemotePath, folderId?: string): Promise<ResourceItem[]> {
    const parsed = typeof input === "string" ? parseRemotePath(input) : input;
    if (parsed.kind === "root") {
      return this.client.listRoot();
    }

    const resolved = folderId
      ? ({
          kind: "found",
          path: parsed,
          resource: {
            resourceId: folderId,
            name: parsed.basename,
            type: "folder",
          },
        } as FoundResolution)
      : await this.resolve(parsed);
    if (resolved.kind !== "found" || !isFolder(resolved.resource)) {
      throw conflict(`The remote path is not a folder: ${parsed.normalized}.`);
    }

    return this.client.listFolder(resolved.resource.resourceId, { sort: "name,asc" });
  }
}

export const Resolver = RemoteResolver;

import { apiResponseError, DomainError } from "../errors.ts";
import type { CreateFolderInput, MyboxClient } from "../mybox/client.ts";
import type {
  CreateFolderResponse,
  ResourceDetail,
  ResourceItem,
  SearchResourceItem,
} from "../mybox/contract.ts";
import {
  type ChildRemotePath,
  canonicalRemoteName,
  hasCanonicalVariants,
  parseRemotePath,
  type RemotePath,
} from "./path.ts";

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
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

function conflict(message: string): DomainError {
  return new DomainError("conflict", message);
}

function unicodeCollision(path: string): DomainError {
  return new DomainError("conflict", `More than one Unicode-equivalent resource matches ${path}.`, {
    code: "UNICODE_NAME_COLLISION",
  });
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

function canonicalChildCandidates(
  resources: ResourceItem[],
  name: string,
): ResolvedSearchResource[] {
  const canonicalName = canonicalRemoteName(name);
  const matches: ResolvedSearchResource[] = [];
  const seen = new Set<string>();
  for (const resource of resources) {
    if (canonicalRemoteName(resource.name) !== canonicalName || seen.has(resource.resourceId)) {
      continue;
    }
    seen.add(resource.resourceId);
    matches.push({ ...resource, type: resource.type });
  }
  return matches;
}

function mergeCandidate(
  candidates: ResolvedSearchResource[],
  exact: ResolvedSearchResource | undefined,
): ResolvedSearchResource[] {
  if (
    exact === undefined ||
    candidates.some((candidate) => candidate.resourceId === exact.resourceId)
  ) {
    return candidates;
  }
  return [...candidates, exact];
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

  private async poll(
    load: () => Promise<PathResolution>,
    options: ResolveOptions,
  ): Promise<PathResolution> {
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

      const result = await load();
      if (result.kind !== "absent" || index === pollTimes.length - 1) {
        return result;
      }
    }

    throw apiResponseError("MYBOX path resolution polling ended unexpectedly.");
  }

  async resolve(input: string | RemotePath, options: ResolveOptions = {}): Promise<PathResolution> {
    const parsed = typeof input === "string" ? parseRemotePath(input) : input;
    if (parsed.kind === "root") {
      return { kind: "root", path: parsed, resource: null };
    }
    return this.poll(() => this.resolveOnce(parsed), options);
  }

  async resolveCanonical(
    input: string | RemotePath,
    options: ResolveOptions = {},
  ): Promise<PathResolution> {
    const parsed = typeof input === "string" ? parseRemotePath(input) : input;
    if (parsed.kind === "root") {
      return { kind: "root", path: parsed, resource: null };
    }
    return this.poll(() => this.resolveCanonicalOnce(parsed, false), options);
  }

  async resolveForMutation(
    input: string | RemotePath,
    options: ResolveOptions = {},
  ): Promise<PathResolution> {
    const parsed = typeof input === "string" ? parseRemotePath(input) : input;
    if (parsed.kind === "root") {
      return { kind: "root", path: parsed, resource: null };
    }
    return this.poll(() => this.resolveCanonicalOnce(parsed, true), options);
  }

  async resolveExact(
    input: string | ChildRemotePath,
    options: ResolveOptions = {},
  ): Promise<PathResolution> {
    const parsed = typeof input === "string" ? parseRemotePath(input) : input;
    if (parsed.kind === "root") {
      return { kind: "root", path: parsed, resource: null };
    }
    return this.poll(() => this.resolveExactOnce(parsed), options);
  }

  private async resolveExactOnce(path: ChildRemotePath): Promise<PathResolution> {
    const folder = await this.resolveFolderExactOnce(path);
    if (folder.kind === "found") {
      return folder;
    }
    return this.resolveFileExactOnce(path);
  }

  async resolveFolderExact(
    input: string | ChildRemotePath,
    options: ResolveOptions = {},
  ): Promise<PathResolution> {
    const parsed = typeof input === "string" ? parseRemotePath(input) : input;
    if (parsed.kind === "root") {
      return { kind: "root", path: parsed, resource: null };
    }
    return this.poll(() => this.resolveFolderExactOnce(parsed), options);
  }

  private async resolveFolderExactOnce(path: ChildRemotePath): Promise<PathResolution> {
    const folders = await this.client.searchFolders({ path: path.normalized });
    const folder = assertAtMostOne(
      exactFolderCandidates(folders, path.normalized),
      path.normalized,
      "folder",
    );
    return folder === undefined
      ? { kind: "absent", path, resource: null }
      : { kind: "found", path, resource: folder };
  }

  async resolveFileExact(
    input: string | ChildRemotePath,
    options: ResolveOptions = {},
  ): Promise<PathResolution> {
    const parsed = typeof input === "string" ? parseRemotePath(input) : input;
    if (parsed.kind === "root") {
      return { kind: "root", path: parsed, resource: null };
    }
    return this.poll(() => this.resolveFileExactOnce(parsed), options);
  }

  private async resolveFileExactOnce(path: ChildRemotePath): Promise<PathResolution> {
    const files = await this.client.searchFiles({
      q: path.basename,
      parentPath: path.parentPath,
    });
    const file = assertAtMostOne(exactFileCandidates(files, path), path.normalized, "file");
    return file === undefined
      ? { kind: "absent", path, resource: null }
      : { kind: "found", path, resource: file };
  }

  private async resolveOnce(path: ChildRemotePath): Promise<PathResolution> {
    for (let index = 0; index < path.components.length; index += 1) {
      const currentPath = joinComponents(path.components, index + 1);
      const current = parseRemotePath(currentPath);
      if (current.kind === "root") {
        throw apiResponseError("MYBOX path resolver built an invalid child path.");
      }

      const result = await this.resolveExactOnce(current);
      if (result.kind === "absent") {
        return { kind: "absent", path, resource: null };
      }
      if (result.kind === "root") {
        throw apiResponseError("MYBOX path resolver returned an invalid exact result.");
      }
      if (result.resource.type.toLowerCase() !== "folder") {
        if (index < path.components.length - 1) {
          throw conflict(`A file cannot be used as a directory: ${current.normalized}.`);
        }
        return { kind: "found", path, resource: result.resource };
      }
      if (index === path.components.length - 1) {
        return { kind: "found", path, resource: result.resource };
      }
    }

    return { kind: "absent", path, resource: null };
  }

  private async listDirectChildren(parentId: string | undefined): Promise<ResourceItem[]> {
    return parentId === undefined
      ? this.client.listRoot()
      : this.client.listFolder(parentId, { sort: "name,asc" });
  }

  private async resolveCanonicalOnce(
    path: ChildRemotePath,
    mutation: boolean,
  ): Promise<PathResolution> {
    const actualComponents: string[] = [];
    let parentId: string | undefined;

    for (let index = 0; index < path.components.length; index += 1) {
      const requestedName = path.components[index];
      if (requestedName === undefined) {
        throw apiResponseError("MYBOX canonical resolver lost a path component.");
      }

      const current = parseRemotePath(`/${[...actualComponents, requestedName].join("/")}`);
      if (current.kind === "root") {
        throw apiResponseError("MYBOX canonical resolver built an invalid child path.");
      }

      const exact = await this.resolveExactOnce(current);
      if (exact.kind === "root") {
        throw apiResponseError("MYBOX canonical resolver returned an invalid exact result.");
      }

      let resource = exact.kind === "found" ? exact.resource : undefined;
      if (hasCanonicalVariants(requestedName) && (mutation || resource === undefined)) {
        const listed = await this.listDirectChildren(parentId);
        const candidates = mergeCandidate(
          canonicalChildCandidates(listed, requestedName),
          resource,
        );
        if (candidates.length > 1) {
          throw unicodeCollision(path.normalized);
        }
        resource = candidates[0];
      }

      if (resource === undefined) {
        return { kind: "absent", path, resource: null };
      }
      if (resource.type.toLowerCase() !== "folder" && index < path.components.length - 1) {
        throw conflict(`A file cannot be used as a directory: ${current.normalized}.`);
      }
      if (index === path.components.length - 1) {
        return { kind: "found", path, resource };
      }

      actualComponents.push(resource.name);
      parentId = resource.resourceId;
    }

    return { kind: "absent", path, resource: null };
  }

  async detail(resolution: FoundResolution): Promise<ResourceDetail> {
    return this.client.getResource(resolution.resource.resourceId);
  }

  async createFolder(input: CreateFolderInput): Promise<CreateFolderResponse> {
    return this.client.createFolder(input);
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
      : await this.resolveCanonical(parsed);
    if (resolved.kind !== "found" || !isFolder(resolved.resource)) {
      throw conflict(`The remote path is not a folder: ${parsed.normalized}.`);
    }

    return this.client.listFolder(resolved.resource.resourceId, { sort: "name,asc" });
  }
}

export const Resolver = RemoteResolver;

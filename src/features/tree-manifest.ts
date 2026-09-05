import type { Dirent, Stats } from "node:fs";
import { lstat, readdir, realpath } from "node:fs/promises";
import { join } from "node:path";

import { apiResponseError, DomainError } from "../errors.ts";
import type { ResourceItem } from "../mybox/contract.ts";
import type { FoundResolution, RemoteResolver } from "../remote/resolver.ts";

export type FileIdentity = { dev: number; ino: number; size: number; mtimeMs: number };
export type DirectoryIdentity = { dev: number; ino: number; mtimeMs: number };
export type LocalTreeEntry =
  | {
      type: "folder";
      relativePath: string;
      name: string;
      path: string;
      identity: DirectoryIdentity;
    }
  | { type: "file"; relativePath: string; name: string; path: string; identity: FileIdentity };
export type LocalTreeManifest = {
  rootPath: string;
  rootRealPath: string;
  rootIdentity: DirectoryIdentity;
  entries: LocalTreeEntry[];
};

export type RemoteTreeEntry = {
  type: "file" | "folder";
  relativePath: string;
  name: string;
  resourceId: string;
  parentId: string;
  size: number;
  modifiedAt: string;
};
export type RemoteTreeManifest = {
  rootPath: string;
  rootResourceId: string;
  entries: RemoteTreeEntry[];
};

function identity(stats: Stats): DirectoryIdentity {
  return { dev: stats.dev, ino: stats.ino, mtimeMs: stats.mtimeMs };
}

function fileIdentity(stats: Stats): FileIdentity {
  return { ...identity(stats), size: stats.size };
}

export function assertPortableName(name: string): void {
  const stem = name.split(".", 1)[0]?.toUpperCase() ?? "";
  const hasControlCharacter = [...name].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
  if (
    name.length === 0 ||
    name === "." ||
    name === ".." ||
    hasControlCharacter ||
    /[<>:"/\\|?*]/u.test(name) ||
    /[ .]$/u.test(name) ||
    /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/u.test(stem)
  ) {
    throw new DomainError("conflict", `The recursive transfer name is not portable: ${name}.`, {
      code: "NON_PORTABLE_NAME",
    });
  }
}

function assertSiblingNames(entries: readonly { name: string }[], parent: string): void {
  const keys = new Set<string>();
  for (const entry of entries) {
    assertPortableName(entry.name);
    const key = entry.name.normalize("NFC").toLowerCase();
    if (keys.has(key)) {
      throw new DomainError("conflict", `Recursive transfer names collide under ${parent}.`, {
        code: "PORTABLE_NAME_COLLISION",
      });
    }
    keys.add(key);
  }
}

async function inspectLocal(path: string): Promise<Stats> {
  try {
    return await lstat(path);
  } catch (error) {
    throw new DomainError("local-file-changed", `The local transfer tree changed: ${path}.`, {
      cause: error,
    });
  }
}

export async function buildLocalTreeManifest(rootPath: string): Promise<LocalTreeManifest> {
  const root = await inspectLocal(rootPath);
  if (root.isSymbolicLink() || !root.isDirectory()) {
    throw new DomainError("local-file", "Recursive upload requires a real local directory.");
  }
  const rootRealPath = await realpath(rootPath).catch((error) => {
    throw new DomainError("local-file", "The local upload directory could not be resolved.", {
      cause: error,
    });
  });
  const entries: LocalTreeEntry[] = [];
  const walk = async (directory: string, relativeDirectory: string): Promise<void> => {
    let children: Dirent[];
    try {
      children = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      throw new DomainError("local-file", "The local upload directory could not be read.", {
        cause: error,
      });
    }
    children.sort((left, right) => left.name.localeCompare(right.name, "en"));
    assertSiblingNames(children, relativeDirectory || ".");
    for (const child of children) {
      const childPath = join(directory, child.name);
      const relativePath = relativeDirectory ? `${relativeDirectory}/${child.name}` : child.name;
      const stats = await inspectLocal(childPath);
      if (stats.isSymbolicLink()) {
        throw new DomainError("local-file", `Symbolic links are not supported: ${relativePath}.`);
      }
      if (stats.isDirectory()) {
        entries.push({
          type: "folder",
          relativePath,
          name: child.name,
          path: childPath,
          identity: identity(stats),
        });
        await walk(childPath, relativePath);
      } else if (stats.isFile()) {
        entries.push({
          type: "file",
          relativePath,
          name: child.name,
          path: childPath,
          identity: fileIdentity(stats),
        });
      } else {
        throw new DomainError(
          "local-file",
          `Non-regular entries are not supported: ${relativePath}.`,
        );
      }
    }
  };
  await walk(rootPath, "");
  return { rootPath, rootRealPath, rootIdentity: identity(root), entries };
}

export async function assertLocalTreeUnchanged(expected: LocalTreeManifest): Promise<void> {
  const current = await buildLocalTreeManifest(expected.rootPath);
  if (
    current.rootRealPath !== expected.rootRealPath ||
    JSON.stringify(current) !== JSON.stringify(expected)
  ) {
    throw new DomainError("local-file-changed", "The local upload tree changed during transfer.");
  }
}

function remoteEntry(resource: ResourceItem, relativePath: string): RemoteTreeEntry {
  const type = resource.type.toLowerCase();
  if (type !== "file" && type !== "folder")
    throw apiResponseError("MYBOX returned an invalid tree entry type.");
  return {
    type,
    relativePath,
    name: resource.name,
    resourceId: resource.resourceId,
    parentId: resource.parentId,
    size: resource.size,
    modifiedAt: resource.modifiedAt,
  };
}

export async function buildRemoteTreeManifest(
  rootPath: string,
  root: FoundResolution,
  resolver: RemoteResolver,
): Promise<RemoteTreeManifest> {
  if (root.resource.type.toLowerCase() !== "folder")
    throw new DomainError("conflict", "Recursive download requires a remote folder.");
  const entries: RemoteTreeEntry[] = [];
  const ids = new Set<string>([root.resource.resourceId]);
  const walk = async (path: string, id: string, relativeDirectory: string): Promise<void> => {
    const children = await resolver.listChildren(path, id);
    children.sort((left, right) => left.name.localeCompare(right.name, "en"));
    assertSiblingNames(children, relativeDirectory || ".");
    for (const child of children) {
      if (child.parentId !== id) {
        throw apiResponseError("MYBOX returned a child with an invalid parent ID.");
      }
      if (ids.has(child.resourceId))
        throw apiResponseError("MYBOX returned a duplicate resource ID in the folder tree.");
      ids.add(child.resourceId);
      const relativePath = relativeDirectory ? `${relativeDirectory}/${child.name}` : child.name;
      const entry = remoteEntry(child, relativePath);
      entries.push(entry);
      if (entry.type === "folder")
        await walk(`${path}/${child.name}`.replace("//", "/"), child.resourceId, relativePath);
    }
  };
  await walk(rootPath, root.resource.resourceId, "");
  return { rootPath, rootResourceId: root.resource.resourceId, entries };
}

export function sameRemoteTree(left: RemoteTreeManifest, right: RemoteTreeManifest): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

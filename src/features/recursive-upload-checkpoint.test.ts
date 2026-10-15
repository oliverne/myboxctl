import { afterEach, describe, expect, test } from "bun:test";
import { lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DomainError } from "../errors.ts";
import type { MyboxClient } from "../mybox/client.ts";
import type { MyboxUploader } from "../mybox/upload.ts";
import { parseRemotePath } from "../remote/path.ts";
import type { PathResolution, RemoteResolver } from "../remote/resolver.ts";
import { runRecursiveUpload } from "./recursive-upload.ts";
import { buildLocalTreeManifest } from "./tree-manifest.ts";
import type { UploadDependencies } from "./upload.ts";
import {
  commitCheckpointFile,
  createCheckpointFile,
  createInitialCheckpoint,
  readCheckpointFile,
  type UploadCheckpoint,
} from "./upload-checkpoint.ts";
import { runUploadCommand } from "./upload-command.ts";

const temporaryDirectories: string[] = [];
afterEach(async () =>
  Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  ),
);

const fixedNow = () => Date.parse("2026-10-15T00:00:00.000Z");
const fixedIso = new Date(fixedNow()).toISOString();

type FakeResource = {
  resourceId: string;
  parentId: string | null;
  name: string;
  type: "folder" | "file";
  size: number;
  modifiedAt: string;
};

type FakeRemote = {
  resolver: RemoteResolver;
  client: MyboxClient;
  uploader: MyboxUploader;
  resources: Map<string, FakeResource>;
  seed: (path: string, resource: FakeResource) => void;
  createFolderCalls: string[];
  reservationCount: number;
  failedUploads: Set<string>;
};

function childPath(path: string) {
  const parsed = parseRemotePath(path);
  if (parsed.kind === "root") throw new Error("the fake remote root path was invalid");
  return parsed;
}

function createFakeRemote(): FakeRemote {
  const resources = new Map<string, FakeResource>();
  const byId = new Map<string, string>();
  const createFolderCalls: string[] = [];
  const failedUploads = new Set<string>();
  let nextId = 1;
  let reservationCount = 0;
  let lastReservation:
    | { fileName: string; fileSize: number; parentId?: string; modifiedTime: string }
    | undefined;

  const add = (path: string, resource: FakeResource): void => {
    resources.set(path, resource);
    byId.set(resource.resourceId, path);
  };
  const pathOf = (input: string | { normalized: string }): string =>
    typeof input === "string" ? input : input.normalized;
  const toResolution = (path: string): PathResolution => {
    if (path === "/") {
      return {
        kind: "root",
        path: {
          kind: "root",
          normalized: "/",
          components: [],
          parentPath: undefined,
          basename: undefined,
        },
        resource: null,
      } as PathResolution;
    }
    const resource = resources.get(path);
    if (resource === undefined) {
      return { kind: "absent", path: childPath(path), resource: null };
    }
    return {
      kind: "found",
      path: childPath(path),
      resource: {
        resourceId: resource.resourceId,
        name: resource.name,
        type: resource.type,
        parentId: resource.parentId ?? undefined,
        size: resource.size,
        modifiedAt: resource.modifiedAt,
        path,
      },
    } as PathResolution;
  };

  add("/", {
    resourceId: "drive-root",
    parentId: null,
    name: "",
    type: "folder",
    size: 0,
    modifiedAt: fixedIso,
  });

  const resolver = {
    resolveCanonical: async (input: string | { normalized: string }) => toResolution(pathOf(input)),
    resolveForMutation: async (input: string | { normalized: string }) =>
      toResolution(pathOf(input)),
    resolveFileExact: async (input: string | { normalized: string }) => toResolution(pathOf(input)),
    createFolder: async (input: { folderName: string; parentId?: string }) => {
      createFolderCalls.push(input.folderName);
      const parentPath = input.parentId === undefined ? "/" : byId.get(input.parentId);
      if (parentPath === undefined) throw new Error("the fake remote lost the parent ID");
      const path =
        parentPath === "/" ? `/${input.folderName}` : `${parentPath}/${input.folderName}`;
      if (resources.has(path)) {
        throw new DomainError("conflict", `A remote resource already exists at ${path}.`);
      }
      const resource: FakeResource = {
        resourceId: `folder-${nextId++}`,
        parentId: input.parentId ?? null,
        name: input.folderName,
        type: "folder",
        size: 0,
        modifiedAt: fixedIso,
      };
      add(path, resource);
      return { name: input.folderName, resourceId: resource.resourceId };
    },
    listChildren: async (input: string | { normalized: string }) => {
      const path = pathOf(input);
      const folder = resources.get(path);
      if (folder === undefined || folder.type !== "folder") {
        throw new DomainError("not-found", `The fake remote folder is missing: ${path}.`);
      }
      return [...resources.entries()]
        .filter(([, resource]) => resource.parentId === folder.resourceId)
        .sort(([left], [right]) => left.localeCompare(right, "en"))
        .map(([childPathValue, resource]) => ({
          resourceId: resource.resourceId,
          parentId: resource.parentId as string,
          name: resource.name,
          type: resource.type,
          size: resource.size,
          createdAt: fixedIso,
          modifiedAt: resource.modifiedAt,
          accessedAt: fixedIso,
          isFavorite: false,
          isHidden: false,
          lastModifiedBy: "tester",
          path: childPathValue,
          parentPath: path,
        }));
    },
  } as unknown as RemoteResolver;

  const client = {
    getStorage: async () => ({ maxFileBytes: 10_000_000 }),
    createUpload: async (input: {
      fileName: string;
      fileSize: number;
      parentId?: string;
      modifiedTime?: string;
    }) => {
      reservationCount += 1;
      lastReservation = {
        fileName: input.fileName,
        fileSize: input.fileSize,
        ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
        modifiedTime: input.modifiedTime ?? fixedIso,
      };
      return { uploadUrl: "https://upload.test/one", offset: 0 };
    },
    getResource: async (resourceId: string) => {
      const path = byId.get(resourceId);
      const resource = path === undefined ? undefined : resources.get(path);
      if (path === undefined || resource === undefined) {
        throw new DomainError("not-found", `The fake remote resource is missing: ${resourceId}.`);
      }
      return {
        resourceId: resource.resourceId,
        parentId: resource.parentId ?? "drive-root",
        name: resource.name,
        type: resource.type,
        size: resource.size,
        createdAt: fixedIso,
        modifiedAt: resource.modifiedAt,
        accessedAt: fixedIso,
        isFavorite: false,
        isHidden: false,
        lastModifiedBy: "tester",
        path,
        parentPath: "/",
      };
    },
  } as unknown as MyboxClient;

  const uploader = {
    uploadContent: async () => {
      const reservation = lastReservation;
      if (reservation === undefined) throw new Error("the fake remote lost the reservation");
      if (failedUploads.has(reservation.fileName)) {
        failedUploads.delete(reservation.fileName);
        throw new DomainError("api-unavailable", "The injected upload failed.", {
          retryable: false,
        });
      }
      const parentPath = reservation.parentId === undefined ? "/" : byId.get(reservation.parentId);
      if (parentPath === undefined) throw new Error("the fake remote lost the parent ID");
      const path =
        parentPath === "/" ? `/${reservation.fileName}` : `${parentPath}/${reservation.fileName}`;
      if (resources.has(path)) {
        throw new DomainError("conflict", `A remote file already exists at ${path}.`);
      }
      const resource: FakeResource = {
        resourceId: `file-${nextId++}`,
        parentId: reservation.parentId ?? null,
        name: reservation.fileName,
        type: "file",
        size: reservation.fileSize,
        modifiedAt: reservation.modifiedTime,
      };
      add(path, resource);
      return {
        resourceId: resource.resourceId,
        name: reservation.fileName,
        fileSize: reservation.fileSize,
      };
    },
  } as unknown as MyboxUploader;

  return {
    resolver,
    client,
    uploader,
    resources,
    seed: add,
    createFolderCalls,
    get reservationCount() {
      return reservationCount;
    },
    failedUploads,
  };
}

function dependencies(fake: FakeRemote): UploadDependencies {
  return {
    resolver: fake.resolver,
    client: fake.client,
    uploader: fake.uploader,
    timeoutMs: 1_000,
    now: fixedNow,
  };
}

async function localFixture(): Promise<{ root: string; local: string; checkpoint: string }> {
  const root = await mkdtemp(join(tmpdir(), "myboxctl-upload-checkpoint-"));
  temporaryDirectories.push(root);
  const local = join(root, "payload");
  await mkdir(join(local, "nested", "empty"), { recursive: true });
  await writeFile(join(local, "b.txt"), "b");
  await writeFile(join(local, "nested", "a.txt"), "a");
  return { root, local, checkpoint: join(root, "payload.upload.json") };
}

async function seedCheckpoint(
  path: string,
  local: string,
  mutate: (checkpoint: UploadCheckpoint) => UploadCheckpoint,
): Promise<UploadCheckpoint> {
  const manifest = await buildLocalTreeManifest(local);
  const checkpoint = mutate(
    createInitialCheckpoint(manifest, "/payload", () => new Date(fixedNow())),
  );
  await createCheckpointFile(path, checkpoint);
  await commitCheckpointFile(path, checkpoint);
  return checkpoint;
}

describe("recursive upload checkpoint", () => {
  test("uploads a tree with a new checkpoint and removes it on success", async () => {
    const { local, checkpoint } = await localFixture();
    const fake = createFakeRemote();

    const result = await runRecursiveUpload(
      local,
      "/",
      { recursive: true, checkpoint },
      dependencies(fake),
    );

    expect(result.data).toMatchObject({
      remotePath: "/payload",
      filesUploaded: 2,
      foldersCreated: 3,
      bytesUploaded: 2,
      filesSkipped: 0,
      foldersSkipped: 0,
      resumed: false,
      checkpointPath: checkpoint,
    });
    expect([...fake.resources.keys()].sort()).toEqual([
      "/",
      "/payload",
      "/payload/b.txt",
      "/payload/nested",
      "/payload/nested/a.txt",
      "/payload/nested/empty",
    ]);
    await expect(lstat(checkpoint)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(`${checkpoint}.lock`)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("keeps a partial checkpoint and resumes from the completed entries", async () => {
    const { local, checkpoint } = await localFixture();
    const fake = createFakeRemote();
    fake.failedUploads.add("a.txt");

    await expect(
      runRecursiveUpload(local, "/", { recursive: true, checkpoint }, dependencies(fake)),
    ).rejects.toMatchObject({ kind: "api-unavailable" });

    const saved = await readCheckpointFile(checkpoint);
    expect(saved.files["b.txt"]).toBeDefined();
    expect(saved.files["nested/a.txt"]).toBeUndefined();
    expect(saved.inFlight).toMatchObject({ kind: "file", relativePath: "nested/a.txt" });
    const folderCallsBeforeResume = fake.createFolderCalls.length;
    const reservationsBeforeResume = fake.reservationCount;

    const result = await runRecursiveUpload(
      local,
      "/",
      { recursive: true, resume: checkpoint },
      dependencies(fake),
    );

    expect(result.data).toMatchObject({
      resumed: true,
      filesUploaded: 1,
      filesSkipped: 1,
      foldersCreated: 0,
      foldersSkipped: 3,
      bytesUploaded: 1,
      bytesSkipped: 1,
    });
    expect(fake.createFolderCalls.length).toBe(folderCallsBeforeResume);
    expect(fake.reservationCount).toBe(reservationsBeforeResume + 1);
    expect(fake.resources.has("/payload/nested/a.txt")).toBe(true);
    await expect(lstat(checkpoint)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("fails closed when an in-flight file exists remotely", async () => {
    const { local, checkpoint } = await localFixture();
    const fake = createFakeRemote();
    await seedCheckpoint(checkpoint, local, (value) => ({
      ...value,
      remote: { rootPath: "/payload", rootResourceId: "root-id" },
      folders: { "": { resourceId: "root-id", parentId: null, name: "payload" } },
      inFlight: {
        kind: "file",
        relativePath: "b.txt",
        parentId: "root-id",
        name: "b.txt",
        local: { dev: 1, ino: 2, mtimeMs: 3, size: 1 },
      },
    }));
    const manifest = await buildLocalTreeManifest(local);
    const bEntry = manifest.entries.find((entry) => entry.relativePath === "b.txt");
    fake.seed("/payload", {
      resourceId: "root-id",
      parentId: "drive-root",
      name: "payload",
      type: "folder",
      size: 0,
      modifiedAt: fixedIso,
    });
    fake.seed("/payload/b.txt", {
      resourceId: "file-id",
      parentId: "root-id",
      name: "b.txt",
      type: "file",
      size: bEntry?.type === "file" ? bEntry.identity.size : 1,
      modifiedAt: fixedIso,
    });

    await expect(
      runRecursiveUpload(local, "/", { recursive: true, resume: checkpoint }, dependencies(fake)),
    ).rejects.toMatchObject({ kind: "api-unavailable", code: "RESUME_UNCERTAIN" });
    expect(fake.reservationCount).toBe(0);
  });

  test("fails closed when an in-flight folder exists remotely", async () => {
    const { local, checkpoint } = await localFixture();
    const fake = createFakeRemote();
    await seedCheckpoint(checkpoint, local, (value) => ({
      ...value,
      remote: { rootPath: "/payload", rootResourceId: "root-id" },
      folders: { "": { resourceId: "root-id", parentId: null, name: "payload" } },
      inFlight: { kind: "folder", relativePath: "nested", parentId: "root-id", name: "nested" },
    }));
    fake.seed("/payload", {
      resourceId: "root-id",
      parentId: "drive-root",
      name: "payload",
      type: "folder",
      size: 0,
      modifiedAt: fixedIso,
    });
    fake.seed("/payload/nested", {
      resourceId: "folder-id",
      parentId: "root-id",
      name: "nested",
      type: "folder",
      size: 0,
      modifiedAt: fixedIso,
    });

    await expect(
      runRecursiveUpload(local, "/", { recursive: true, resume: checkpoint }, dependencies(fake)),
    ).rejects.toMatchObject({ code: "RESUME_UNCERTAIN" });
    expect(fake.createFolderCalls).toEqual([]);
  });

  test("fails closed when the root was created before the checkpoint committed", async () => {
    const { local, checkpoint } = await localFixture();
    const fake = createFakeRemote();
    await seedCheckpoint(checkpoint, local, (value) => ({
      ...value,
      inFlight: { kind: "folder", relativePath: "", parentId: null, name: "payload" },
    }));
    fake.seed("/payload", {
      resourceId: "root-id",
      parentId: "drive-root",
      name: "payload",
      type: "folder",
      size: 0,
      modifiedAt: fixedIso,
    });

    await expect(
      runRecursiveUpload(local, "/", { recursive: true, resume: checkpoint }, dependencies(fake)),
    ).rejects.toMatchObject({ code: "RESUME_UNCERTAIN" });
    expect(fake.createFolderCalls).toEqual([]);
  });

  test("creates the root on resume when it was never created", async () => {
    const { local, checkpoint } = await localFixture();
    const fake = createFakeRemote();
    await seedCheckpoint(checkpoint, local, (value) => ({
      ...value,
      inFlight: { kind: "folder", relativePath: "", parentId: null, name: "payload" },
    }));

    const result = await runRecursiveUpload(
      local,
      "/",
      { recursive: true, resume: checkpoint },
      dependencies(fake),
    );

    expect(result.data).toMatchObject({ resumed: true, filesUploaded: 2, foldersCreated: 3 });
    expect(fake.createFolderCalls).toEqual(["payload", "nested", "empty"]);
  });

  test("rejects a changed local tree before any remote mutation", async () => {
    const { local, checkpoint } = await localFixture();
    const fake = createFakeRemote();
    await seedCheckpoint(checkpoint, local, (value) => value);
    await writeFile(join(local, "b.txt"), "changed");

    await expect(
      runRecursiveUpload(local, "/", { recursive: true, resume: checkpoint }, dependencies(fake)),
    ).rejects.toMatchObject({ kind: "local-file-changed", code: "RESUME_LOCAL_MISMATCH" });
    expect(fake.createFolderCalls).toEqual([]);
    expect(fake.reservationCount).toBe(0);
  });

  test("rejects an unexpected remote entry and a missing completed entry", async () => {
    const { local, checkpoint } = await localFixture();
    const fake = createFakeRemote();
    await seedCheckpoint(checkpoint, local, (value) => ({
      ...value,
      remote: { rootPath: "/payload", rootResourceId: "root-id" },
      folders: { "": { resourceId: "root-id", parentId: null, name: "payload" } },
    }));
    fake.seed("/payload", {
      resourceId: "root-id",
      parentId: "drive-root",
      name: "payload",
      type: "folder",
      size: 0,
      modifiedAt: fixedIso,
    });
    fake.seed("/payload/extra.txt", {
      resourceId: "extra-id",
      parentId: "root-id",
      name: "extra.txt",
      type: "file",
      size: 1,
      modifiedAt: fixedIso,
    });

    await expect(
      runRecursiveUpload(local, "/", { recursive: true, resume: checkpoint }, dependencies(fake)),
    ).rejects.toMatchObject({ kind: "conflict", code: "RESUME_REMOTE_UNEXPECTED" });

    fake.resources.delete("/payload/extra.txt");
    fake.seed("/payload/b.txt", {
      resourceId: "file-id",
      parentId: "root-id",
      name: "b.txt",
      type: "file",
      size: 1,
      modifiedAt: fixedIso,
    });
    const manifest = await buildLocalTreeManifest(local);
    const bEntry = manifest.entries.find((entry) => entry.relativePath === "b.txt");
    await commitCheckpointFile(checkpoint, {
      ...(await readCheckpointFile(checkpoint)),
      files: {
        "b.txt": {
          resourceId: "other-id",
          parentId: "root-id",
          name: "b.txt",
          size: bEntry?.type === "file" ? bEntry.identity.size : 1,
          modifiedAt: fixedIso,
          local: { dev: 1, ino: 2, mtimeMs: 3, size: 1 },
        },
      },
    });

    await expect(
      runRecursiveUpload(local, "/", { recursive: true, resume: checkpoint }, dependencies(fake)),
    ).rejects.toMatchObject({ kind: "conflict", code: "RESUME_REMOTE_MISMATCH" });
  });

  test("rejects checkpoint options for file sources and without --recursive", async () => {
    const { local, checkpoint } = await localFixture();
    const fake = createFakeRemote();
    const file = join(local, "b.txt");

    await expect(
      runUploadCommand(file, "/payload/", { checkpoint }, dependencies(fake)),
    ).rejects.toMatchObject({ kind: "invalid-arguments" });
    await expect(
      runUploadCommand(local, "/payload/", { checkpoint, resume: checkpoint }, dependencies(fake)),
    ).rejects.toMatchObject({ kind: "invalid-arguments" });
    await expect(
      runRecursiveUpload(
        local,
        "/",
        { recursive: true, checkpoint, force: true },
        dependencies(fake),
      ),
    ).rejects.toMatchObject({ kind: "invalid-arguments" });
  });
});

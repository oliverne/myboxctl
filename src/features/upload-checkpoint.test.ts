import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DomainError } from "../errors.ts";
import { buildLocalTreeManifest } from "./tree-manifest.ts";
import {
  acquireCheckpointLock,
  commitCheckpointFile,
  createCheckpointFile,
  createInitialCheckpoint,
  manifestFingerprint,
  readCheckpointFile,
  removeCheckpointFile,
  type UploadCheckpoint,
} from "./upload-checkpoint.ts";

const temporaryDirectories: string[] = [];
afterEach(async () =>
  Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  ),
);

async function temporaryDirectory(prefix = "myboxctl-checkpoint-"): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

const clock = () => new Date("2026-10-15T00:00:00.000Z");

async function manifestFixture(): Promise<{
  root: string;
  checkpoint: UploadCheckpoint;
}> {
  const root = await temporaryDirectory();
  await mkdir(join(root, "nested"));
  await writeFile(join(root, "a.txt"), "abc");
  await writeFile(join(root, "nested", "b.txt"), "defg");
  const manifest = await buildLocalTreeManifest(root);
  return { root, checkpoint: createInitialCheckpoint(manifest, "/remote", clock) };
}

describe("upload checkpoint storage", () => {
  test("round-trips an initial checkpoint without secret-shaped fields", async () => {
    const root = await temporaryDirectory();
    const path = join(root, "upload.json");
    const { checkpoint } = await manifestFixture();

    await createCheckpointFile(path, checkpoint);
    const loaded = await readCheckpointFile(path);

    expect(loaded).toEqual(checkpoint);
    const text = await readFile(path, "utf8");
    expect(text).not.toMatch(/mbx_pat_|authorization|uploadUrl|https?:\/\//i);
    if (process.platform !== "win32") {
      expect(((await stat(path)).mode & 0o777).toString(8)).toBe("600");
    }
  });

  test("rejects invalid JSON and schema drift", async () => {
    const root = await temporaryDirectory();
    const path = join(root, "upload.json");
    await writeFile(path, "{ not json\n");
    await expect(readCheckpointFile(path)).rejects.toMatchObject({
      kind: "local-file",
      code: "CHECKPOINT_INVALID",
    });

    const { checkpoint } = await manifestFixture();
    await writeFile(path, `${JSON.stringify({ ...checkpoint, extra: true })}\n`);
    await expect(readCheckpointFile(path)).rejects.toMatchObject({
      code: "CHECKPOINT_INVALID",
    });
    await writeFile(path, `${JSON.stringify({ ...checkpoint, schemaVersion: 2 })}\n`);
    await expect(readCheckpointFile(path)).rejects.toMatchObject({
      code: "CHECKPOINT_INVALID",
    });
    await expect(readCheckpointFile(join(root, "missing.json"))).rejects.toMatchObject({
      code: "CHECKPOINT_UNREADABLE",
    });
  });

  test("creates exclusively and requires a real parent directory", async () => {
    const { root, checkpoint } = await manifestFixture();
    const path = join(root, "upload.json");

    await createCheckpointFile(path, checkpoint);
    await expect(createCheckpointFile(path, checkpoint)).rejects.toMatchObject({
      code: "CHECKPOINT_EXISTS",
    });
    await expect(
      createCheckpointFile(join(root, "missing", "upload.json"), checkpoint),
    ).rejects.toMatchObject({ code: "CHECKPOINT_PARENT_MISSING" });

    const fileParent = join(root, "a.txt", "upload.json");
    await expect(createCheckpointFile(fileParent, checkpoint)).rejects.toMatchObject({
      code: "CHECKPOINT_PARENT_INVALID",
    });
  });

  test("commits atomically without leaving temporary files", async () => {
    const root = await temporaryDirectory();
    const path = join(root, "upload.json");
    const { checkpoint } = await manifestFixture();
    await createCheckpointFile(path, checkpoint);

    const updated: UploadCheckpoint = {
      ...checkpoint,
      state: "completed",
      inFlight: {
        kind: "file",
        relativePath: "a.txt",
        parentId: "parent-1",
        name: "a.txt",
        local: { dev: 1, ino: 2, mtimeMs: 3, size: 4 },
      },
    };
    await commitCheckpointFile(path, updated);

    expect(await readCheckpointFile(path)).toEqual(updated);
    expect((await readdir(root)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    if (process.platform !== "win32") {
      expect(((await stat(path)).mode & 0o777).toString(8)).toBe("600");
    }
  });

  test("removes a checkpoint idempotently", async () => {
    const root = await temporaryDirectory();
    const path = join(root, "upload.json");
    const { checkpoint } = await manifestFixture();
    await createCheckpointFile(path, checkpoint);
    await removeCheckpointFile(path);
    await expect(readCheckpointFile(path)).rejects.toMatchObject({
      code: "CHECKPOINT_UNREADABLE",
    });
    await expect(removeCheckpointFile(path)).resolves.toBeUndefined();
  });

  test("fingerprints the manifest identity deterministically", async () => {
    const root = await temporaryDirectory();
    await writeFile(join(root, "a.txt"), "abc");
    const first = await buildLocalTreeManifest(root);
    const second = await buildLocalTreeManifest(root);
    expect(manifestFingerprint(first)).toBe(manifestFingerprint(second));

    await writeFile(join(root, "a.txt"), "abcdef");
    const changed = await buildLocalTreeManifest(root);
    expect(manifestFingerprint(changed)).not.toBe(manifestFingerprint(first));
  });
});

describe("upload checkpoint lock", () => {
  test("acquires exclusively and releases only its own lock", async () => {
    const root = await temporaryDirectory();
    const path = join(root, "upload.json");
    const lock = await acquireCheckpointLock(path, { token: "first", host: "host-a" });
    expect(lock.path).toBe(`${path}.lock`);

    await expect(
      acquireCheckpointLock(path, { token: "second", host: "host-a", isProcessAlive: () => true }),
    ).rejects.toMatchObject({ kind: "local-file", code: "CHECKPOINT_LOCKED" });

    await writeFile(lock.path, `${JSON.stringify({ token: "someone-else" })}\n`);
    await lock.release();
    expect((await readdir(root)).sort()).toEqual(["upload.json.lock"]);

    await rm(lock.path);
    const reacquired = await acquireCheckpointLock(path, { token: "third", host: "host-a" });
    await reacquired.release();
    expect(await readdir(root)).toEqual([]);
  });

  test("reclaims a lock only when the owner is provably gone", async () => {
    const root = await temporaryDirectory();
    const path = join(root, "upload.json");
    const lockPath = `${path}.lock`;

    await writeFile(
      lockPath,
      `${JSON.stringify({ schemaVersion: 1, token: "stale", pid: 40_000, host: "host-a", startedAt: clock().toISOString() })}\n`,
    );
    const reclaimed = await acquireCheckpointLock(path, {
      token: "fresh",
      host: "host-a",
      isProcessAlive: (pid) => pid !== 40_000,
    });
    await reclaimed.release();

    await writeFile(
      lockPath,
      `${JSON.stringify({ schemaVersion: 1, token: "alive", pid: 40_000, host: "host-a" })}\n`,
    );
    await expect(
      acquireCheckpointLock(path, { token: "fresh", host: "host-a", isProcessAlive: () => true }),
    ).rejects.toMatchObject({ code: "CHECKPOINT_LOCKED" });

    await expect(
      acquireCheckpointLock(path, { token: "fresh", host: "host-b", isProcessAlive: () => false }),
    ).rejects.toMatchObject({ code: "CHECKPOINT_LOCKED" });

    await writeFile(lockPath, "not-json\n");
    await expect(
      acquireCheckpointLock(path, { token: "fresh", host: "host-a", isProcessAlive: () => false }),
    ).rejects.toMatchObject({ code: "CHECKPOINT_LOCKED" });
  });

  test("fails with a local-file error when the lock cannot be created", async () => {
    const root = await temporaryDirectory();
    const path = join(root, "missing", "upload.json");
    await expect(acquireCheckpointLock(path)).rejects.toBeInstanceOf(DomainError);
  });
});

import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildLocalTreeManifest } from "./tree-manifest.ts";

const temporaryDirectories: string[] = [];
afterEach(async () =>
  Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  ),
);

async function fixture(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "myboxctl-tree-"));
  temporaryDirectories.push(path);
  return path;
}

describe("local recursive manifest", () => {
  test("keeps empty folders and deterministic file metadata", async () => {
    const root = await fixture();
    await mkdir(join(root, "empty"));
    await writeFile(join(root, "한글.txt"), "abc");
    const manifest = await buildLocalTreeManifest(root);
    expect(manifest.entries.map((entry) => [entry.type, entry.relativePath])).toEqual([
      ["folder", "empty"],
      ["file", "한글.txt"],
    ]);
    expect(manifest.entries[1]).toMatchObject({ type: "file", identity: { size: 3 } });
  });

  test("rejects symlinks and non-portable names", async () => {
    const root = await fixture();
    await writeFile(join(root, "target"), "x");
    await symlink(join(root, "target"), join(root, "link"));
    await expect(buildLocalTreeManifest(root)).rejects.toMatchObject({ kind: "local-file" });

    const invalid = await fixture();
    await writeFile(join(invalid, "CON.txt"), "a");
    await expect(buildLocalTreeManifest(invalid)).rejects.toMatchObject({
      code: "NON_PORTABLE_NAME",
    });
  });
});

import { afterEach, describe, expect, test } from "bun:test";
import { lstat, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  commitDownloadFile,
  type PreparedDownloadFile,
  prepareDownloadFile,
  removeDownloadTemp,
} from "./download-file.ts";

const directories: string[] = [];
const preparedFiles: PreparedDownloadFile[] = [];

afterEach(async () => {
  for (const file of preparedFiles.splice(0)) {
    await file.handle.close().catch(() => undefined);
    await removeDownloadTemp(file).catch(() => undefined);
  }
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function directory(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "myboxctl-download-local-"));
  directories.push(value);
  return value;
}

async function prepared(path: string, overwrite = false): Promise<PreparedDownloadFile> {
  const value = await prepareDownloadFile(path, overwrite);
  preparedFiles.push(value);
  return value;
}

describe("local download file commit", () => {
  test("publishes a completed new file without clobbering", async () => {
    const root = await directory();
    const destination = join(root, "report.txt");
    const file = await prepared(destination);
    await file.handle.writeFile("complete");
    await file.handle.sync();
    await file.handle.close();

    await commitDownloadFile(file);

    expect(await readFile(destination, "utf8")).toBe("complete");
    await expect(lstat(file.tempPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("atomically replaces an existing regular file only with overwrite", async () => {
    const root = await directory();
    const destination = join(root, "report.txt");
    await writeFile(destination, "old");
    await expect(prepareDownloadFile(destination, false)).rejects.toMatchObject({
      kind: "conflict",
    });

    const file = await prepared(destination, true);
    await file.handle.writeFile("new");
    await file.handle.close();
    await commitDownloadFile(file);

    expect(await readFile(destination, "utf8")).toBe("new");
  });

  test("preserves a destination created concurrently", async () => {
    const root = await directory();
    const destination = join(root, "report.txt");
    const file = await prepared(destination);
    await file.handle.writeFile("download");
    await file.handle.close();
    await writeFile(destination, "concurrent");

    await expect(commitDownloadFile(file)).rejects.toMatchObject({ kind: "conflict" });
    expect(await readFile(destination, "utf8")).toBe("concurrent");
  });

  test("preserves an overwrite destination that changed during transfer", async () => {
    const root = await directory();
    const destination = join(root, "report.txt");
    await writeFile(destination, "old");
    const file = await prepared(destination, true);
    await file.handle.writeFile("download");
    await file.handle.close();
    await rm(destination);
    await writeFile(destination, "changed");

    await expect(commitDownloadFile(file)).rejects.toMatchObject({ kind: "conflict" });
    expect(await readFile(destination, "utf8")).toBe("changed");
  });

  test("rejects symbolic links and non-regular destinations", async () => {
    const root = await directory();
    const target = join(root, "target.txt");
    const link = join(root, "link.txt");
    await writeFile(target, "target");
    await symlink(target, link);

    await expect(prepareDownloadFile(link, true)).rejects.toMatchObject({ kind: "local-file" });
    await expect(prepareDownloadFile(root, true)).rejects.toMatchObject({ kind: "local-file" });
    expect(await readFile(target, "utf8")).toBe("target");
  });
});

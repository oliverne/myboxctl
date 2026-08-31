import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveDownloadDestination } from "./download-command.ts";
import { resolveUploadDestination } from "./upload-command.ts";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function childPath(path: string, kind: "folder" | "file") {
  return {
    kind: "found" as const,
    path: {
      kind: "child" as const,
      normalized: path,
      components: path.slice(1).split("/"),
      parentPath: "/",
      basename: path.slice(path.lastIndexOf("/") + 1),
    },
    resource: {
      resourceId: `${kind}-1`,
      name: path.slice(path.lastIndexOf("/") + 1),
      type: kind,
      path,
      parentPath: "/",
    },
  };
}

const baseDependencies = {
  client: {},
  uploader: {},
  downloader: {},
  timeoutMs: 1_000,
  resolver: { resolveCanonical: async () => ({ kind: "absent", resource: null }) },
} as never;

describe("destination semantics", () => {
  test("keeps exact remote files while appending basename to existing directories", async () => {
    const existingDirectory = {
      client: {},
      uploader: {},
      downloader: {},
      timeoutMs: 1_000,
      resolver: { resolveCanonical: async () => childPath("/store", "folder") },
    } as never;
    await expect(
      resolveUploadDestination("./report.txt", "/store", {}, existingDirectory),
    ).resolves.toBe("/store/report.txt");

    await expect(
      resolveUploadDestination("./report.txt", "/new-file", {}, baseDependencies),
    ).resolves.toBe("/new-file");
  });

  test("requires --mkdir for a missing directory-intent destination", async () => {
    await expect(
      resolveUploadDestination("./report.txt", "/missing/", {}, baseDependencies),
    ).rejects.toMatchObject({ kind: "not-found" });
  });

  test("uses ./basename for omitted and dot local destinations", async () => {
    const resolver = {
      resolveCanonical: async () => childPath("/report.txt", "file"),
    } as never;
    await expect(resolveDownloadDestination("/report.txt", undefined, resolver)).resolves.toBe(
      "./report.txt",
    );
    await expect(resolveDownloadDestination("/report.txt", ".", resolver)).resolves.toBe(
      "./report.txt",
    );
  });

  test("appends the remote basename to an existing local directory", async () => {
    const directory = await mkdtemp(join(tmpdir(), "myboxctl-destination-"));
    directories.push(directory);
    const resolver = {
      resolveCanonical: async () => childPath("/report.txt", "file"),
    } as never;
    await expect(resolveDownloadDestination("/report.txt", directory, resolver)).resolves.toBe(
      join(directory, "report.txt"),
    );
  });
});

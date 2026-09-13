import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  apiRequest,
  exactPathResource,
  isRecord,
  joinRemotePath,
  listPages,
  parseSafeCliEvents,
} from "./helpers.ts";

const PREFIX_PATH = "/myboxctl-integration-test/";
const integrationEnabled = process.env.MYBOX_INTEGRATION === "1" && Boolean(process.env.MYBOX_PAT);
const describeIntegration = integrationEnabled ? describe : describe.skip;
if (integrationEnabled) {
  setDefaultTimeout(900_000);
}

type CliOutput = {
  ok: boolean;
  action?: string;
  data?: { path?: string; newPath?: string; resourceId?: string; type?: string };
  error?: { kind?: string; code?: string | null };
};

let localDirectory = "";
let localFilePath = "";
let rootPath = "";
let rootId = "";

async function runCli(args: string[]) {
  const subprocess = Bun.spawn(["bun", "run", "src/cli.ts", ...args], {
    cwd: process.cwd(),
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
    subprocess.exited,
  ]);
  parseSafeCliEvents(stderr, args[0] ?? "unknown");
  return { exitCode, stdout, stderr };
}

function parseOutput(stdout: string): CliOutput {
  const output = JSON.parse(stdout) as unknown;
  if (!isRecord(output)) {
    throw new Error("rename/move acceptance returned a non-object JSON response");
  }
  return output as CliOutput;
}

async function exactResource(path: string, type: "file" | "folder") {
  const endpoint = type === "file" ? "/v1/search/resources/files" : "/v1/search/resources/folders";
  const query =
    type === "file"
      ? {
          q: path.slice(path.lastIndexOf("/") + 1),
          parentPath: path.slice(0, path.lastIndexOf("/")) || "/",
          count: "20",
        }
      : { path, count: "20" };
  const result = await listPages(endpoint, query);
  return exactPathResource(result.resources, path);
}

async function deleteForCleanup(path: string, id: string): Promise<void> {
  if (!path.startsWith(PREFIX_PATH)) {
    throw new Error(`refusing to clean a path outside the integration prefix: ${path}`);
  }
  for (const waitMs of [0, 5_000, 10_000, 20_000]) {
    if (waitMs > 0) {
      await Bun.sleep(waitMs);
    }
    const response = await apiRequest(`/v1/drive/resources/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (response.status === 204 || response.status === 404) {
      return;
    }
    if (response.status !== 429 || waitMs === 20_000) {
      throw new Error(`cleanup failed for ${path}: HTTP ${response.status}`);
    }
  }
}

async function expectAbsent(path: string) {
  const result = await runCli(["info", path, "--json"]);
  expect(result.exitCode).toBe(4);
  expect(parseOutput(result.stdout)).toMatchObject({ ok: false, error: { kind: "not-found" } });
}

async function expectPresent(path: string, expectedId?: string) {
  const result = await runCli(["info", path, "--json"]);
  expect(result.exitCode).toBe(0);
  const output = parseOutput(result.stdout);
  expect(output).toMatchObject({ ok: true, action: "found" });
  if (expectedId !== undefined) {
    const data = output.data as { resource?: { resourceId?: string } } | undefined;
    expect(data?.resource?.resourceId).toBe(expectedId);
  }
}

describeIntegration("MYBOX rename and move acceptance", () => {
  beforeAll(async () => {
    const prefix = await exactResource(PREFIX_PATH, "folder");
    if (prefix === undefined) {
      throw new Error(`integration prefix is missing: ${PREFIX_PATH}`);
    }

    localDirectory = await mkdtemp(join(tmpdir(), "myboxctl-rename-move-integration-"));
    localFilePath = join(localDirectory, "file-a.txt");
    await writeFile(localFilePath, "phase18 acceptance");
    await mkdir(join(localDirectory, "sub"));
    await writeFile(join(localDirectory, "sub", "inner.txt"), "phase18 nested");

    const unique = `phase18-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    rootPath = joinRemotePath(PREFIX_PATH, unique);
    const created = await runCli(["mkdir", rootPath, "--parents", "--json"]);
    expect(created.exitCode).toBe(0);
    const rootOutput = parseOutput(created.stdout);
    rootId = rootOutput.data?.resourceId ?? "";
    if (rootId.length === 0) {
      throw new Error("rename/move acceptance root has no resource ID");
    }

    for (const [localPath, remotePath, extra] of [
      [localFilePath, joinRemotePath(rootPath, "a/file-a.txt"), []],
      [join(localDirectory, "sub"), joinRemotePath(rootPath, "a/sub"), ["--recursive"]],
      [localFilePath, joinRemotePath(rootPath, "b/file-a.txt"), []],
      [localFilePath, joinRemotePath(rootPath, "conflict-src/x.txt"), []],
      [localFilePath, joinRemotePath(rootPath, "conflict-dst/x.txt"), []],
    ] as const) {
      const upload = await runCli(["upload", localPath, remotePath, "--mkdir", ...extra, "--json"]);
      expect(upload.exitCode).toBe(0);
      expect(parseOutput(upload.stdout)).toMatchObject({ ok: true });
    }
  });

  afterAll(async () => {
    try {
      if (rootPath !== "" && rootId !== "") {
        await deleteForCleanup(rootPath, rootId);
      }
    } finally {
      if (localDirectory !== "") {
        await rm(localDirectory, { recursive: true, force: true });
      }
    }
  });

  test("renames a file in place while keeping its resource ID", async () => {
    const sourcePath = joinRemotePath(rootPath, "a/file-a.txt");
    const targetPath = joinRemotePath(rootPath, "a/file-b.txt");

    const renamed = await runCli(["rename", sourcePath, "file-b.txt", "--json"]);
    expect(renamed.exitCode).toBe(0);
    const output = parseOutput(renamed.stdout);
    expect(output).toMatchObject({
      ok: true,
      action: "renamed",
      data: { path: sourcePath, newPath: targetPath },
    });
    const id = output.data?.resourceId;
    if (id === undefined) {
      throw new Error("rename acceptance output has no resource ID");
    }

    await expectPresent(targetPath, id);
    await expectAbsent(sourcePath);
  });

  test("reports an identical rename as unchanged", async () => {
    const targetPath = joinRemotePath(rootPath, "a/file-b.txt");
    const result = await runCli(["rename", targetPath, "file-b.txt", "--json"]);

    expect(result.exitCode).toBe(0);
    expect(parseOutput(result.stdout)).toMatchObject({ ok: true, action: "unchanged" });
  });

  test("fails a sibling conflict and a non-portable name without mutating", async () => {
    const targetPath = joinRemotePath(rootPath, "a/file-b.txt");
    const siblingPath = joinRemotePath(rootPath, "a/sub");

    const conflict = await runCli(["rename", targetPath, "sub", "--json"]);
    expect(conflict.exitCode).toBe(5);
    expect(parseOutput(conflict.stdout)).toMatchObject({
      ok: false,
      error: { kind: "conflict", code: "NAME_CONFLICT" },
    });

    const invalid = await runCli(["rename", targetPath, "../escape.txt", "--json"]);
    expect(invalid.exitCode).toBe(2);
    expect(parseOutput(invalid.stdout)).toMatchObject({ ok: false });

    await expectPresent(targetPath);
    await expectPresent(siblingPath);
  });

  test("moves a file into an existing folder while keeping its resource ID", async () => {
    const sourcePath = joinRemotePath(rootPath, "a/file-b.txt");
    const destinationDirectory = joinRemotePath(rootPath, "b");
    const targetPath = joinRemotePath(rootPath, "b/file-b.txt");

    const moved = await runCli(["move", sourcePath, destinationDirectory, "--json"]);
    expect(moved.exitCode).toBe(0);
    const output = parseOutput(moved.stdout);
    expect(output).toMatchObject({
      ok: true,
      action: "moved",
      data: { path: sourcePath, newPath: targetPath },
    });
    const id = output.data?.resourceId;
    if (id === undefined) {
      throw new Error("move acceptance output has no resource ID");
    }

    await expectPresent(targetPath, id);
    await expectAbsent(sourcePath);

    const unchanged = await runCli(["move", targetPath, destinationDirectory, "--json"]);
    expect(unchanged.exitCode).toBe(0);
    expect(parseOutput(unchanged.stdout)).toMatchObject({ ok: true, action: "unchanged" });
  });

  test("moves a folder tree and rejects a move into its own descendant", async () => {
    const sourcePath = joinRemotePath(rootPath, "a/sub");
    const destinationDirectory = joinRemotePath(rootPath, "b");
    const targetPath = joinRemotePath(rootPath, "b/sub");

    const moved = await runCli(["move", sourcePath, destinationDirectory, "--json"]);
    expect(moved.exitCode).toBe(0);
    expect(parseOutput(moved.stdout)).toMatchObject({
      ok: true,
      action: "moved",
      data: { path: sourcePath, newPath: targetPath },
    });

    await expectPresent(targetPath);
    await expectPresent(joinRemotePath(targetPath, "inner.txt"));
    await expectAbsent(sourcePath);

    const descendant = await runCli(["move", destinationDirectory, targetPath, "--json"]);
    expect(descendant.exitCode).toBe(2);
    expect(parseOutput(descendant.stdout)).toMatchObject({
      ok: false,
      error: { kind: "invalid-arguments" },
    });
    await expectPresent(targetPath);
  });

  test("fails a destination name conflict without moving either resource", async () => {
    const sourcePath = joinRemotePath(rootPath, "conflict-src/x.txt");
    const destinationDirectory = joinRemotePath(rootPath, "conflict-dst");
    const existingPath = joinRemotePath(rootPath, "conflict-dst/x.txt");

    const conflict = await runCli(["move", sourcePath, destinationDirectory, "--json"]);
    expect(conflict.exitCode).toBe(5);
    expect(parseOutput(conflict.stdout)).toMatchObject({
      ok: false,
      error: { kind: "conflict", code: "NAME_CONFLICT" },
    });

    await expectPresent(sourcePath);
    await expectPresent(existingPath);
  });
});

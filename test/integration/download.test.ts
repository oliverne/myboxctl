import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  apiRequest,
  exactPathResource,
  isRecord,
  joinRemotePath,
  listPages,
  resourceId,
} from "./helpers.ts";

const PREFIX_PATH = "/myboxctl-integration-test/";
const integrationEnabled = process.env.MYBOX_INTEGRATION === "1" && Boolean(process.env.MYBOX_PAT);
const describeIntegration = integrationEnabled ? describe : describe.skip;
if (integrationEnabled) setDefaultTimeout(180_000);

let localDirectory = "";
let sourcePath = "";
let destinationPath = "";
let folderDestinationPath = "";
let folderPath = "";
let filePath = "";

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
  return { exitCode, stdout, stderr };
}

function output(stdout: string): Record<string, unknown> {
  const value = JSON.parse(stdout) as unknown;
  if (!isRecord(value)) throw new Error("download CLI returned a non-object JSON response");
  return value;
}

async function deleteForCleanup(path: string, id: string): Promise<void> {
  if (!path.startsWith(PREFIX_PATH)) throw new Error("refusing cleanup outside integration prefix");
  const response = await apiRequest(`/v1/drive/resources/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (response.status !== 204 && response.status !== 404) {
    throw new Error(`download cleanup failed with HTTP ${response.status}`);
  }
}

async function cleanupRemote(): Promise<void> {
  const files = await listPages("/v1/search/resources/files", {
    q: filePath.slice(filePath.lastIndexOf("/") + 1),
    parentPath: folderPath,
    count: "20",
  });
  const file = exactPathResource(files.resources, filePath);
  if (file !== undefined) {
    await deleteForCleanup(filePath, resourceId(file, "download cleanup file"));
  }
  const folders = await listPages("/v1/search/resources/folders", {
    path: folderPath,
    count: "20",
  });
  const folder = exactPathResource(folders.resources, folderPath);
  if (folder !== undefined) {
    await deleteForCleanup(folderPath, resourceId(folder, "download cleanup folder"));
  }
}

describeIntegration("MYBOX download acceptance", () => {
  beforeAll(async () => {
    const prefix = await listPages("/v1/search/resources/folders", {
      path: PREFIX_PATH,
      count: "20",
    });
    if (exactPathResource(prefix.resources, PREFIX_PATH) === undefined) {
      throw new Error("integration prefix is missing");
    }
    folderPath = joinRemotePath(
      PREFIX_PATH,
      `download-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
    );
    filePath = joinRemotePath(folderPath, "한글 # %+.txt");
    localDirectory = await mkdtemp(join(tmpdir(), "myboxctl-download-integration-"));
    sourcePath = join(localDirectory, "source.txt");
    destinationPath = join(localDirectory, "downloaded.txt");
    folderDestinationPath = join(localDirectory, "folder-download.txt");
    await writeFile(sourcePath, "");
    const upload = await runCli(["upload", sourcePath, filePath, "--mkdir", "--json"]);
    expect(upload.exitCode).toBe(0);
  });

  afterAll(async () => {
    try {
      if (filePath !== "") await cleanupRemote();
    } finally {
      if (localDirectory !== "") await rm(localDirectory, { recursive: true, force: true });
    }
  });

  test("downloads, preserves conflicts, overwrites atomically, and rejects folders", async () => {
    const first = await runCli(["download", filePath, destinationPath, "--json"]);
    expect(first.exitCode).toBe(0);
    expect(first.stderr).toBe("");
    expect(output(first.stdout)).toMatchObject({
      ok: true,
      action: "downloaded",
      data: { remotePath: filePath, localPath: destinationPath, sizeBytes: 0 },
    });
    expect((await readFile(destinationPath)).byteLength).toBe(0);

    const conflict = await runCli(["download", filePath, destinationPath, "--json"]);
    expect(conflict.exitCode).toBe(5);
    expect(output(conflict.stdout)).toMatchObject({ ok: false, error: { kind: "conflict" } });

    const updated = "새 다운로드 내용\n";
    await writeFile(sourcePath, updated);
    const upload = await runCli(["upload", sourcePath, filePath, "--force", "--json"]);
    expect(upload.exitCode).toBe(0);

    const overwrite = await runCli([
      "download",
      filePath,
      destinationPath,
      "--overwrite",
      "--json",
    ]);
    expect(overwrite.exitCode).toBe(0);
    const overwriteOutput = output(overwrite.stdout);
    expect(overwriteOutput).toMatchObject({ ok: true, action: "downloaded" });
    expect(await readFile(destinationPath, "utf8")).toBe(updated);
    const data = overwriteOutput.data;
    if (!isRecord(data) || typeof data.modifiedAt !== "string") {
      throw new Error("download output did not include modifiedAt");
    }
    const localStats = await stat(destinationPath);
    expect(Math.abs(localStats.mtimeMs - new Date(data.modifiedAt).getTime())).toBeLessThanOrEqual(
      2_000,
    );

    const folder = await runCli(["download", folderPath, folderDestinationPath, "--json"]);
    expect(folder.exitCode).toBe(5);
    expect(output(folder.stdout)).toMatchObject({ ok: false, error: { kind: "conflict" } });
    await expect(stat(folderDestinationPath)).rejects.toMatchObject({ code: "ENOENT" });

    const names = await Array.fromAsync(
      new Bun.Glob(".*.myboxctl-*.tmp").scan({ cwd: localDirectory, onlyFiles: true }),
    );
    expect(names).toEqual([]);
    expect(first.stdout + conflict.stdout + overwrite.stdout + folder.stdout).not.toContain(
      "stoken=",
    );
  });
});

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  apiRequest,
  exactPathResource,
  isRecord,
  joinRemotePath,
  listPages,
  parseSafeCliEvents,
  resourceId,
} from "./helpers.ts";

const PREFIX_PATH = "/myboxctl-integration-test/";
const integrationEnabled = process.env.MYBOX_INTEGRATION === "1" && Boolean(process.env.MYBOX_PAT);
const describeIntegration = integrationEnabled ? describe : describe.skip;
if (integrationEnabled) {
  setDefaultTimeout(600_000);
}

type CliOutput = {
  ok: boolean;
  action?: string;
  data?: { path?: string; resourceId?: string; type?: string };
  error?: { kind?: string };
};

let localDirectory = "";
let localPath = "";
let folderPath = "";
let filePath = "";
let childFolderPath = "";
let childFilePath = "";

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
    throw new Error("delete CLI returned a non-object JSON response");
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

async function cleanupRemote(): Promise<void> {
  for (const [path, type] of [
    [childFilePath, "file"],
    [filePath, "file"],
    [childFolderPath, "folder"],
    [folderPath, "folder"],
  ] as const) {
    const resource = await exactResource(path, type);
    if (resource !== undefined) {
      await deleteForCleanup(path, resourceId(resource, `cleanup resource for ${path}`));
    }
  }
}

describeIntegration("MYBOX delete acceptance", () => {
  beforeAll(async () => {
    const prefix = await exactResource(PREFIX_PATH, "folder");
    if (prefix === undefined) {
      throw new Error(`integration prefix is missing: ${PREFIX_PATH}`);
    }

    folderPath = joinRemotePath(
      PREFIX_PATH,
      `delete-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
    );
    filePath = joinRemotePath(folderPath, "file.txt");
    childFolderPath = joinRemotePath(folderPath, "non-empty folder");
    childFilePath = joinRemotePath(childFolderPath, "child.txt");

    localDirectory = await mkdtemp(join(tmpdir(), "myboxctl-delete-integration-"));
    localPath = join(localDirectory, "content.txt");
    await writeFile(localPath, "delete integration");
  });

  afterAll(async () => {
    try {
      if (folderPath !== "") {
        await cleanupRemote();
      }
    } finally {
      if (localDirectory !== "") {
        await rm(localDirectory, { recursive: true, force: true });
      }
    }
  });

  test("deletes a file and a non-empty folder with idempotent and strict behavior", async () => {
    for (const path of [filePath, childFilePath]) {
      const created = await runCli(["put", localPath, path, "--mkdir", "--json"]);
      expect(created.exitCode).toBe(0);
      expect(parseOutput(created.stdout)).toMatchObject({ ok: true, action: "uploaded" });
    }

    const fileDelete = await runCli(["delete", filePath, "--json"]);
    expect(fileDelete.exitCode).toBe(0);
    const fileOutput = parseOutput(fileDelete.stdout);
    expect(fileOutput).toMatchObject({
      ok: true,
      action: "deleted",
      data: { path: filePath, type: "file" },
    });
    const fileId = fileOutput.data?.resourceId;
    if (fileId === undefined) {
      throw new Error("deleted file output has no resource ID");
    }
    const deletedFileAgain = await apiRequest(`/v1/drive/resources/${encodeURIComponent(fileId)}`, {
      method: "DELETE",
    });
    expect(deletedFileAgain.status).toBe(404);

    const secondFileDelete = await runCli(["delete", filePath, "--json"]);
    expect(secondFileDelete.exitCode).toBe(0);
    expect(parseOutput(secondFileDelete.stdout)).toMatchObject({
      ok: true,
      action: "already-absent",
      data: { path: filePath },
    });
    const strictFileDelete = await runCli(["delete", filePath, "--strict", "--json"]);
    expect(strictFileDelete.exitCode).toBe(4);
    expect(parseOutput(strictFileDelete.stdout)).toMatchObject({
      ok: false,
      error: { kind: "not-found" },
    });

    const folderDelete = await runCli(["delete", childFolderPath, "--json"]);
    expect(folderDelete.exitCode).toBe(0);
    const folderOutput = parseOutput(folderDelete.stdout);
    expect(folderOutput).toMatchObject({
      ok: true,
      action: "deleted",
      data: { path: childFolderPath, type: "folder" },
    });
    const folderId = folderOutput.data?.resourceId;
    if (folderId === undefined) {
      throw new Error("deleted folder output has no resource ID");
    }
    const deletedFolderAgain = await apiRequest(
      `/v1/drive/resources/${encodeURIComponent(folderId)}`,
      { method: "DELETE" },
    );
    expect(deletedFolderAgain.status).toBe(404);

    const rootDelete = await runCli(["delete", folderPath, "--json"]);
    expect(rootDelete.exitCode).toBe(0);
    expect(parseOutput(rootDelete.stdout)).toMatchObject({ ok: true, action: "deleted" });
  });
});

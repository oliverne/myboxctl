import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
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
  setDefaultTimeout(900_000);
}

type CliOutput = {
  ok: boolean;
  action?: string;
  data?: { path?: string; size?: number; reason?: string };
  error?: { kind?: string; code?: string };
};

let localDirectory = "";
let localPath = "";
let newerLocalPath = "";
let folderPath = "";
let filePath = "";
let nestedFolderPath = "";
let nestedFilePath = "";

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
    throw new Error("put CLI returned a non-object JSON response");
  }
  return output as CliOutput;
}

async function searchFile(path: string) {
  const parentPath = path.slice(0, path.lastIndexOf("/")) || "/";
  const name = path.slice(path.lastIndexOf("/") + 1);
  const result = await listPages("/v1/search/resources/files", {
    q: name,
    parentPath,
    count: "20",
  });
  return exactPathResource(result.resources, path);
}

async function searchFolder(path: string) {
  const result = await listPages("/v1/search/resources/folders", { path, count: "20" });
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
  for (const path of [nestedFilePath, filePath]) {
    const resource = await searchFile(path);
    if (resource !== undefined) {
      await deleteForCleanup(path, resourceId(resource, `cleanup resource for ${path}`));
    }
  }
  for (const path of [nestedFolderPath, folderPath]) {
    const resource = await searchFolder(path);
    if (resource !== undefined) {
      await deleteForCleanup(path, resourceId(resource, `cleanup resource for ${path}`));
    }
  }
}

describeIntegration("MYBOX put acceptance", () => {
  beforeAll(async () => {
    const prefix = await searchFolder(PREFIX_PATH);
    if (prefix === undefined) {
      throw new Error(`integration prefix is missing: ${PREFIX_PATH}`);
    }

    folderPath = joinRemotePath(
      PREFIX_PATH,
      `put-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
    );
    filePath = joinRemotePath(folderPath, "한글 report.txt");
    nestedFolderPath = joinRemotePath(folderPath, "missing parent");
    nestedFilePath = joinRemotePath(nestedFolderPath, "nested.txt");

    localDirectory = await mkdtemp(join(tmpdir(), "myboxctl-put-integration-"));
    localPath = join(localDirectory, "report.txt");
    newerLocalPath = join(localDirectory, "remote-newer.txt");
    await writeFile(localPath, "initial");
    await writeFile(newerLocalPath, "remote-newer");
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

  test("runs the metadata policy flow and reuses mkdir/upload", async () => {
    const first = await runCli(["put", localPath, filePath, "--mkdir", "--json"]);
    expect(first.exitCode).toBe(0);
    expect(parseOutput(first.stdout)).toMatchObject({
      ok: true,
      action: "uploaded",
      data: { path: filePath, size: 7, reason: "remote-absent" },
    });

    const same = await runCli(["put", localPath, filePath, "--json"]);
    expect(same.exitCode).toBe(0);
    expect(parseOutput(same.stdout)).toMatchObject({
      ok: true,
      action: "skipped",
      data: { reason: "remote-is-current" },
    });

    await writeFile(localPath, "updated-size");
    const changed = await runCli(["put", localPath, filePath, "--json"]);
    expect(changed.exitCode).toBe(0);
    expect(parseOutput(changed.stdout)).toMatchObject({
      ok: true,
      action: "overwritten",
      data: { size: 12, reason: "size-different" },
    });

    const future = new Date(Date.now() + 60_000);
    await utimes(newerLocalPath, future, future);
    const makeRemoteNewer = await runCli([
      "upload",
      newerLocalPath,
      filePath,
      "--overwrite",
      "--json",
    ]);
    expect(makeRemoteNewer.exitCode).toBe(0);

    const conflict = await runCli(["put", localPath, filePath, "--json"]);
    expect(conflict.exitCode).toBe(5);
    expect(parseOutput(conflict.stdout)).toMatchObject({
      ok: false,
      error: { kind: "conflict", code: "REMOTE_NEWER" },
    });

    const forced = await runCli(["put", localPath, filePath, "--force", "--json"]);
    expect(forced.exitCode).toBe(0);
    expect(parseOutput(forced.stdout)).toMatchObject({
      ok: true,
      action: "overwritten",
      data: { reason: "forced" },
    });

    const missingParent = await runCli(["put", localPath, nestedFilePath, "--json"]);
    expect(missingParent.exitCode).toBe(4);
    expect(parseOutput(missingParent.stdout)).toMatchObject({
      ok: false,
      error: { kind: "not-found" },
    });

    const mkdir = await runCli(["put", localPath, nestedFilePath, "--mkdir", "--json"]);
    expect(mkdir.exitCode).toBe(0);
    expect(parseOutput(mkdir.stdout)).toMatchObject({
      ok: true,
      action: "uploaded",
      data: { path: nestedFilePath, reason: "remote-absent" },
    });
  });
});

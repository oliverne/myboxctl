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
  setDefaultTimeout(180_000);
}

type UploadOutput = {
  ok: boolean;
  action?: string;
  data?: {
    path?: string;
    resourceId?: string;
    size?: number;
  };
};

let localDirectory = "";
let localPath = "";
let folderPath = "";
let filePath = "";

async function runCli(
  args: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
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

function parseOutput(stdout: string): UploadOutput {
  const output = JSON.parse(stdout) as unknown;
  if (!isRecord(output)) {
    throw new Error("upload CLI returned a non-object JSON response");
  }
  return output as UploadOutput;
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

  throw new Error(`cleanup delete exhausted for ${path}`);
}

async function cleanupRemote(): Promise<void> {
  const files = await listPages("/v1/search/resources/files", {
    q: filePath.slice(filePath.lastIndexOf("/") + 1),
    parentPath: folderPath,
    count: "20",
  });
  const file = exactPathResource(files.resources, filePath);
  if (file !== undefined) {
    await deleteForCleanup(filePath, resourceId(file, `cleanup resource for ${filePath}`));
  }

  const folders = await listPages("/v1/search/resources/folders", {
    path: folderPath,
    count: "20",
  });
  const folder = exactPathResource(folders.resources, folderPath);
  if (folder !== undefined) {
    await deleteForCleanup(folderPath, resourceId(folder, `cleanup resource for ${folderPath}`));
  }
}

describeIntegration("MYBOX upload acceptance", () => {
  beforeAll(async () => {
    const prefix = await listPages("/v1/search/resources/folders", {
      path: PREFIX_PATH,
      count: "20",
    });
    if (exactPathResource(prefix.resources, PREFIX_PATH) === undefined) {
      throw new Error(`integration prefix is missing: ${PREFIX_PATH}`);
    }

    folderPath = joinRemotePath(
      PREFIX_PATH,
      `upload-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
    );
    filePath = joinRemotePath(folderPath, "한글 # %+.txt");
    localDirectory = await mkdtemp(join(tmpdir(), "myboxctl-upload-integration-"));
    localPath = join(localDirectory, "한글 # %+.txt");
    await writeFile(localPath, "");
  });

  afterAll(async () => {
    try {
      if (filePath !== "") {
        await cleanupRemote();
      }
    } finally {
      if (localDirectory !== "") {
        await rm(localDirectory, { recursive: true, force: true });
      }
    }
  });

  test("uploads an empty Unicode file and overwrites it only when requested", async () => {
    const first = await runCli(["upload", localPath, filePath, "--mkdir", "--json"]);
    expect(first.exitCode).toBe(0);
    expect(parseOutput(first.stdout)).toMatchObject({
      ok: true,
      action: "uploaded",
      data: { path: filePath, sizeBytes: 0 },
    });

    await writeFile(localPath, "updated");
    const conflict = await runCli(["upload", localPath, filePath, "--json"]);
    expect(conflict.exitCode).toBe(5);
    expect(parseOutput(conflict.stdout)).toMatchObject({
      ok: false,
      error: { kind: "conflict" },
    });

    const overwrite = await runCli(["upload", localPath, filePath, "--force", "--json"]);
    expect(overwrite.exitCode).toBe(0);
    expect(parseOutput(overwrite.stdout)).toMatchObject({
      ok: true,
      action: "overwritten",
      data: { path: filePath, sizeBytes: 7 },
    });
  });
});

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";

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

type EnsureOutput = {
  ok: boolean;
  action?: string;
  data?: {
    path?: string;
    resourceId?: string | null;
    createdPaths?: string[];
  };
};

let testPaths: string[] = [];

async function searchFolders(path: string): Promise<{ resources: unknown[] }> {
  return listPages("/v1/search/resources/folders", { path, count: "20" });
}

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

function parseOutput(stdout: string): EnsureOutput {
  const output = JSON.parse(stdout) as unknown;
  if (!isRecord(output)) {
    throw new Error("ensure-dir CLI returned a non-object JSON response");
  }
  return output as EnsureOutput;
}

async function searchFoldersForCleanup(path: string): Promise<{ resources: unknown[] }> {
  for (const waitMs of [0, 5_000, 10_000, 20_000]) {
    if (waitMs > 0) {
      await Bun.sleep(waitMs);
    }
    try {
      return await searchFolders(path);
    } catch (error) {
      if (waitMs === 20_000 || !String(error).includes("HTTP 429")) {
        throw error;
      }
    }
  }

  throw new Error(`cleanup search exhausted for ${path}`);
}

async function deleteFolderForCleanup(path: string, id: string): Promise<void> {
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

async function cleanupFolders(): Promise<void> {
  for (const path of [...testPaths].reverse()) {
    if (!path.startsWith(PREFIX_PATH)) {
      throw new Error(`refusing to clean a path outside the integration prefix: ${path}`);
    }

    const result = await searchFoldersForCleanup(path);
    const resource = exactPathResource(result.resources, path);
    if (resource === undefined) {
      continue;
    }

    await deleteFolderForCleanup(path, resourceId(resource, `cleanup resource for ${path}`));
  }
}

describeIntegration("MYBOX ensure-dir acceptance", () => {
  beforeAll(async () => {
    const prefix = await searchFolders(PREFIX_PATH);
    if (exactPathResource(prefix.resources, PREFIX_PATH) === undefined) {
      throw new Error(`integration prefix is missing: ${PREFIX_PATH}`);
    }

    const unique = `ensure-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const first = joinRemotePath(PREFIX_PATH, unique);
    const unicode = joinRemotePath(first, "한글 # %+");
    testPaths = [first, unicode, joinRemotePath(unicode, "leaf")];
  });

  afterAll(async () => {
    await cleanupFolders();
  });

  test("creates a Unicode hierarchy and is existing on the second invocation", async () => {
    const first = await runCli(["ensure-dir", `${testPaths.at(-1)}/`, "--json"]);
    expect(first.exitCode).toBe(0);

    const firstOutput = parseOutput(first.stdout);
    expect(firstOutput).toMatchObject({
      ok: true,
      action: "created",
      data: {
        path: testPaths.at(-1),
        createdPaths: testPaths,
      },
    });
    expect(typeof firstOutput.data?.resourceId).toBe("string");

    const second = await runCli(["ensure-dir", testPaths.at(-1) ?? "", "--json"]);
    expect(second.exitCode).toBe(0);

    expect(parseOutput(second.stdout)).toMatchObject({
      ok: true,
      action: "existing",
      data: {
        path: testPaths.at(-1),
        createdPaths: [],
      },
    });
  });
});

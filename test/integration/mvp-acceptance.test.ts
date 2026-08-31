import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isRecord, joinRemotePath, parseSafeCliEvents } from "./helpers.ts";

const PREFIX_PATH = "/myboxctl-integration-test/";
const integrationEnabled = process.env.MYBOX_INTEGRATION === "1" && Boolean(process.env.MYBOX_PAT);
const describeIntegration = integrationEnabled ? describe : describe.skip;
if (integrationEnabled) {
  setDefaultTimeout(1_800_000);
}

type CliOutput = {
  ok: boolean;
  command?: string;
  action?: string;
  data?: {
    path?: string;
    size?: number;
    reason?: string;
    resource?: { path?: string; type?: string; size?: number };
  };
  error?: { kind?: string; code?: string };
};

let localDirectory = "";
const cleanupFolders: string[] = [];

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
    throw new Error("MVP acceptance CLI returned a non-object JSON response");
  }
  return output as CliOutput;
}

async function expectSuccess(args: string[], expected: Partial<CliOutput>): Promise<CliOutput> {
  const result = await runCli(args);
  expect(result.exitCode).toBe(0);
  const output = parseOutput(result.stdout);
  expect(output).toMatchObject(expected);
  return output;
}

async function cleanupRemoteFolder(path: string): Promise<void> {
  if (!path.startsWith(PREFIX_PATH)) {
    throw new Error(`refusing to clean a path outside the integration prefix: ${path}`);
  }

  const result = await runCli(["delete", path, "--json"]);
  if (result.exitCode !== 0) {
    throw new Error(`cleanup failed for ${path} with exit ${result.exitCode}`);
  }
}

describeIntegration("MYBOX final MVP acceptance", () => {
  beforeAll(async () => {
    localDirectory = await mkdtemp(join(tmpdir(), "myboxctl-final-acceptance-"));
  });

  afterAll(async () => {
    try {
      for (const folder of cleanupFolders.reverse()) {
        await cleanupRemoteFolder(folder);
      }
    } finally {
      if (localDirectory !== "") {
        await rm(localDirectory, { recursive: true, force: true });
      }
    }
  });

  test("runs the complete MVP flow twice with isolated resources", async () => {
    const runId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

    for (let iteration = 1; iteration <= 2; iteration += 1) {
      const folderPath = joinRemotePath(PREFIX_PATH, `final-${runId}-${iteration}`);
      const filePath = joinRemotePath(folderPath, "한글 report.txt");
      cleanupFolders.push(folderPath);

      const localPath = join(localDirectory, `report-${iteration}.txt`);
      const remoteNewerPath = join(localDirectory, `remote-newer-${iteration}.txt`);
      await writeFile(localPath, "initial");
      await writeFile(remoteNewerPath, "remote-newer");

      await expectSuccess(["ensure-dir", folderPath, "--json"], {
        ok: true,
        command: "ensure-dir",
        action: "created",
        data: { path: folderPath },
      });

      await expectSuccess(["put", localPath, filePath, "--json"], {
        ok: true,
        command: "put",
        action: "uploaded",
        data: { path: filePath, size: 7, reason: "remote-absent" },
      });

      await expectSuccess(["stat", filePath, "--json"], {
        ok: true,
        command: "stat",
        action: "found",
        data: { resource: { path: filePath, type: "file", size: 7 } },
      });

      await expectSuccess(["put", localPath, filePath, "--json"], {
        ok: true,
        command: "put",
        action: "skipped",
        data: { reason: "remote-is-current" },
      });

      await writeFile(localPath, "updated-size");
      await expectSuccess(["put", localPath, filePath, "--json"], {
        ok: true,
        command: "put",
        action: "overwritten",
        data: { size: 12, reason: "size-different" },
      });

      const future = new Date(Date.now() + 60_000);
      await utimes(remoteNewerPath, future, future);
      await expectSuccess(["upload", remoteNewerPath, filePath, "--overwrite", "--json"], {
        ok: true,
        command: "upload",
        action: "overwritten",
      });

      const conflict = await runCli(["put", localPath, filePath, "--json"]);
      expect(conflict.exitCode).toBe(5);
      expect(parseOutput(conflict.stdout)).toMatchObject({
        ok: false,
        command: "put",
        error: { kind: "conflict", code: "REMOTE_NEWER" },
      });

      await expectSuccess(["put", localPath, filePath, "--force", "--json"], {
        ok: true,
        command: "put",
        action: "overwritten",
        data: { reason: "forced" },
      });

      await expectSuccess(["delete", filePath, "--json"], {
        ok: true,
        command: "delete",
        action: "deleted",
        data: { path: filePath },
      });

      await expectSuccess(["delete", filePath, "--json"], {
        ok: true,
        command: "delete",
        action: "already-absent",
        data: { path: filePath },
      });

      await cleanupRemoteFolder(folderPath);
      cleanupFolders.pop();
    }
  });
});

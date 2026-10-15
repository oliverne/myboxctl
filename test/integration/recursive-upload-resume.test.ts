import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  apiRequest,
  exactPathResource,
  isRecord,
  listPages,
  parseSafeCliEvents,
  resourceId,
} from "./helpers.ts";

const PREFIX_PATH = "/myboxctl-integration-test/";
const integrationEnabled = process.env.MYBOX_INTEGRATION === "1" && Boolean(process.env.MYBOX_PAT);
const describeIntegration = integrationEnabled ? describe : describe.skip;
if (integrationEnabled) setDefaultTimeout(900_000);

let temporaryDirectory = "";
let sourceRoot = "";
let remoteRoot = "";
let checkpointPath = "";
let unreadablePath = "";

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

function output(stdout: string): Record<string, unknown> {
  const value = JSON.parse(stdout) as unknown;
  if (!isRecord(value)) throw new Error("recursive upload resume returned non-object JSON");
  return value;
}

async function cleanupRemote(): Promise<void> {
  if (!remoteRoot.startsWith(PREFIX_PATH)) {
    throw new Error(`refusing cleanup outside integration prefix: ${remoteRoot}`);
  }
  const folders = await listPages("/v1/search/resources/folders", {
    path: remoteRoot,
    count: "20",
  });
  const folder = exactPathResource(folders.resources, remoteRoot);
  if (folder === undefined) return;
  await apiRequest(`/v1/drive/resources/${encodeURIComponent(resourceId(folder, "resume root"))}`, {
    method: "DELETE",
  });
}

beforeAll(async () => {
  if (!integrationEnabled) return;
  temporaryDirectory = await mkdtemp(join(tmpdir(), "myboxctl-resume-"));
  sourceRoot = join(temporaryDirectory, "payload");
  checkpointPath = join(temporaryDirectory, "payload.upload.json");
  unreadablePath = join(sourceRoot, "b.txt");
  await mkdir(join(sourceRoot, "nested", "empty"), { recursive: true });
  await writeFile(join(sourceRoot, "a.txt"), "alpha");
  await writeFile(unreadablePath, "bravo");
  await writeFile(join(sourceRoot, "nested", "c.txt"), "charlie");
  remoteRoot = `${PREFIX_PATH}recursive-upload-resume-${crypto.randomUUID()}`;
  await cleanupRemote();
});

afterAll(async () => {
  if (!integrationEnabled) return;
  await cleanupRemote();
  await rm(temporaryDirectory, { recursive: true, force: true });
});

describeIntegration("MYBOX recursive upload resume acceptance", () => {
  test("keeps the checkpoint on a local failure and resumes without re-uploading completed files", async () => {
    await chmod(unreadablePath, 0o000);
    const failed = await runCli([
      "upload",
      sourceRoot,
      remoteRoot,
      "--recursive",
      "--mkdir",
      "--checkpoint",
      checkpointPath,
      "--json",
    ]);

    expect(failed.exitCode).toBe(7);
    expect(failed.stderr).toBe("");
    const failure = output(failed.stdout);
    expect(failure).toMatchObject({
      ok: false,
      command: "upload",
      resumeCheckpointPath: checkpointPath,
      error: { kind: "local-file" },
    });

    const saved = JSON.parse(await readFile(checkpointPath, "utf8")) as Record<string, unknown>;
    const savedFiles = saved.files as Record<string, unknown>;
    const inFlight = saved.inFlight as Record<string, unknown>;
    expect(saved).toMatchObject({ schemaVersion: 1, state: "in-progress" });
    expect(Object.keys(savedFiles)).toContain("a.txt");
    expect(inFlight).toMatchObject({ kind: "file", relativePath: "b.txt" });

    await chmod(unreadablePath, 0o644);
    const resumed = await runCli([
      "upload",
      sourceRoot,
      remoteRoot,
      "--recursive",
      "--resume",
      checkpointPath,
      "--json",
    ]);

    expect(resumed.exitCode).toBe(0);
    expect(resumed.stderr).toBe("");
    expect(output(resumed.stdout)).toMatchObject({
      ok: true,
      action: "uploaded",
      data: {
        type: "folder",
        remotePath: remoteRoot,
        filesUploaded: 2,
        filesSkipped: 1,
        foldersSkipped: 3,
        resumed: true,
      },
    });
    await expect(stat(checkpointPath)).rejects.toMatchObject({ code: "ENOENT" });

    const aPath = `${remoteRoot}/a.txt`;
    const bPath = `${remoteRoot}/b.txt`;
    const cPath = `${remoteRoot}/nested/c.txt`;
    const files = await listPages("/v1/search/resources/files", {
      q: "a.txt",
      parentPath: `${remoteRoot}/`,
      count: "20",
    });
    expect(exactPathResource(files.resources, aPath)).toBeDefined();
    const bFiles = await listPages("/v1/search/resources/files", {
      q: "b.txt",
      parentPath: `${remoteRoot}/`,
      count: "20",
    });
    expect(exactPathResource(bFiles.resources, bPath)).toBeDefined();
    const nestedFiles = await listPages("/v1/search/resources/files", {
      q: "c.txt",
      parentPath: `${remoteRoot}/nested/`,
      count: "20",
    });
    const cResource = exactPathResource(nestedFiles.resources, cPath);
    expect(cResource).toBeDefined();
    expect(resourceId(cResource, "resumed nested file")).toBeTruthy();
  });
});

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
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
if (integrationEnabled) setDefaultTimeout(900_000);

let temporaryDirectory = "";
let sourceRoot = "";
let downloadRoot = "";
let remoteRoot = "";

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
  if (!isRecord(value)) throw new Error("recursive transfer returned a non-object JSON response");
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
  const response = await apiRequest(
    `/v1/drive/resources/${encodeURIComponent(resourceId(folder, "recursive cleanup root"))}`,
    { method: "DELETE" },
  );
  if (response.status !== 204 && response.status !== 404) {
    throw new Error(`recursive cleanup failed with HTTP ${response.status}`);
  }
}

describeIntegration("MYBOX recursive transfer acceptance", () => {
  beforeAll(async () => {
    const prefix = await listPages("/v1/search/resources/folders", {
      path: PREFIX_PATH,
      count: "20",
    });
    if (exactPathResource(prefix.resources, PREFIX_PATH) === undefined) {
      throw new Error(`integration prefix is missing: ${PREFIX_PATH}`);
    }

    temporaryDirectory = await mkdtemp(join(tmpdir(), "myboxctl-recursive-integration-"));
    sourceRoot = join(temporaryDirectory, "source tree");
    downloadRoot = join(temporaryDirectory, "downloaded tree");
    remoteRoot = joinRemotePath(
      PREFIX_PATH,
      `recursive-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
    );
    await mkdir(join(sourceRoot, "빈 폴더"), { recursive: true });
    await mkdir(join(sourceRoot, "중첩", "더 깊게"), { recursive: true });
    await writeFile(join(sourceRoot, "빈 파일.txt"), "");
    await writeFile(join(sourceRoot, "중첩", "내용 # %+.txt"), "재귀 전송\n");
    await writeFile(
      join(sourceRoot, "중첩", "더 깊게", "data.bin"),
      new Uint8Array([0, 1, 2, 255]),
    );
  });

  afterAll(async () => {
    try {
      if (remoteRoot !== "") await cleanupRemote();
    } finally {
      if (temporaryDirectory !== "") {
        await rm(temporaryDirectory, { recursive: true, force: true });
      }
    }
  });

  test("round-trips nested, empty, Unicode, and zero-byte entries", async () => {
    const upload = await runCli([
      "upload",
      sourceRoot,
      remoteRoot,
      "--mkdir",
      "--recursive",
      "--json",
    ]);
    expect(upload.exitCode).toBe(0);
    expect(output(upload.stdout)).toMatchObject({
      ok: true,
      action: "uploaded",
      data: {
        type: "folder",
        remotePath: remoteRoot,
        filesUploaded: 3,
        foldersCreated: 4,
        bytesUploaded: 18,
      },
    });

    const download = await runCli(["download", remoteRoot, downloadRoot, "--recursive", "--json"]);
    expect(download.exitCode).toBe(0);
    expect(output(download.stdout)).toMatchObject({
      ok: true,
      action: "downloaded",
      data: {
        type: "folder",
        remotePath: remoteRoot,
        localPath: downloadRoot,
        filesDownloaded: 3,
        foldersCreated: 4,
        bytesDownloaded: 18,
      },
    });

    expect((await stat(join(downloadRoot, "빈 폴더"))).isDirectory()).toBe(true);
    expect((await readFile(join(downloadRoot, "빈 파일.txt"))).byteLength).toBe(0);
    expect(await readFile(join(downloadRoot, "중첩", "내용 # %+.txt"), "utf8")).toBe("재귀 전송\n");
    expect([...(await readFile(join(downloadRoot, "중첩", "더 깊게", "data.bin")))]).toEqual([
      0, 1, 2, 255,
    ]);
    expect(upload.stdout + upload.stderr + download.stdout + download.stderr).not.toContain(
      "stoken=",
    );
  });
});

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  apiRequest,
  asString,
  assertStatus,
  exactPathResource,
  isRecord,
  joinRemotePath,
  listPages,
  resourceId,
  uploadBytes,
} from "./helpers.ts";

const PREFIX_PATH = "/myboxctl-integration-test/";
const probeEnabled = process.env.MYBOX_PHASE12_PROBE === "1" && Boolean(process.env.MYBOX_PAT);
const describeProbe = probeEnabled ? describe : describe.skip;

if (probeEnabled) {
  setDefaultTimeout(600_000);
}

type CliOutput = {
  ok: boolean;
  action?: string;
  data?: Record<string, unknown>;
  error?: { kind?: string; code?: string };
};

let localDirectory = "";
let rootPath = "";
let rootId = "";
const createdIds: string[] = [];

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

function parseOutput(stdout: string): CliOutput {
  const output = JSON.parse(stdout) as unknown;
  if (!isRecord(output)) {
    throw new Error("Phase 12 probe CLI returned a non-object JSON response");
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

async function parentChildren(parentId: string): Promise<Record<string, unknown>[]> {
  const result = await listPages(`/v1/drive/folders/${encodeURIComponent(parentId)}/resources`, {
    count: "1000",
    sort: "name,asc",
  });
  return result.resources.filter(isRecord);
}

async function createRawFile(parentId: string, name: string, bytes: Uint8Array): Promise<string> {
  const reservation = await apiRequest("/v1/drive/files", {
    method: "POST",
    body: {
      fileName: name,
      fileSize: bytes.byteLength,
      parentId,
      isOverwrite: false,
      resume: false,
      modifiedTime: new Date().toISOString(),
    },
  });
  assertStatus(reservation, 201, `reserve raw file ${name}`);
  if (!isRecord(reservation.body)) {
    throw new Error(`raw file reservation for ${name} returned a non-object response`);
  }
  const uploadUrl = asString(reservation.body.uploadUrl, `raw file reservation ${name}.uploadUrl`);
  const offset = typeof reservation.body.offset === "number" ? reservation.body.offset : 0;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > bytes.byteLength) {
    throw new Error(`raw file reservation for ${name} returned an invalid offset`);
  }
  const uploaded = await uploadBytes(
    uploadUrl,
    name,
    bytes.slice(offset),
    offset === 0 ? {} : { contentRange: `${offset}-${bytes.byteLength - 1}/${bytes.byteLength}` },
  );
  assertStatus(uploaded, 200, `upload raw file ${name}`);
  if (!isRecord(uploaded.body)) {
    throw new Error(`raw file upload for ${name} returned a non-object response`);
  }
  const id = asString(uploaded.body.resourceId, `raw file upload ${name}.resourceId`);
  createdIds.push(id);
  return id;
}

async function deleteForCleanup(id: string): Promise<void> {
  for (const waitMs of [0, 1_000, 3_000, 5_000]) {
    if (waitMs > 0) {
      await Bun.sleep(waitMs);
    }
    const response = await apiRequest(`/v1/drive/resources/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (response.status === 204 || response.status === 404) {
      return;
    }
    if (response.status !== 429 && response.status < 500) {
      throw new Error(`Phase 12 cleanup failed for ${id}: HTTP ${response.status}`);
    }
  }
  throw new Error(`Phase 12 cleanup did not settle for ${id}`);
}

describeProbe("MYBOX Phase 12 cross-platform Unicode filename probe", () => {
  beforeAll(async () => {
    const prefix = await exactResource(PREFIX_PATH, "folder");
    if (prefix === undefined) {
      throw new Error(`integration prefix is missing: ${PREFIX_PATH}`);
    }

    rootPath = joinRemotePath(
      PREFIX_PATH,
      `phase12-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
    );
    const created = await runCli(["ensure-dir", rootPath, "--json"]);
    expect(created.exitCode).toBe(0);
    expect(created.stderr).toBe("");
    const output = parseOutput(created.stdout);
    rootId = typeof output.data?.resourceId === "string" ? output.data.resourceId : "";
    if (rootId.length === 0) {
      throw new Error("Phase 12 probe root has no resource ID");
    }
    createdIds.push(rootId);

    localDirectory = await mkdtemp(join(tmpdir(), "myboxctl-phase12-probe-"));
  });

  afterAll(async () => {
    try {
      for (const id of [...createdIds].reverse()) {
        await deleteForCleanup(id);
      }
    } finally {
      if (localDirectory !== "") {
        await rm(localDirectory, { recursive: true, force: true });
      }
    }
  });

  test("uses NFC for new names, reads legacy NFD, and blocks ambiguous mutation", async () => {
    const nfdName = "\u1100\u1161-new.txt";
    const nfcName = nfdName.normalize("NFC");
    const localPath = join(localDirectory, nfdName);
    const newBytes = new TextEncoder().encode("new NFC content");
    await writeFile(localPath, newBytes);

    const created = await runCli([
      "put",
      localPath,
      joinRemotePath(rootPath, nfdName),
      "--force",
      "--json",
    ]);
    expect(created.exitCode).toBe(0);
    expect(created.stderr).toBe("");
    const createdOutput = parseOutput(created.stdout);
    expect(createdOutput).toMatchObject({
      ok: true,
      action: "uploaded",
      data: { path: joinRemotePath(rootPath, nfcName) },
    });
    const createdId = asString(createdOutput.data?.resourceId, "new NFC resource ID");
    createdIds.push(createdId);

    const canonicalResource = await exactResource(joinRemotePath(rootPath, nfcName), "file");
    expect(canonicalResource).toBeDefined();
    expect(canonicalResource?.name).toBe(nfcName);
    expect(resourceId(canonicalResource, "new NFC resource")).toBe(createdId);

    const stat = await runCli(["stat", joinRemotePath(rootPath, nfcName), "--json"]);
    expect(stat.exitCode).toBe(0);
    expect(parseOutput(stat.stdout)).toMatchObject({
      ok: true,
      action: "found",
      data: { resource: { resourceId: createdId, name: nfcName } },
    });

    const legacyNfdName = "\u1100\u1161-legacy.txt";
    const legacyNfcName = legacyNfdName.normalize("NFC");
    const legacyBytes = new TextEncoder().encode("legacy NFD content");
    const legacyId = await createRawFile(rootId, legacyNfdName, legacyBytes);
    const legacyPath = joinRemotePath(rootPath, legacyNfcName);

    const legacyStat = await runCli(["stat", legacyPath, "--json"]);
    expect(legacyStat.exitCode).toBe(0);
    expect(parseOutput(legacyStat.stdout)).toMatchObject({
      ok: true,
      action: "found",
      data: { resource: { resourceId: legacyId, name: legacyNfdName } },
    });

    const downloadedPath = join(localDirectory, "legacy-copy.txt");
    const downloaded = await runCli(["download", legacyPath, downloadedPath, "--json"]);
    expect(downloaded.exitCode).toBe(0);
    expect(parseOutput(downloaded.stdout)).toMatchObject({
      ok: true,
      action: "downloaded",
      data: { remotePath: legacyPath, resourceId: legacyId },
    });
    expect(new Uint8Array(await readFile(downloadedPath))).toEqual(legacyBytes);

    const collisionNfcName = "\uAC00-collision.txt";
    const collisionNfdName = collisionNfcName.normalize("NFD");
    const collisionBytes = new TextEncoder().encode("collision");
    const collisionNfcId = await createRawFile(rootId, collisionNfcName, collisionBytes);
    const collisionNfdId = await createRawFile(rootId, collisionNfdName, collisionBytes);

    const collision = await runCli([
      "put",
      localPath,
      joinRemotePath(rootPath, collisionNfcName),
      "--force",
      "--json",
    ]);
    expect(collision.exitCode).toBe(5);
    expect(collision.stderr).toBe("");
    expect(parseOutput(collision.stdout)).toMatchObject({
      ok: false,
      error: { kind: "conflict", code: "UNICODE_NAME_COLLISION" },
    });

    const children = await parentChildren(rootId);
    const collisionChildren = children.filter(
      (child) => child.resourceId === collisionNfcId || child.resourceId === collisionNfdId,
    );
    expect(collisionChildren).toHaveLength(2);
    expect(collisionChildren.map((child) => child.name).sort()).toEqual(
      [collisionNfcName, collisionNfdName].sort(),
    );
  });
});

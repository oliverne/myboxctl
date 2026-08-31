import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  apiRequest,
  assertStatus,
  exactPathResource,
  isRecord,
  joinRemotePath,
  listPages,
  readRequest,
  resourceId,
} from "./helpers.ts";

const PREFIX_PATH = "/myboxctl-integration-test/";
const probeEnabled = process.env.MYBOX_PHASE10_PROBE === "1" && Boolean(process.env.MYBOX_PAT);
const describeProbe = probeEnabled ? describe : describe.skip;
if (probeEnabled) {
  setDefaultTimeout(600_000);
}

type CliOutput = {
  ok: boolean;
  action?: string;
  data?: { path?: string; resourceId?: string; type?: string };
  error?: { kind?: string };
};

type NameObservation = {
  secondCreate: "created" | "conflict";
  listingCount: number;
  firstSpellingPreserved: boolean;
  secondSpellingPreserved: boolean;
  firstResolved: boolean;
  secondResolved: boolean;
  sameResolvedId: boolean | null;
};

let localDirectory = "";
let localPath = "";
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
  return { exitCode, stdout, stderr };
}

function parseOutput(stdout: string): CliOutput {
  const output = JSON.parse(stdout) as unknown;
  if (!isRecord(output)) {
    throw new Error("Phase 10 probe CLI returned a non-object JSON response");
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

async function eventuallyExactResource(path: string, type: "file" | "folder") {
  for (const waitMs of [0, 1_000, 3_000, 6_000]) {
    if (waitMs > 0) {
      await Bun.sleep(waitMs);
    }
    const resource = await exactResource(path, type);
    if (resource !== undefined) {
      return resource;
    }
  }
  return undefined;
}

async function parentChildren(parentId: string) {
  return (
    await listPages(`/v1/drive/folders/${encodeURIComponent(parentId)}/resources`, {
      count: "1000",
      sort: "name,asc",
    })
  ).resources;
}

async function eventuallyParentChildren(parentId: string, names: readonly string[]) {
  let children: unknown[] = [];
  for (const waitMs of [0, 1_000, 3_000, 6_000]) {
    if (waitMs > 0) {
      await Bun.sleep(waitMs);
    }
    children = await parentChildren(parentId);
    if (names.every((name) => children.some((item) => isRecord(item) && item.name === name))) {
      return children;
    }
  }
  return children;
}

async function deleteForCleanup(path: string, id: string): Promise<void> {
  if (!path.startsWith(PREFIX_PATH)) {
    throw new Error(`refusing to clean a path outside the integration prefix: ${path}`);
  }
  const response = await apiRequest(`/v1/drive/resources/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (response.status !== 204 && response.status !== 404) {
    throw new Error(`Phase 10 cleanup failed with HTTP ${response.status}`);
  }
}

async function observeNamePair(
  parentPath: string,
  firstName: string,
  secondName: string,
): Promise<NameObservation> {
  const firstPath = joinRemotePath(parentPath, firstName);
  const secondPath = joinRemotePath(parentPath, secondName);
  const firstCreate = await runCli(["upload", localPath, firstPath, "--mkdir", "--json"]);
  expect(firstCreate.exitCode).toBe(0);
  expect(firstCreate.stderr).toBe("");
  expect(parseOutput(firstCreate.stdout)).toMatchObject({ ok: true, action: "uploaded" });

  const secondCreate = await runCli(["upload", localPath, secondPath, "--json"]);
  expect([0, 5]).toContain(secondCreate.exitCode);
  expect(secondCreate.stderr).toBe("");

  const parent = await eventuallyExactResource(parentPath, "folder");
  if (parent === undefined) {
    throw new Error("Phase 10 name probe parent was not found");
  }
  const secondOutcome = secondCreate.exitCode === 0 ? "created" : "conflict";
  const children = await eventuallyParentChildren(
    resourceId(parent, "Phase 10 name probe parent"),
    secondOutcome === "created" ? [firstName, secondName] : [firstName],
  );
  const pairChildren = children.filter(
    (item) => isRecord(item) && (item.name === firstName || item.name === secondName),
  );
  const first =
    (await eventuallyExactResource(firstPath, "file")) ??
    pairChildren.find((item) => isRecord(item) && item.name === firstName);
  const second =
    (await eventuallyExactResource(secondPath, "file")) ??
    pairChildren.find((item) => isRecord(item) && item.name === secondName);
  if (first === undefined) {
    throw new Error("Phase 10 name probe first resource disappeared");
  }

  if (secondOutcome === "created") {
    if (second === undefined) {
      throw new Error("Phase 10 second name resource was not resolved after creation");
    }
    expect(resourceId(second, "second name resource")).not.toBe(
      resourceId(first, "first name resource"),
    );
  }

  return {
    secondCreate: secondOutcome,
    listingCount: pairChildren.length,
    firstSpellingPreserved: pairChildren.some((item) => isRecord(item) && item.name === firstName),
    secondSpellingPreserved: pairChildren.some(
      (item) => isRecord(item) && item.name === secondName,
    ),
    firstResolved: true,
    secondResolved: second !== undefined,
    sameResolvedId:
      second === undefined
        ? null
        : resourceId(first, "first name resource") === resourceId(second, "second name resource"),
  };
}

describeProbe("MYBOX Phase 10 cross-implementation hardening probe", () => {
  beforeAll(async () => {
    const prefix = await exactResource(PREFIX_PATH, "folder");
    if (prefix === undefined) {
      throw new Error(`integration prefix is missing: ${PREFIX_PATH}`);
    }

    rootPath = joinRemotePath(
      PREFIX_PATH,
      `phase10-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
    );
    const created = await runCli(["mkdir", rootPath, "--parents", "--json"]);
    expect(created.exitCode).toBe(0);
    const output = parseOutput(created.stdout);
    rootId = output.data?.resourceId ?? "";
    if (rootId.length === 0) {
      throw new Error("Phase 10 probe root has no resource ID");
    }

    localDirectory = await mkdtemp(join(tmpdir(), "myboxctl-phase10-probe-"));
    localPath = join(localDirectory, "content.txt");
    await writeFile(localPath, "phase 10 probe");
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

  test("observes delete visibility through detail, exact path, and parent listing", async () => {
    const deleteParentPath = joinRemotePath(rootPath, "delete");
    const deletePath = joinRemotePath(deleteParentPath, "target.txt");
    const created = await runCli(["upload", localPath, deletePath, "--mkdir", "--json"]);
    expect(created.exitCode).toBe(0);
    const createdOutput = parseOutput(created.stdout);
    const originalId = createdOutput.data?.resourceId;
    if (originalId === undefined) {
      throw new Error("Phase 10 delete target has no resource ID");
    }

    const parent = await exactResource(deleteParentPath, "folder");
    if (parent === undefined) {
      throw new Error("Phase 10 delete parent was not found");
    }
    const parentId = resourceId(parent, "Phase 10 delete parent");
    const detailBefore = await readRequest(`/v1/drive/resources/${encodeURIComponent(originalId)}`);
    assertStatus(detailBefore, 200, "Phase 10 pre-delete detail");

    const deleted = await runCli(["delete", deletePath, "--json"]);
    expect(deleted.exitCode).toBe(0);
    expect(parseOutput(deleted.stdout)).toMatchObject({
      ok: true,
      action: "deleted",
      data: { resourceId: originalId },
    });

    let detailStatus = 0;
    let activeContainsOriginal = true;
    let listingContainsOriginal = true;
    for (const waitMs of [0, 250, 1_000, 2_000]) {
      if (waitMs > 0) {
        await Bun.sleep(waitMs);
      }
      const [detail, active, children] = await Promise.all([
        readRequest(`/v1/drive/resources/${encodeURIComponent(originalId)}`),
        exactResource(deletePath, "file"),
        parentChildren(parentId),
      ]);
      detailStatus = detail.status;
      activeContainsOriginal =
        active !== undefined && resourceId(active, "active delete target") === originalId;
      listingContainsOriginal = children.some(
        (item) => isRecord(item) && item.resourceId === originalId,
      );
      if (!activeContainsOriginal && !listingContainsOriginal) {
        break;
      }
    }

    const secondDelete = await apiRequest(`/v1/drive/resources/${encodeURIComponent(originalId)}`, {
      method: "DELETE",
    });
    console.log(
      JSON.stringify({
        phase10DeleteObservation: {
          detailStatus,
          activeContainsOriginal,
          listingContainsOriginal,
          secondDeleteStatus: secondDelete.status,
        },
      }),
    );

    expect(activeContainsOriginal).toBe(false);
    expect(listingContainsOriginal).toBe(false);
    expect([200, 404]).toContain(detailStatus);
    expect(secondDelete.status).toBe(404);
  });

  test("observes NFC/NFD and ASCII case name semantics without normalizing production paths", async () => {
    const unicode = await observeNamePair(
      joinRemotePath(rootPath, "unicode"),
      "\u00e9-report.txt",
      "e\u0301-report.txt",
    );
    const letterCase = await observeNamePair(
      joinRemotePath(rootPath, "case"),
      "Case-report.txt",
      "case-report.txt",
    );

    console.log(JSON.stringify({ phase10NameObservation: { unicode, letterCase } }));

    expect(unicode.firstSpellingPreserved).toBe(true);
    expect(letterCase.firstSpellingPreserved).toBe(true);
  });
});

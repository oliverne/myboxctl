import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  apiRequest,
  asNumber,
  asString,
  exactPathResource,
  isRecord,
  joinRemotePath,
  listPages,
  resourceId,
} from "./helpers.ts";

const PREFIX_PATH = "/myboxctl-integration-test/";
const probeEnabled = process.env.MYBOX_DOWNLOAD_PROBE === "1" && Boolean(process.env.MYBOX_PAT);
const describeProbe = probeEnabled ? describe : describe.skip;
if (probeEnabled) {
  setDefaultTimeout(180_000);
}

let localDirectory = "";
let folderPath = "";
const remoteFiles: Array<{ path: string; bytes: Uint8Array; id?: string }> = [];

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
  return { exitCode, stdout, stderr };
}

async function deleteForCleanup(path: string, id: string): Promise<void> {
  if (!path.startsWith(PREFIX_PATH)) {
    throw new Error("refusing to clean a path outside the integration prefix");
  }
  const response = await apiRequest(`/v1/drive/resources/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (response.status !== 204 && response.status !== 404) {
    throw new Error(`download probe cleanup failed with HTTP ${response.status}`);
  }
}

async function signedContent(url: string): Promise<{
  bytes: Uint8Array;
  status: number;
  redirected: boolean;
  contentLength?: number;
}> {
  let current = url;
  let redirected = false;
  for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
    const response = await fetch(current, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(Number(process.env.MYBOX_TIMEOUT_MS ?? 30_000)),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("Location");
      if (location === null || redirectCount === 5) {
        throw new Error("signed content returned an invalid redirect");
      }
      current = new URL(location, current).toString();
      redirected = true;
      continue;
    }
    const contentLengthValue = response.headers.get("Content-Length");
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      status: response.status,
      redirected,
      ...(contentLengthValue === null ? {} : { contentLength: Number(contentLengthValue) }),
    };
  }
  throw new Error("signed content exceeded the redirect limit");
}

describeProbe("MYBOX targeted download contract", () => {
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
      `download-probe-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
    );
    localDirectory = await mkdtemp(join(tmpdir(), "myboxctl-download-probe-"));
    remoteFiles.push(
      { path: joinRemotePath(folderPath, "empty.txt"), bytes: new Uint8Array() },
      {
        path: joinRemotePath(folderPath, "한글 # %+.txt"),
        bytes: new TextEncoder().encode("download probe 한글\n"),
      },
    );

    for (const [index, file] of remoteFiles.entries()) {
      const localPath = join(localDirectory, `source-${index}.txt`);
      await Bun.write(localPath, file.bytes);
      const result = await runCli(["upload", localPath, file.path, "--mkdir", "--json"]);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
    }
  });

  afterAll(async () => {
    try {
      for (const file of remoteFiles.toReversed()) {
        const files = await listPages("/v1/search/resources/files", {
          q: file.path.slice(file.path.lastIndexOf("/") + 1),
          parentPath: folderPath,
          count: "20",
        });
        const found = exactPathResource(files.resources, file.path);
        if (found !== undefined) {
          await deleteForCleanup(file.path, resourceId(found, "download probe cleanup file"));
        }
      }
      const folders = await listPages("/v1/search/resources/folders", {
        path: folderPath,
        count: "20",
      });
      const folder = exactPathResource(folders.resources, folderPath);
      if (folder !== undefined) {
        await deleteForCleanup(folderPath, resourceId(folder, "download probe cleanup folder"));
      }
    } finally {
      if (localDirectory !== "") {
        await rm(localDirectory, { recursive: true, force: true });
      }
    }
  });

  test("confirms PAT-free signed GET content for empty and Unicode files", async () => {
    for (const file of remoteFiles) {
      const files = await listPages("/v1/search/resources/files", {
        q: file.path.slice(file.path.lastIndexOf("/") + 1),
        parentPath: folderPath,
        count: "20",
      });
      const found = exactPathResource(files.resources, file.path);
      if (found === undefined) {
        throw new Error("download probe file was not visible");
      }
      const id = resourceId(found, "download probe file");
      file.id = id;

      const reservation = await apiRequest(`/v1/drive/files/${encodeURIComponent(id)}/download`);
      expect(reservation.status).toBe(200);
      if (!isRecord(reservation.body)) {
        throw new Error("download URL response was not an object");
      }
      const expiresIn = asNumber(reservation.body.expiresIn, "download.expiresIn");
      expect(expiresIn).toBeGreaterThan(0);
      expect(expiresIn).toBeLessThanOrEqual(600);

      const content = await signedContent(
        asString(reservation.body.downloadUrl, "download.downloadUrl"),
      );
      expect(content.status).toBe(200);
      expect(content.bytes).toEqual(file.bytes);
      if (content.contentLength !== undefined) {
        expect(content.contentLength).toBe(file.bytes.byteLength);
      }

      const localCopy = join(localDirectory, `observed-${remoteFiles.indexOf(file)}.bin`);
      await Bun.write(localCopy, content.bytes);
      expect([...new Uint8Array(await readFile(localCopy))]).toEqual([...file.bytes]);
      expect(typeof content.redirected).toBe("boolean");
    }
  });
});

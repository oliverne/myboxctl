import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { FileHandle } from "node:fs/promises";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MyboxUploader } from "../../src/mybox/upload.ts";
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
const FILE_SIZE = 100 * 1024 * 1024;
const CHUNK_SIZE = 1024 * 1024;
const INTERRUPT_AFTER_BYTES = 64 * 1024 * 1024;
const INTERRUPT_FLUSH_MS = 2_000;
const RESUME_SETTLE_MS = 2_000;
const integrationEnabled = process.env.MYBOX_UPLOAD_PROBE === "1" && Boolean(process.env.MYBOX_PAT);
const describeIntegration = integrationEnabled ? describe : describe.skip;

if (integrationEnabled) {
  setDefaultTimeout(900_000);
}

type RemoteResource = Record<string, unknown>;

let tempDirectory: string | undefined;
let folderPath: string | undefined;
let folderId: string | undefined;
let filePath: string | undefined;
let fileName: string | undefined;

function asObject(value: unknown, context: string): RemoteResource {
  if (!isRecord(value)) {
    throw new Error(`${context} is not an object`);
  }
  return value;
}

function asInteger(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${context} is not a non-negative integer`);
  }
  return value;
}

function startRssSampler(): { stop: () => number } {
  let peak = process.memoryUsage().rss;
  const timer = setInterval(() => {
    peak = Math.max(peak, process.memoryUsage().rss);
  }, 50);

  return {
    stop: () => {
      clearInterval(timer);
      return peak;
    },
  };
}

function multipartBody(
  fileHandle: FileHandle,
  name: string,
  fileSize: number,
  offset: number,
  options: { interruptAfterBytes?: number } = {},
): {
  body: ReadableStream<Uint8Array>;
  boundary: string;
  contentLength: number;
  getReadFileBytes: () => number;
  wasIntentionallyInterrupted: () => boolean;
} {
  const boundary = `----myboxctl-probe-${crypto.randomUUID()}`;
  const encoder = new TextEncoder();
  const header = encoder.encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="Filedata"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
  );
  const footer = encoder.encode(`\r\n--${boundary}--\r\n`);
  const contentLength = header.byteLength + (fileSize - offset) + footer.byteLength;
  let stage: "header" | "file" | "footer" | "done" = "header";
  let position = offset;
  let readFileBytes = 0;
  let interrupted = false;

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (stage === "header") {
        controller.enqueue(header);
        stage = "file";
        return;
      }

      if (stage === "file") {
        if (interrupted) {
          stage = "done";
          controller.error(new Error("upload probe interrupted"));
          return;
        }
        if (position < fileSize) {
          const length = Math.min(CHUNK_SIZE, fileSize - position);
          const buffer = new Uint8Array(length);
          const result = await fileHandle.read(buffer, 0, length, position);
          if (result.bytesRead !== length) {
            controller.error(new Error("upload probe read an incomplete file chunk"));
            return;
          }
          position += result.bytesRead;
          readFileBytes += result.bytesRead;
          controller.enqueue(buffer);
          if (
            options.interruptAfterBytes !== undefined &&
            readFileBytes >= options.interruptAfterBytes
          ) {
            interrupted = true;
          }
          return;
        }
        stage = "footer";
      }

      if (stage === "footer") {
        controller.enqueue(footer);
        controller.close();
        stage = "done";
      }
    },
  });

  return {
    body,
    boundary,
    contentLength,
    getReadFileBytes: () => readFileBytes,
    wasIntentionallyInterrupted: () => interrupted && stage === "done",
  };
}

async function interruptUploadProcess(
  uploadUrl: string,
  localPath: string,
  name: string,
  fileSize: number,
  interruptAfterBytes: number,
): Promise<number> {
  let resolveReady: (readFileBytes: number) => void = () => {};
  const ready = new Promise<number>((resolve) => {
    resolveReady = resolve;
  });
  const worker = Bun.spawn(
    [process.execPath, join(import.meta.dir, "upload-interrupt-worker.ts")],
    {
      env: {
        PATH: process.env.PATH ?? "",
        TMPDIR: process.env.TMPDIR ?? tmpdir(),
        MYBOX_UPLOAD_PROBE_URL: uploadUrl,
        MYBOX_UPLOAD_PROBE_FILE_PATH: localPath,
        MYBOX_UPLOAD_PROBE_FILE_NAME: name,
        MYBOX_UPLOAD_PROBE_FILE_SIZE: String(fileSize),
        MYBOX_UPLOAD_PROBE_INTERRUPT_AFTER: String(interruptAfterBytes),
      },
      stdout: "ignore",
      stderr: "ignore",
      ipc(message) {
        if (
          isRecord(message) &&
          message.type === "interrupt-ready" &&
          typeof message.readFileBytes === "number"
        ) {
          resolveReady(message.readFileBytes);
        }
      },
    },
  );

  const outcome = await Promise.race([
    ready.then((readFileBytes) => ({ type: "ready" as const, readFileBytes })),
    worker.exited.then((exitCode) => ({ type: "exit" as const, exitCode })),
    Bun.sleep(60_000).then(() => ({ type: "timeout" as const })),
  ]);
  if (outcome.type !== "ready") {
    worker.kill("SIGKILL");
    await worker.exited;
    if (outcome.type === "exit") {
      throw new Error(`upload interruption worker exited before ready: ${outcome.exitCode}`);
    }
    throw new Error("upload interruption worker timed out before ready");
  }

  // Keep the worker paused so bytes already consumed by fetch can drain to the storage socket.
  await Bun.sleep(INTERRUPT_FLUSH_MS);
  worker.kill("SIGKILL");
  await worker.exited;
  return outcome.readFileBytes;
}

async function searchFolder(path: string): Promise<RemoteResource | undefined> {
  const result = await listPages("/v1/search/resources/folders", { path, count: "20" });
  return exactPathResource(result.resources, path);
}

async function searchFile(path: string): Promise<RemoteResource | undefined> {
  const parentPath = path.slice(0, path.lastIndexOf("/")) || "/";
  const name = path.slice(path.lastIndexOf("/") + 1);
  const result = await listPages("/v1/search/resources/files", {
    q: name,
    parentPath,
    count: "20",
  });
  return exactPathResource(result.resources, path);
}

async function deleteResource(resourcePath: string, id: string): Promise<void> {
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
      throw new Error(`cleanup failed for ${resourcePath}: HTTP ${response.status}`);
    }
  }
}

async function cleanupRemote(): Promise<void> {
  if (filePath !== undefined && folderPath !== undefined) {
    const resource = await searchFile(filePath);
    if (resource !== undefined && resource.path === filePath) {
      await deleteResource(filePath, resourceId(resource, `cleanup resource for ${filePath}`));
    }
  }

  if (folderPath !== undefined && folderId !== undefined) {
    await deleteResource(folderPath, folderId);
  }
}

describe("upload probe interruption classification", () => {
  test("marks only the configured stream interruption and preserves the read byte count", async () => {
    const directory = await mkdtemp(join(tmpdir(), "myboxctl-upload-probe-unit-"));
    const handle = await open(join(directory, "intentional.bin"), "w+");
    try {
      await handle.truncate(CHUNK_SIZE * 3);
      const multipart = multipartBody(handle, "intentional.bin", CHUNK_SIZE * 3, 0, {
        interruptAfterBytes: CHUNK_SIZE * 2,
      });
      const reader = multipart.body.getReader();

      expect((await reader.read()).done).toBe(false);
      expect((await reader.read()).value?.byteLength).toBe(CHUNK_SIZE);
      expect((await reader.read()).value?.byteLength).toBe(CHUNK_SIZE);
      await expect(reader.read()).rejects.toThrow("upload probe interrupted");
      expect(multipart.getReadFileBytes()).toBe(CHUNK_SIZE * 2);
      expect(multipart.wasIntentionallyInterrupted()).toBe(true);
    } finally {
      await handle.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("does not classify an incomplete local file read as an intentional interruption", async () => {
    const directory = await mkdtemp(join(tmpdir(), "myboxctl-upload-probe-unit-"));
    const handle = await open(join(directory, "incomplete.bin"), "w+");
    try {
      await handle.truncate(CHUNK_SIZE);
      const multipart = multipartBody(handle, "incomplete.bin", CHUNK_SIZE * 2, 0);
      const reader = multipart.body.getReader();

      expect((await reader.read()).done).toBe(false);
      expect((await reader.read()).value?.byteLength).toBe(CHUNK_SIZE);
      await expect(reader.read()).rejects.toThrow("upload probe read an incomplete file chunk");
      expect(multipart.getReadFileBytes()).toBe(CHUNK_SIZE);
      expect(multipart.wasIntentionallyInterrupted()).toBe(false);
    } finally {
      await handle.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describeIntegration("MYBOX upload contract probe", () => {
  beforeAll(async () => {
    const prefix = await searchFolder(PREFIX_PATH);
    if (prefix === undefined) {
      throw new Error(`integration prefix is missing: ${PREFIX_PATH}`);
    }

    const unique = `upload-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    folderPath = joinRemotePath(PREFIX_PATH, unique);
    fileName = `probe-${crypto.randomUUID().slice(0, 8)}.bin`;
    filePath = joinRemotePath(folderPath, fileName);

    const response = await apiRequest("/v1/drive/folders", {
      method: "POST",
      body: {
        folderName: unique,
        parentId: resourceId(prefix, `integration prefix ${PREFIX_PATH}`),
      },
    });
    assertStatus(response, 201, "create upload probe folder");
    folderId = resourceId(asObject(response.body, "create upload probe folder response"), "folder");
  });

  afterAll(async () => {
    try {
      await cleanupRemote();
    } finally {
      if (tempDirectory !== undefined) {
        await rm(tempDirectory, { recursive: true, force: true });
      }
    }
  });

  test("streams 100MB, resumes after interruption, and verifies postcondition", async () => {
    if (filePath === undefined || fileName === undefined || folderId === undefined) {
      throw new Error("upload probe setup did not initialize its unique resources");
    }

    tempDirectory = await mkdtemp(join(tmpdir(), "myboxctl-upload-probe-"));
    const localPath = join(tempDirectory, fileName);
    const fileHandle = await open(localPath, "w+");
    try {
      await fileHandle.truncate(FILE_SIZE);
      const initialStats = await fileHandle.stat();
      const modifiedTime = new Date(initialStats.mtimeMs).toISOString();

      const reservation = await apiRequest("/v1/drive/files", {
        method: "POST",
        body: {
          fileName,
          fileSize: FILE_SIZE,
          parentId: folderId,
          isOverwrite: false,
          resume: true,
          modifiedTime,
        },
      });
      assertStatus(reservation, 201, "create upload probe reservation");
      const reservationBody = asObject(reservation.body, "upload reservation response");
      const initialOffset = asInteger(reservationBody.offset ?? 0, "initial upload offset");
      const initialUploadUrl = reservationBody.uploadUrl;
      if (typeof initialUploadUrl !== "string" || initialUploadUrl.length === 0) {
        throw new Error("upload reservation did not return an upload URL");
      }
      expect(initialOffset).toBe(0);

      const interruptedReadFileBytes = await interruptUploadProcess(
        initialUploadUrl,
        localPath,
        fileName,
        FILE_SIZE,
        INTERRUPT_AFTER_BYTES,
      );
      expect(interruptedReadFileBytes).toBe(INTERRUPT_AFTER_BYTES);

      // Give the storage endpoint time to close the interrupted request and persist its checkpoint
      // before asking the control-plane endpoint for a new signed URL.
      await Bun.sleep(RESUME_SETTLE_MS);

      const resumed = await apiRequest("/v1/drive/files", {
        method: "POST",
        body: {
          fileName,
          fileSize: FILE_SIZE,
          parentId: folderId,
          isOverwrite: false,
          resume: true,
          modifiedTime,
        },
      });
      assertStatus(resumed, 201, "resume upload probe reservation");
      const resumedBody = asObject(resumed.body, "resume upload reservation response");
      const resumedOffset = asInteger(resumedBody.offset ?? 0, "resume upload offset");
      const resumedUploadUrl = resumedBody.uploadUrl;
      if (typeof resumedUploadUrl !== "string" || resumedUploadUrl.length === 0) {
        throw new Error("resume reservation did not return an upload URL");
      }
      if (resumedOffset >= FILE_SIZE) {
        throw new Error(`resume reservation returned unusable offset ${resumedOffset}`);
      }

      const startRss = process.memoryUsage().rss;
      const sampler = startRssSampler();
      let peakRss = startRss;
      let final: Awaited<ReturnType<MyboxUploader["uploadContent"]>>;
      try {
        final = await new MyboxUploader().uploadContent({
          uploadUrl: resumedUploadUrl,
          fileHandle,
          fileName,
          fileSize: FILE_SIZE,
          offset: resumedOffset,
          resume: true,
          signal: AbortSignal.timeout(600_000),
        });
      } finally {
        peakRss = sampler.stop();
      }
      const peakRssDelta = Math.max(0, peakRss - startRss);
      expect(peakRssDelta).toBeLessThan(FILE_SIZE / 2);
      process.stdout.write(
        `upload probe: offset=${resumedOffset}, peakRssDelta=${peakRssDelta}, fileSize=${FILE_SIZE}\n`,
      );

      expect(final).toMatchObject({ name: fileName, fileSize: FILE_SIZE });
      const uploadedResourceId = final.resourceId;

      const afterStats = await fileHandle.stat();
      expect(afterStats.size).toBe(initialStats.size);
      expect(afterStats.mtimeMs).toBe(initialStats.mtimeMs);

      const detail = await readRequest(
        `/v1/drive/resources/${encodeURIComponent(uploadedResourceId)}`,
      );
      assertStatus(detail, 200, "uploaded resource postcondition");
      const detailBody = asObject(detail.body, "uploaded resource detail");
      expect(detailBody).toMatchObject({
        resourceId: uploadedResourceId,
        type: "file",
        size: FILE_SIZE,
      });
    } finally {
      await fileHandle.close();
    }
  });
});

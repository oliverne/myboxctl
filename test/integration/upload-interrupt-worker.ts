import { open } from "node:fs/promises";

const CHUNK_SIZE = 1024 * 1024;

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`missing upload interruption worker environment: ${name}`);
  }
  return value;
}

function positiveIntegerEnvironment(name: string): number {
  const value = Number(requiredEnvironment(name));
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`invalid upload interruption worker environment: ${name}`);
  }
  return value;
}

const uploadUrl = requiredEnvironment("MYBOX_UPLOAD_PROBE_URL");
const filePath = requiredEnvironment("MYBOX_UPLOAD_PROBE_FILE_PATH");
const fileName = requiredEnvironment("MYBOX_UPLOAD_PROBE_FILE_NAME");
const fileSize = positiveIntegerEnvironment("MYBOX_UPLOAD_PROBE_FILE_SIZE");
const interruptAfterBytes = positiveIntegerEnvironment("MYBOX_UPLOAD_PROBE_INTERRUPT_AFTER");

if (interruptAfterBytes >= fileSize) {
  throw new Error("upload interruption point must be smaller than the file size");
}

const boundary = `----myboxctl-probe-${crypto.randomUUID()}`;
const encoder = new TextEncoder();
const escapedFileName = fileName.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
const header = encoder.encode(
  `--${boundary}\r\nContent-Disposition: form-data; name="Filedata"; filename="${escapedFileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
);
const footer = encoder.encode(`\r\n--${boundary}--\r\n`);
const contentLength = header.byteLength + fileSize + footer.byteLength;
const fileHandle = await open(filePath, "r");
let stage: "header" | "file" | "paused" | "footer" | "done" = "header";
let position = 0;
let readFileBytes = 0;

const body = new ReadableStream<Uint8Array>({
  async pull(controller) {
    if (stage === "header") {
      controller.enqueue(header);
      stage = "file";
      return;
    }

    if (stage === "paused") {
      await new Promise<never>(() => {});
      return;
    }

    if (stage === "file" && position < fileSize) {
      const length = Math.min(CHUNK_SIZE, fileSize - position);
      const buffer = new Uint8Array(length);
      const result = await fileHandle.read(buffer, 0, length, position);
      if (result.bytesRead !== length) {
        controller.error(new Error("upload interruption worker read an incomplete file chunk"));
        return;
      }
      position += result.bytesRead;
      readFileBytes += result.bytesRead;
      controller.enqueue(buffer);
      if (readFileBytes >= interruptAfterBytes) {
        stage = "paused";
        process.send?.({ type: "interrupt-ready", readFileBytes });
      }
      return;
    }

    if (stage === "file") {
      stage = "footer";
    }
    if (stage === "footer") {
      controller.enqueue(footer);
      controller.close();
      stage = "done";
    }
  },
});

try {
  await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Length": String(contentLength),
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });
  process.exitCode = 2;
} catch {
  process.exitCode = 3;
} finally {
  await fileHandle.close();
}

import type { FileHandle } from "node:fs/promises";

import { apiResponseError, DomainError, domainErrorForHttp, normalizeError } from "../errors.ts";
import { type EventSink, noOpEventSink } from "../observability.ts";
import {
  type MyboxError,
  myboxErrorSchema,
  type UploadContentResponse,
  uploadContentResponseSchema,
} from "./contract.ts";

const CHUNK_SIZE = 1024 * 1024;

export type UploadContentInput = {
  uploadUrl: string;
  fileHandle: FileHandle;
  fileName: string;
  fileSize: number;
  offset: number;
  resume: boolean;
  signal: AbortSignal;
};

export type UploaderDependencies = {
  fetch: typeof globalThis.fetch;
  eventSink: EventSink;
  now: () => number;
};

const defaultDependencies: UploaderDependencies = {
  fetch: globalThis.fetch,
  eventSink: noOpEventSink,
  now: () => Date.now(),
};

function localReadError(cause: unknown): DomainError {
  return new DomainError("local-file", "The local upload file could not be read.", {
    cause,
    retryable: false,
  });
}

function parseBody(text: string): unknown {
  if (text.length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function storageError(response: Response, body: unknown): DomainError {
  const parsed = myboxErrorSchema.safeParse(body);
  const options: { code?: string; requestId?: string } = {};
  if (parsed.success) {
    const error: MyboxError = parsed.data;
    options.code = error.code;
    if (error.requestId !== undefined) {
      options.requestId = error.requestId;
    }
  }
  return domainErrorForHttp(response.status, options);
}

function validateFileName(fileName: string): void {
  const hasControlCharacter = [...fileName].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
  if (hasControlCharacter) {
    throw new DomainError(
      "invalid-arguments",
      "The upload file name must not contain control characters.",
    );
  }
}

function validateRange(fileSize: number, offset: number): void {
  if (
    !Number.isSafeInteger(fileSize) ||
    fileSize < 0 ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > fileSize
  ) {
    throw apiResponseError("MYBOX returned an invalid upload offset.");
  }
}

function multipartBody(
  input: UploadContentInput,
  dependencies: { onProgress: (transferredBytes: number) => void },
): {
  body: ReadableStream<Uint8Array>;
  boundary: string;
  contentLength: number;
  getFailure: () => DomainError | undefined;
} {
  const boundary = `----myboxctl-${crypto.randomUUID()}`;
  const encoder = new TextEncoder();
  const escapedFileName = input.fileName.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  const header = encoder.encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="Filedata"; filename="${escapedFileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
  );
  const footer = encoder.encode(`\r\n--${boundary}--\r\n`);
  const contentLength = header.byteLength + (input.fileSize - input.offset) + footer.byteLength;
  let stage: "header" | "file" | "footer" | "done" = "header";
  let position = input.offset;
  let failure: DomainError | undefined;

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (stage === "header") {
        controller.enqueue(header);
        stage = "file";
        return;
      }

      if (stage === "file" && position < input.fileSize) {
        const length = Math.min(CHUNK_SIZE, input.fileSize - position);
        const buffer = new Uint8Array(length);
        try {
          const result = await input.fileHandle.read(buffer, 0, length, position);
          if (result.bytesRead !== length) {
            failure = localReadError(new Error("The local file ended before its initial size."));
            controller.error(failure);
            return;
          }
          position += result.bytesRead;
          dependencies.onProgress(position);
          controller.enqueue(buffer);
          return;
        } catch (error) {
          failure = error instanceof DomainError ? error : localReadError(error);
          controller.error(failure);
          return;
        }
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

  return { body, boundary, contentLength, getFailure: () => failure };
}

export class MyboxUploader {
  readonly dependencies: UploaderDependencies;

  constructor(dependencies: Partial<UploaderDependencies> = {}) {
    this.dependencies = { ...defaultDependencies, ...dependencies };
  }

  async uploadContent(input: UploadContentInput): Promise<UploadContentResponse> {
    validateFileName(input.fileName);
    validateRange(input.fileSize, input.offset);
    const startedAt = this.dependencies.now();
    let lastProgressAt = startedAt;
    const progressData = (transferredBytes: number) => ({
      transferredBytes,
      totalBytes: input.fileSize,
      percent: input.fileSize === 0 ? 100 : (transferredBytes / input.fileSize) * 100,
      offset: input.offset,
      elapsedMs: Math.max(0, this.dependencies.now() - startedAt),
    });
    this.dependencies.eventSink.emit({
      type: "event",
      level: "info",
      event: "upload.transfer-started",
      data: progressData(input.offset),
    });
    const multipart = multipartBody(input, {
      onProgress: (transferredBytes) => {
        const now = this.dependencies.now();
        if (transferredBytes === input.fileSize || now - lastProgressAt >= 1_000) {
          lastProgressAt = now;
          this.dependencies.eventSink.emit({
            type: "event",
            level: "info",
            event: "upload.transfer-progress",
            data: progressData(transferredBytes),
          });
        }
      },
    });
    const headers = new Headers({
      "Content-Length": String(multipart.contentLength),
      "Content-Type": `multipart/form-data; boundary=${multipart.boundary}`,
    });
    if (input.resume && input.fileSize > 0) {
      headers.set("Content-Range", `${input.offset}-${input.fileSize - 1}/${input.fileSize}`);
    }

    let response: Response;
    try {
      response = await this.dependencies.fetch(input.uploadUrl, {
        method: "POST",
        headers,
        body: multipart.body,
        signal: input.signal,
      });
    } catch (error) {
      const bodyFailure = multipart.getFailure();
      throw bodyFailure ?? normalizeError(error);
    }

    let bodyText: string;
    try {
      bodyText = await response.text();
    } catch (error) {
      throw normalizeError(error);
    }
    const body = parseBody(bodyText);
    if (response.status !== 200) {
      throw storageError(response, body);
    }
    const parsed = uploadContentResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw apiResponseError("MYBOX returned an invalid upload completion response.");
    }
    this.dependencies.eventSink.emit({
      type: "event",
      level: "info",
      event: "upload.transfer-completed",
      data: progressData(input.fileSize),
    });
    return parsed.data;
  }
}

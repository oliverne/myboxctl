import type { FileHandle } from "node:fs/promises";

import { DomainError, domainErrorForHttp, normalizeError } from "../errors.ts";
import { parseRetryAfterMs } from "./rate-limit.ts";

export type DownloadContentInput = {
  downloadUrl: string;
  fileHandle: FileHandle;
  expectedSize: number;
  signal: AbortSignal;
  onProgress?: (receivedBytes: number) => void;
};

export type DownloaderDependencies = {
  fetch: typeof globalThis.fetch;
};

const defaultDependencies: DownloaderDependencies = { fetch: globalThis.fetch };

function contentFailure(message: string, retryable: boolean, cause?: unknown): DomainError {
  return new DomainError("api-unavailable", message, {
    code: "DOWNLOAD_CONTENT_FAILED",
    retryable,
    cause,
  });
}

async function writeAll(handle: FileHandle, chunk: Uint8Array, position: number): Promise<void> {
  let offset = 0;
  while (offset < chunk.byteLength) {
    const result = await handle.write(chunk, offset, chunk.byteLength - offset, position + offset);
    if (result.bytesWritten <= 0) {
      throw new DomainError("local-file", "The downloaded file could not be written.");
    }
    offset += result.bytesWritten;
  }
}

export class MyboxDownloader {
  readonly dependencies: DownloaderDependencies;

  constructor(dependencies: Partial<DownloaderDependencies> = {}) {
    this.dependencies = { ...defaultDependencies, ...dependencies };
  }

  async downloadContent(input: DownloadContentInput): Promise<number> {
    let response: Response;
    try {
      response = await this.dependencies.fetch(input.downloadUrl, {
        method: "GET",
        redirect: "follow",
        signal: input.signal,
      });
    } catch (error) {
      const normalized = normalizeError(error);
      if (normalized.kind === "api-unavailable") {
        throw contentFailure("The MYBOX download transfer failed.", true, error);
      }
      throw normalized;
    }

    if (response.status !== 200) {
      if (response.status === 429) {
        throw domainErrorForHttp(429, {
          retryAfterMs: parseRetryAfterMs(response.headers) ?? 60_000,
        });
      }
      throw contentFailure("The MYBOX download transfer was rejected.", response.status >= 500);
    }

    const reader = response.body?.getReader();
    if (reader === undefined) {
      if (input.expectedSize === 0) {
        return 0;
      }
      throw contentFailure("The MYBOX download response had no content body.", false);
    }

    let received = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          return received;
        }
        if (received + value.byteLength > input.expectedSize) {
          throw contentFailure("The downloaded byte count exceeded remote metadata.", false);
        }
        await writeAll(input.fileHandle, value, received);
        received += value.byteLength;
        input.onProgress?.(received);
      }
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      if (error instanceof DomainError) {
        throw error;
      }
      throw contentFailure("The MYBOX download transfer failed.", true, error);
    }
  }
}

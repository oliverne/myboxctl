import { apiResponseError, DomainError } from "../errors.ts";
import {
  commitDownloadFile,
  prepareDownloadFile,
  removeDownloadTemp,
} from "../local/download-file.ts";
import type { MyboxClient } from "../mybox/client.ts";
import type { MyboxDownloader } from "../mybox/download.ts";
import { parseRemotePath } from "../remote/path.ts";
import type { RemoteResolver } from "../remote/resolver.ts";

export type DownloadOptions = { overwrite?: boolean };

export type DownloadDependencies = {
  client: MyboxClient;
  resolver: RemoteResolver;
  downloader: MyboxDownloader;
  timeoutMs: number;
  signal?: AbortSignal;
};

export type DownloadResult = {
  action: "downloaded";
  data: {
    remotePath: string;
    localPath: string;
    resourceId: string;
    size: number;
    modifiedAt: string;
  };
};

export async function runDownload(
  remotePath: string,
  localPath: string,
  options: DownloadOptions,
  dependencies: DownloadDependencies,
): Promise<DownloadResult> {
  const target = parseRemotePath(remotePath);
  if (target.kind === "root") {
    throw new DomainError("invalid-arguments", "The remote root cannot be downloaded as a file.");
  }

  const resolution = await dependencies.resolver.resolveExact(target);
  if (resolution.kind === "absent") {
    throw new DomainError("not-found", `The remote file was not found: ${target.normalized}.`);
  }
  if (resolution.kind === "root" || resolution.resource.type.toLowerCase() !== "file") {
    throw new DomainError(
      "conflict",
      `The remote download path is not a file: ${target.normalized}.`,
    );
  }

  const before = await dependencies.resolver.detail(resolution);
  if (before.type.toLowerCase() !== "file") {
    throw new DomainError(
      "conflict",
      `The remote download path is not a file: ${target.normalized}.`,
    );
  }

  const prepared = await prepareDownloadFile(localPath, options.overwrite ?? false);
  let handleClosed = false;
  try {
    const reservation = await dependencies.client.createDownloadUrl(before.resourceId);
    const timeoutSignal = AbortSignal.timeout(dependencies.timeoutMs);
    const signal = dependencies.signal
      ? AbortSignal.any([dependencies.signal, timeoutSignal])
      : timeoutSignal;
    const received = await dependencies.downloader.downloadContent({
      downloadUrl: reservation.downloadUrl,
      fileHandle: prepared.handle,
      expectedSize: before.size,
      signal,
    });
    if (received !== before.size) {
      throw apiResponseError("The downloaded byte count did not match remote metadata.");
    }

    const after = await dependencies.client.getResource(before.resourceId);
    if (
      after.resourceId !== before.resourceId ||
      after.type.toLowerCase() !== "file" ||
      after.size !== before.size ||
      after.modifiedAt !== before.modifiedAt
    ) {
      throw new DomainError("conflict", "The remote file changed during download.");
    }

    const modifiedAt = new Date(before.modifiedAt);
    if (Number.isNaN(modifiedAt.getTime())) {
      throw apiResponseError("MYBOX returned an invalid modified time.");
    }
    try {
      await prepared.handle.utimes(modifiedAt, modifiedAt);
      await prepared.handle.sync();
      await prepared.handle.close();
    } catch (error) {
      throw new DomainError("local-file", "The downloaded file could not be finalized.", {
        cause: error,
      });
    }
    handleClosed = true;
    await commitDownloadFile(prepared);

    return {
      action: "downloaded",
      data: {
        remotePath: target.normalized,
        localPath,
        resourceId: before.resourceId,
        size: before.size,
        modifiedAt: before.modifiedAt,
      },
    };
  } finally {
    if (!handleClosed) {
      await prepared.handle.close().catch(() => undefined);
    }
    await removeDownloadTemp(prepared).catch(() => undefined);
  }
}

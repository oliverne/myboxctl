import { type FileHandle, open } from "node:fs/promises";

import { apiResponseError, DomainError } from "../../errors.ts";
import type { ResourceDetail } from "../../mybox/contract.ts";
import { canonicalRemotePath, parseRemotePath } from "../../remote/path.ts";
import { runUpload, type UploadData, type UploadDependencies } from "../upload.ts";
import { decidePut, type PutReason } from "./decision.ts";

export type PutOptions = {
  force?: boolean;
  mkdir?: boolean;
};

export type PutData = UploadData & {
  reason: PutReason;
};

export type PutResult = {
  action: "uploaded" | "overwritten" | "skipped";
  data: PutData;
};

function localFileError(message: string, cause?: unknown): DomainError {
  return new DomainError("local-file", message, { cause, retryable: false });
}

async function readLocalMetadata(path: string): Promise<{ size: number; modifiedAtMs: number }> {
  let handle: FileHandle;
  try {
    handle = await open(path, "r");
  } catch (error) {
    throw localFileError(`The local put file could not be opened: ${path}.`, error);
  }

  try {
    const stats = await handle.stat();
    if (!stats.isFile()) {
      throw localFileError(`The local put path is not a regular file: ${path}.`);
    }
    if (!Number.isSafeInteger(stats.size) || stats.size < 0 || !Number.isFinite(stats.mtimeMs)) {
      throw localFileError(`The local put file metadata is unsupported: ${path}.`);
    }
    return { size: stats.size, modifiedAtMs: stats.mtimeMs };
  } catch (error) {
    if (error instanceof DomainError) {
      throw error;
    }
    throw localFileError(`The local put file could not be inspected: ${path}.`, error);
  } finally {
    await handle.close();
  }
}

function remoteModifiedAtMs(detail: ResourceDetail): number {
  const value = Date.parse(detail.modifiedAt);
  if (!Number.isFinite(value)) {
    throw apiResponseError("MYBOX returned an invalid remote modifiedAt value.");
  }
  return value;
}

export async function runPut(
  localPath: string,
  remotePath: string,
  options: PutOptions,
  dependencies: UploadDependencies,
): Promise<PutResult> {
  const target = parseRemotePath(remotePath);
  if (target.kind === "root") {
    throw new DomainError("invalid-arguments", "A file cannot be put at the remote root path.");
  }

  const local = await readLocalMetadata(localPath);
  const canonicalTarget = canonicalRemotePath(target);
  if (canonicalTarget.kind === "root") {
    throw new DomainError("unexpected", "The canonical put target was invalid.");
  }
  const resolution = await dependencies.resolver.resolveForMutation(target);
  let detail: ResourceDetail | undefined;
  const remote = await (async () => {
    if (resolution.kind === "absent") {
      return { kind: "absent" as const };
    }
    if (resolution.kind === "root") {
      throw new DomainError("unexpected", "The put target resolution was invalid.");
    }
    if (resolution.resource.type.toLowerCase() !== "file") {
      return { kind: "folder" as const };
    }

    detail = await dependencies.client.getResource(resolution.resource.resourceId);
    if (
      detail.resourceId !== resolution.resource.resourceId ||
      detail.type.toLowerCase() !== "file" ||
      detail.name !== resolution.resource.name
    ) {
      throw apiResponseError("MYBOX put metadata did not match the exact target.");
    }
    return {
      kind: "file" as const,
      size: detail.size,
      modifiedAtMs: remoteModifiedAtMs(detail),
    };
  })();

  const decision = decidePut({ force: options.force ?? false, local, remote });
  if (decision.action === "conflict") {
    if (decision.reason === "remote-newer") {
      throw new DomainError("conflict", "The remote file is newer than the local file.", {
        code: "REMOTE_NEWER",
      });
    }
    throw new DomainError(
      "conflict",
      `A remote directory already exists at ${target.normalized}.`,
      {
        code: "REMOTE_TYPE_CONFLICT",
      },
    );
  }

  if (decision.action === "skip") {
    if (detail === undefined) {
      throw new DomainError("unexpected", "The skipped put target has no metadata.");
    }
    return {
      action: "skipped",
      data: {
        path: canonicalTarget.normalized,
        resourceId: detail.resourceId,
        size: detail.size,
        modifiedAt: detail.modifiedAt,
        reason: decision.reason,
      },
    };
  }

  const uploaded = await runUpload(
    localPath,
    target.normalized,
    {
      overwrite: decision.action === "overwrite" || (options.force ?? false),
      ...(options.mkdir === undefined ? {} : { mkdir: options.mkdir }),
    },
    dependencies,
  );
  return {
    action: uploaded.action,
    data: { ...uploaded.data, reason: decision.reason },
  };
}

export const put = runPut;

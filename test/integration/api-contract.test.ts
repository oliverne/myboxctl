import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdir } from "node:fs/promises";

import {
  type ApiResponse,
  apiRequest,
  asArray,
  asNumber,
  asString,
  assertOkStatus,
  assertStatus,
  exactPathResource,
  isRecord,
  type JsonRecord,
  joinRemotePath,
  listPages,
  pathWithTrailingSlash,
  readRequest,
  resourceId,
  safeHeaderNames,
  timestampPrecision,
  uploadBytes,
} from "./helpers.ts";

const PREFIX_PATH = "/myboxctl-integration-test/";
const FIXTURE_PATH = "test/fixtures/mybox/api-contract.latest.json";
const integrationEnabled = process.env.MYBOX_CONTRACT === "1" && Boolean(process.env.MYBOX_PAT);
const describeIntegration = integrationEnabled ? describe : describe.skip;
if (integrationEnabled) {
  setDefaultTimeout(600_000);
}

type IntegrationContext = {
  childId: string;
  childName: string;
  childPath: string;
};

type ContractObservation = {
  contract: string;
  generatedAt: string;
  root: JsonRecord;
  resolver: JsonRecord;
  folderCreation: JsonRecord;
  uploadReservation: JsonRecord;
  uploadContent: JsonRecord;
  visibility: JsonRecord;
  overwrite: JsonRecord;
  resume: JsonRecord;
  duplicates: JsonRecord;
  errors: JsonRecord;
  cleanup: JsonRecord;
};

const observation: ContractObservation = {
  contract: "mybox-api",
  generatedAt: new Date().toISOString(),
  root: {},
  resolver: {},
  folderCreation: {},
  uploadReservation: {},
  uploadContent: {},
  visibility: {},
  overwrite: {},
  resume: {},
  duplicates: {},
  errors: {},
  cleanup: {},
};

let context: IntegrationContext | undefined;

function responseKeys(response: ApiResponse): string[] {
  return isRecord(response.body) ? Object.keys(response.body).sort() : [];
}

function responseCode(response: ApiResponse): string | undefined {
  if (!isRecord(response.body) || typeof response.body.code !== "string") {
    return undefined;
  }

  return response.body.code;
}

function recordResponse(response: ApiResponse): JsonRecord {
  const result: JsonRecord = {
    status: response.status,
    bodyKeys: responseKeys(response),
  };
  const code = responseCode(response);
  if (code !== undefined) {
    result.code = code;
  }

  return result;
}

function requireBody(response: ApiResponse, operation: string): JsonRecord {
  assertStatus(response, 200, operation);
  if (!isRecord(response.body)) {
    throw new Error(`${operation} returned a non-object response`);
  }

  return response.body;
}

function assertUploadResult(
  result: Awaited<ReturnType<typeof uploadBytes>>,
  expectedName: string,
  expectedSize: number,
  operation: string,
): void {
  assertOkStatus(result.status, operation);
  if (!isRecord(result.body)) {
    throw new Error(`${operation} returned a non-object response`);
  }

  asString(result.body.resourceId, `${operation}.resourceId`);
  if (result.body.name !== expectedName) {
    throw new Error(`${operation} returned an unexpected file name`);
  }
  if (asNumber(result.body.fileSize, `${operation}.fileSize`) !== expectedSize) {
    throw new Error(`${operation} returned an unexpected file size`);
  }
}

function assertResourceShape(resource: unknown, operation: string): JsonRecord {
  if (!isRecord(resource)) {
    throw new Error(`${operation} returned a non-object resource`);
  }

  asString(resource.resourceId, `${operation}.resourceId`);
  asString(resource.name, `${operation}.name`);
  asString(resource.parentId, `${operation}.parentId`);
  asString(resource.type, `${operation}.type`);
  asNumber(resource.size, `${operation}.size`);
  asString(resource.createdAt, `${operation}.createdAt`);
  asString(resource.modifiedAt, `${operation}.modifiedAt`);
  asString(resource.accessedAt, `${operation}.accessedAt`);

  if (typeof resource.isFavorite !== "boolean") {
    throw new Error(`${operation}.isFavorite is missing or invalid`);
  }
  if (typeof resource.isHidden !== "boolean") {
    throw new Error(`${operation}.isHidden is missing or invalid`);
  }
  asString(resource.lastModifiedBy, `${operation}.lastModifiedBy`);

  return resource;
}

function findFileResource(
  resources: unknown[],
  name: string,
  parentPath: string,
): JsonRecord | undefined {
  const normalizedParent = pathWithTrailingSlash(parentPath);
  return resources.find((resource): resource is JsonRecord => {
    if (!isRecord(resource) || resource.name !== name) {
      return false;
    }

    const fullPath = joinRemotePath(parentPath, name);
    const pathMatches = resource.path === fullPath || resource.path === `${fullPath}/`;
    const parentMatches =
      resource.parentPath === parentPath || resource.parentPath === normalizedParent;
    return pathMatches || parentMatches;
  });
}

async function searchFolders(path: string): Promise<{ pages: JsonRecord[]; resources: unknown[] }> {
  return listPages("/v1/search/resources/folders", {
    path,
    count: "20",
  });
}

async function searchFiles(
  name: string,
  parentPath: string,
): Promise<{ pages: JsonRecord[]; resources: unknown[] }> {
  return listPages("/v1/search/resources/files", {
    q: name,
    parentPath,
    count: "20",
  });
}

async function getResource(id: string): Promise<JsonRecord> {
  const response = await readRequest(`/v1/drive/resources/${encodeURIComponent(id)}`);
  return requireBody(response, "resource detail");
}

async function reserveUpload(
  fileName: string,
  fileSize: number,
  parentId: string,
  options: { isOverwrite?: boolean; resume?: boolean; modifiedTime?: string } = {},
): Promise<{ response: ApiResponse; uploadUrl?: string; offset?: number }> {
  const body: JsonRecord = {
    fileName,
    fileSize,
    parentId,
  };
  if (options.isOverwrite !== undefined) {
    body.isOverwrite = options.isOverwrite;
  }
  if (options.resume !== undefined) {
    body.resume = options.resume;
  }
  if (options.modifiedTime !== undefined) {
    body.modifiedTime = options.modifiedTime;
  }

  const response = await apiRequest("/v1/drive/files", {
    method: "POST",
    body,
  });

  if (response.status !== 201 || !isRecord(response.body)) {
    return { response };
  }

  const uploadUrl =
    typeof response.body.uploadUrl === "string" ? response.body.uploadUrl : undefined;
  const offset = typeof response.body.offset === "number" ? response.body.offset : undefined;
  const result: { response: ApiResponse; uploadUrl?: string; offset?: number } = { response };
  if (uploadUrl !== undefined) {
    result.uploadUrl = uploadUrl;
  }
  if (offset !== undefined) {
    result.offset = offset;
  }
  return result;
}

async function eventuallyFindFolder(
  path: string,
): Promise<{ delayMs: number; resource?: JsonRecord; statuses: number[] }> {
  const statuses: number[] = [];
  let found: JsonRecord | undefined;
  let firstVisibleAt: number | undefined;

  for (const delayMs of [0, 250, 1_000, 2_000]) {
    if (delayMs > 0) {
      await Bun.sleep(delayMs - (delayMs === 250 ? 0 : delayMs === 1_000 ? 250 : 1_000));
    }

    const result = await searchFolders(path);
    statuses.push(200);
    const match = exactPathResource(result.resources, path);
    if (match !== undefined && firstVisibleAt === undefined) {
      found = match;
      firstVisibleAt = delayMs;
    }
  }

  const result: { delayMs: number; resource?: JsonRecord; statuses: number[] } = {
    delayMs: firstVisibleAt ?? -1,
    statuses,
  };
  if (found !== undefined) {
    result.resource = found;
  }
  return result;
}

async function eventuallyFindFile(
  name: string,
  parentPath: string,
): Promise<{ delayMs: number; resource?: JsonRecord; statuses: number[] }> {
  const statuses: number[] = [];
  let found: JsonRecord | undefined;
  let firstVisibleAt: number | undefined;
  let elapsed = 0;

  for (const delayMs of [0, 250, 1_000, 2_000]) {
    const wait = delayMs - elapsed;
    if (wait > 0) {
      await Bun.sleep(wait);
    }
    elapsed = delayMs;

    const result = await searchFiles(name, parentPath);
    statuses.push(200);
    const match = findFileResource(result.resources, name, parentPath);
    if (match !== undefined && firstVisibleAt === undefined) {
      found = match;
      firstVisibleAt = delayMs;
    }
  }

  const result: { delayMs: number; resource?: JsonRecord; statuses: number[] } = {
    delayMs: firstVisibleAt ?? -1,
    statuses,
  };
  if (found !== undefined) {
    result.resource = found;
  }
  return result;
}

async function writeFixture(): Promise<void> {
  await mkdir("test/fixtures/mybox", { recursive: true });
  await Bun.write(`${FIXTURE_PATH}`, `${JSON.stringify(observation, null, 2)}\n`);
}

describeIntegration("MYBOX API contract", () => {
  beforeAll(async () => {
    const prefixResult = await searchFolders(PREFIX_PATH);
    const prefix = exactPathResource(prefixResult.resources, PREFIX_PATH);
    if (prefix === undefined) {
      throw new Error(`integration prefix is missing: ${PREFIX_PATH}`);
    }

    const prefixId = resourceId(prefix, "integration prefix");
    const childName = `contract-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const createResponse = await apiRequest("/v1/drive/folders", {
      method: "POST",
      body: {
        folderName: childName,
        parentId: prefixId,
      },
    });
    assertStatus(createResponse, 201, "create unique integration folder");
    if (!isRecord(createResponse.body)) {
      throw new Error("create unique integration folder returned a non-object response");
    }

    const createdName = asString(createResponse.body.name, "created folder.name");
    if (createdName !== childName) {
      throw new Error("MYBOX changed the unique integration folder name");
    }

    context = {
      childId: resourceId(createResponse.body, "created folder"),
      childName,
      childPath: joinRemotePath(PREFIX_PATH, childName),
    };
    observation.folderCreation = {
      status: createResponse.status,
      responseKeys: responseKeys(createResponse),
      parentWasPrefix: true,
    };
  });

  afterAll(async () => {
    let cleanupError: Error | undefined;

    if (context !== undefined) {
      try {
        const response = await apiRequest(
          `/v1/drive/resources/${encodeURIComponent(context.childId)}`,
          {
            method: "DELETE",
          },
        );
        observation.cleanup = {
          status: response.status,
          exactResourceOnly: true,
        };
        if (response.status !== 204 && response.status !== 404) {
          cleanupError = new Error(
            `cleanup failed for exact path ${context.childPath} and resourceId ${context.childId}: HTTP ${response.status}`,
          );
        }
      } catch (error) {
        cleanupError = error instanceof Error ? error : new Error(String(error));
      }
    } else {
      observation.cleanup = { status: "not-created" };
    }

    await writeFixture();
    if (cleanupError !== undefined) {
      throw cleanupError;
    }
  });

  test("probes read, resolver, upload, overwrite, resume, and error contracts", async () => {
    if (context === undefined) {
      throw new Error("integration context was not created");
    }

    const root = await listPages("/v1/drive/resources", { count: "1" });
    for (const [index, page] of root.pages.entries()) {
      asNumber(page.fileCount, `root page ${index}.fileCount`);
      asNumber(page.subFolderCount, `root page ${index}.subFolderCount`);
      asArray(page.resources, `root page ${index}.resources`);
      if (!isRecord(page.responseMetaData)) {
        throw new Error(`root page ${index}.responseMetaData is missing or invalid`);
      }

      for (const [resourceIndex, resource] of (page.resources as unknown[]).entries()) {
        assertResourceShape(resource, `root page ${index}.resource ${resourceIndex}`);
      }
    }
    observation.root = {
      pages: root.pages.length,
      resourceCount: root.resources.length,
      responseKeys: Object.keys(root.pages[0] ?? {}).sort(),
      cursorObserved: root.pages.some(
        (page) =>
          isRecord(page.responseMetaData) && typeof page.responseMetaData.nextCursor === "string",
      ),
    };

    const detail = await getResource(context.childId);
    asString(detail.resourceId, "child detail.resourceId");
    asString(detail.name, "child detail.name");
    asString(detail.parentId, "child detail.parentId");
    asString(detail.type, "child detail.type");
    asNumber(detail.size, "child detail.size");
    asString(detail.createdAt, "child detail.createdAt");
    asString(detail.modifiedAt, "child detail.modifiedAt");
    observation.resolver = {
      folderDetailStatus: 200,
      folderDetailKeys: Object.keys(detail).sort(),
      folderType: detail.type,
      directChildrenCountsPresent: "fileCount" in detail && "subFolderCount" in detail,
    };

    const directChildrenResults: JsonRecord[] = [];
    const candidateEndpoints = [
      "/v1/drive/resources/{resourceId}/children",
      "/v1/drive/resources/{resourceId}/resources",
    ];
    for (const [index, candidate] of candidateEndpoints.entries()) {
      const response = await readRequest(
        candidate.replace("{resourceId}", encodeURIComponent(context.childId)),
      );
      const result: JsonRecord = {
        endpoint: candidate,
        status: response.status,
        bodyKeys: responseKeys(response),
      };
      if (
        response.status === 200 &&
        isRecord(response.body) &&
        Array.isArray(response.body.resources)
      ) {
        result.resourcesField = true;
        directChildrenResults.push(result);
      }
      observation.resolver[`directChildrenCandidate${index + 1}`] = result;
    }
    observation.resolver.directChildrenEndpoint =
      directChildrenResults.length > 0
        ? (directChildrenResults[0]?.endpoint ?? "unknown")
        : "not-found-in-probes";

    const childVisibility = await eventuallyFindFolder(context.childPath);
    if (childVisibility.resource === undefined) {
      throw new Error(
        `unique folder was not visible by exact path after ${childVisibility.statuses.length} probes`,
      );
    }
    observation.visibility = {
      folderFirstVisibleAfterMs: childVisibility.delayMs,
      folderProbeCount: childVisibility.statuses.length,
    };

    const specialFolderName = `한글 # %+ ${context.childName}`;
    const specialFolderResponse = await apiRequest("/v1/drive/folders", {
      method: "POST",
      body: {
        folderName: specialFolderName,
        parentId: context.childId,
      },
    });
    assertStatus(specialFolderResponse, 201, "create special-character folder");
    const specialFolderPath = joinRemotePath(context.childPath, specialFolderName);
    const specialFolderSearch = await searchFolders(specialFolderPath);
    const specialFolder = exactPathResource(specialFolderSearch.resources, specialFolderPath);
    if (specialFolder === undefined) {
      throw new Error("special-character folder was not found by exact path");
    }
    observation.resolver.specialName = {
      created: true,
      searched: true,
      responseKeys: responseKeys(specialFolderResponse),
    };

    const smallName = `small-${context.childName}.txt`;
    const smallBytes = new TextEncoder().encode("myboxctl API contract\n");
    const smallReservation = await reserveUpload(
      smallName,
      smallBytes.byteLength,
      context.childId,
      {
        isOverwrite: false,
        resume: false,
      },
    );
    assertStatus(smallReservation.response, 201, "reserve small upload");
    if (smallReservation.uploadUrl === undefined) {
      throw new Error("small upload reservation did not return uploadUrl");
    }
    observation.uploadReservation.small = {
      status: smallReservation.response.status,
      responseKeys: responseKeys(smallReservation.response),
      offset: smallReservation.offset ?? null,
      urlReturned: true,
    };

    const smallUpload = await uploadBytes(smallReservation.uploadUrl, smallName, smallBytes);
    assertUploadResult(smallUpload, smallName, smallBytes.byteLength, "upload small content");
    observation.uploadContent.small = {
      method: "POST",
      requestHeaders: ["Content-Length", "Content-Type"],
      partName: "Filedata",
      authorizationHeaderSent: false,
      responseKeys: isRecord(smallUpload.body) ? Object.keys(smallUpload.body).sort() : [],
      status: smallUpload.status,
      responseHeaderNames: safeHeaderNames(smallUpload.headers),
    };

    const smallVisibility = await eventuallyFindFile(smallName, context.childPath);
    if (smallVisibility.resource === undefined) {
      throw new Error(
        `small file was not visible by exact path after ${smallVisibility.statuses.length} probes`,
      );
    }
    const smallResourceId = resourceId(smallVisibility.resource, "small file search result");
    const smallDetail = await getResource(smallResourceId);
    const smallModifiedAt = asString(smallDetail.modifiedAt, "small file.modifiedAt");
    asNumber(smallDetail.size, "small file.size");
    observation.visibility.smallFileFirstVisibleAfterMs = smallVisibility.delayMs;
    observation.visibility.smallFileProbeCount = smallVisibility.statuses.length;
    observation.visibility.modifiedAtPrecision = timestampPrecision(smallModifiedAt);

    const zeroName = `zero-${context.childName}.bin`;
    const zeroBytes = new Uint8Array(0);
    const zeroReservation = await reserveUpload(zeroName, 0, context.childId, {
      isOverwrite: false,
      resume: false,
    });
    assertStatus(zeroReservation.response, 201, "reserve zero-byte upload");
    if (zeroReservation.uploadUrl === undefined) {
      throw new Error("zero-byte upload reservation did not return uploadUrl");
    }
    const zeroUpload = await uploadBytes(zeroReservation.uploadUrl, zeroName, zeroBytes);
    assertUploadResult(zeroUpload, zeroName, 0, "upload zero-byte content");
    observation.uploadContent.zeroByte = {
      method: "POST",
      requestHeaders: ["Content-Length", "Content-Type"],
      contentType: "multipart/form-data",
      partName: "Filedata",
      contentLength: 0,
      responseKeys: isRecord(zeroUpload.body) ? Object.keys(zeroUpload.body).sort() : [],
      status: zeroUpload.status,
    };

    const overwriteBytes = new TextEncoder().encode("myboxctl API contract overwrite\n");
    const overwriteReservation = await reserveUpload(
      smallName,
      overwriteBytes.byteLength,
      context.childId,
      {
        isOverwrite: true,
        resume: false,
      },
    );
    assertStatus(overwriteReservation.response, 201, "reserve overwrite upload");
    if (overwriteReservation.uploadUrl === undefined) {
      throw new Error("overwrite reservation did not return uploadUrl");
    }
    const overwriteUpload = await uploadBytes(
      overwriteReservation.uploadUrl,
      smallName,
      overwriteBytes,
    );
    assertUploadResult(
      overwriteUpload,
      smallName,
      overwriteBytes.byteLength,
      "upload overwrite content",
    );
    const overwrittenSearch = await eventuallyFindFile(smallName, context.childPath);
    if (overwrittenSearch.resource === undefined) {
      throw new Error("overwritten file was not visible by exact path");
    }
    const overwrittenId = resourceId(overwrittenSearch.resource, "overwritten file search result");
    const overwrittenDetail = await getResource(overwrittenId);
    observation.overwrite = {
      reservationStatus: overwriteReservation.response.status,
      uploadStatus: overwriteUpload.status,
      resourceIdPreserved: overwrittenId === smallResourceId,
      size: asNumber(overwrittenDetail.size, "overwritten file.size"),
      modifiedAtPrecision: timestampPrecision(
        asString(overwrittenDetail.modifiedAt, "overwritten file.modifiedAt"),
      ),
    };

    const resumeName = `resume-${context.childName}.txt`;
    const resumeBytes = new TextEncoder().encode("resume");
    const resumeReservation = await reserveUpload(
      resumeName,
      resumeBytes.byteLength,
      context.childId,
      {
        resume: true,
        modifiedTime: new Date().toISOString(),
        isOverwrite: false,
      },
    );
    observation.resume = {
      reservation: recordResponse(resumeReservation.response),
      modifiedTimeSent: true,
      interruptedTransferAttempted: false,
    };
    if (resumeReservation.response.status === 201 && resumeReservation.uploadUrl !== undefined) {
      const offset = resumeReservation.offset ?? 0;
      if (offset < 0 || offset > resumeBytes.byteLength) {
        throw new Error(`resume offset is outside the file size: ${offset}`);
      }
      const resumeUpload = await uploadBytes(
        resumeReservation.uploadUrl,
        resumeName,
        resumeBytes.slice(offset),
        {
          contentRange: `${offset}-${resumeBytes.byteLength - 1}/${resumeBytes.byteLength}`,
        },
      );
      assertUploadResult(resumeUpload, resumeName, resumeBytes.byteLength, "upload resume content");
      observation.resume.offset = offset;
      observation.resume.contentStatus = resumeUpload.status;
      observation.resume.responseHeaderNames = safeHeaderNames(resumeUpload.headers);
    } else if (![400, 422].includes(resumeReservation.response.status)) {
      throw new Error(`unexpected resume reservation status: ${resumeReservation.response.status}`);
    }

    const duplicateFolderName = `duplicate-${context.childName}`;
    const firstDuplicate = await apiRequest("/v1/drive/folders", {
      method: "POST",
      body: { folderName: duplicateFolderName, parentId: context.childId },
    });
    assertStatus(firstDuplicate, 201, "create first duplicate-name folder");
    const secondDuplicate = await apiRequest("/v1/drive/folders", {
      method: "POST",
      body: { folderName: duplicateFolderName, parentId: context.childId },
    });
    assertStatus(secondDuplicate, [201, 400, 409, 422], "create second duplicate-name folder");

    const duplicateFileReservation = await reserveUpload(
      smallName,
      smallBytes.byteLength,
      context.childId,
      {
        isOverwrite: false,
        resume: false,
      },
    );
    assertStatus(
      duplicateFileReservation.response,
      [201, 400, 409, 422],
      "reserve duplicate-name file",
    );
    let duplicateFileUploadStatus: number | undefined;
    if (
      duplicateFileReservation.response.status === 201 &&
      duplicateFileReservation.uploadUrl !== undefined
    ) {
      const duplicateFileUpload = await uploadBytes(
        duplicateFileReservation.uploadUrl,
        smallName,
        smallBytes,
      );
      duplicateFileUploadStatus = duplicateFileUpload.status;
      assertUploadResult(
        duplicateFileUpload,
        smallName,
        smallBytes.byteLength,
        "upload duplicate-name file",
      );
    }

    const typeConflictName = `type-conflict-${context.childName}`;
    const typeFolder = await apiRequest("/v1/drive/folders", {
      method: "POST",
      body: { folderName: typeConflictName, parentId: context.childId },
    });
    assertStatus(typeFolder, 201, "create type-conflict folder");
    const typeConflictReservation = await reserveUpload(typeConflictName, 1, context.childId, {
      isOverwrite: false,
      resume: false,
    });
    assertStatus(
      typeConflictReservation.response,
      [201, 400, 409, 422],
      "reserve file/folder type conflict",
    );
    let typeConflictUploadStatus: number | undefined;
    if (
      typeConflictReservation.response.status === 201 &&
      typeConflictReservation.uploadUrl !== undefined
    ) {
      const typeConflictUpload = await uploadBytes(
        typeConflictReservation.uploadUrl,
        typeConflictName,
        new Uint8Array([1]),
      );
      typeConflictUploadStatus = typeConflictUpload.status;
      assertUploadResult(
        typeConflictUpload,
        typeConflictName,
        1,
        "upload file/folder type conflict",
      );
    }
    observation.duplicates = {
      duplicateFolderStatus: secondDuplicate.status,
      duplicateFileReservationStatus: duplicateFileReservation.response.status,
      duplicateFileUploadStatus: duplicateFileUploadStatus ?? null,
      fileFolderConflictReservationStatus: typeConflictReservation.response.status,
      fileFolderConflictUploadStatus: typeConflictUploadStatus ?? null,
    };

    const noAuthUrl = new URL(
      "/v1/drive/resources",
      process.env.MYBOX_BASE_URL ?? "https://open-api.mybox.naver.com",
    );
    noAuthUrl.searchParams.set("count", "1");
    const noAuthResponse = await fetch(noAuthUrl, {
      signal: AbortSignal.timeout(Number(process.env.MYBOX_TIMEOUT_MS ?? 30_000)),
    });
    const noAuthBody = await noAuthResponse.json().catch(() => null);
    observation.errors.unauthenticated = {
      status: noAuthResponse.status,
      code: isRecord(noAuthBody) && typeof noAuthBody.code === "string" ? noAuthBody.code : null,
    };
    expect(noAuthResponse.status).toBe(401);

    const missingResourceId = "bnZfZHJpdmUwNDN8MjU1Nzg1MzIxMjU0NTJ8RHww";
    const missingResponse = await apiRequest(
      `/v1/drive/resources/${encodeURIComponent(missingResourceId)}`,
    );
    observation.errors.missingResource = recordResponse(missingResponse);
    expect(missingResponse.status).toBe(404);

    const invalidFolderResponse = await apiRequest("/v1/drive/folders", {
      method: "POST",
      body: { parentId: context.childId },
    });
    observation.errors.invalidArguments = recordResponse(invalidFolderResponse);
    assertStatus(invalidFolderResponse, [400, 422], "invalid folder request");

    observation.errors.retryAfter = {
      status429Observed: false,
      status423Observed: false,
      retryAfterObserved: false,
    };
  });
});

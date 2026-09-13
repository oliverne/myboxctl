import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";

import {
  type ApiResponse,
  apiRequest,
  asArray,
  assertStatus,
  exactPathResource,
  isRecord,
  type JsonRecord,
  joinRemotePath,
  listPages,
  readRequest,
  resourceId,
  uploadBytes,
} from "./helpers.ts";

const PREFIX_PATH = "/myboxctl-integration-test/";
const probeEnabled = process.env.MYBOX_RENAME_MOVE_PROBE === "1" && Boolean(process.env.MYBOX_PAT);
const describeProbe = probeEnabled ? describe : describe.skip;
if (probeEnabled) {
  setDefaultTimeout(900_000);
}

let rootPath = "";
let rootId = "";

function asRecord(value: unknown, context: string): JsonRecord {
  if (!isRecord(value)) {
    throw new Error(`Phase 18 probe ${context} is not an object`);
  }
  return value;
}

function summarizeResponse(response: ApiResponse): {
  status: number;
  contentType: string | null;
  bodyKind: string;
  bodyKeys: string[];
  code?: string;
} {
  const body = response.body;
  const record = isRecord(body) ? body : undefined;
  const result: {
    status: number;
    contentType: string | null;
    bodyKind: string;
    bodyKeys: string[];
    code?: string;
  } = {
    status: response.status,
    contentType: response.headers.get("Content-Type"),
    bodyKind:
      body === null || body === undefined ? "empty" : Array.isArray(body) ? "array" : typeof body,
    bodyKeys: record === undefined ? [] : Object.keys(record).sort(),
  };
  const code = record?.code;
  if (typeof code === "string") {
    result.code = code;
  }
  return result;
}

async function lookupFolder(path: string): Promise<JsonRecord | undefined> {
  const result = await listPages("/v1/search/resources/folders", { path, count: "20" });
  return exactPathResource(result.resources, path);
}

async function createFolder(parentId: string, folderName: string): Promise<string> {
  const response = await apiRequest("/v1/drive/folders", {
    method: "POST",
    body: { folderName, parentId },
  });
  assertStatus(response, 201, `Phase 18 create folder ${folderName}`);
  return resourceId(asRecord(response.body, `create folder ${folderName}`), `folder ${folderName}`);
}

async function createFile(parentId: string, fileName: string, content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  const reservation = await apiRequest("/v1/drive/files", {
    method: "POST",
    body: { fileName, fileSize: bytes.byteLength, parentId, isOverwrite: false },
  });
  assertStatus(reservation, 201, `Phase 18 reserve file ${fileName}`);
  const reservationBody = asRecord(reservation.body, `reserve file ${fileName}`);
  const uploadUrl = reservationBody.uploadUrl;
  if (typeof uploadUrl !== "string" || uploadUrl.length === 0) {
    throw new Error(`Phase 18 reservation for ${fileName} did not return an upload URL`);
  }

  const uploaded = await uploadBytes(uploadUrl, fileName, bytes);
  if (uploaded.status < 200 || uploaded.status >= 300) {
    throw new Error(`Phase 18 upload of ${fileName} failed with HTTP ${uploaded.status}`);
  }
  return resourceId(
    asRecord(uploaded.body, `upload file ${fileName}`),
    `uploaded file ${fileName}`,
  );
}

async function children(parentId: string): Promise<JsonRecord[]> {
  const result = await listPages(`/v1/drive/folders/${encodeURIComponent(parentId)}/resources`, {
    count: "1000",
    sort: "name,asc",
  });
  return result.resources.filter((item): item is JsonRecord => isRecord(item));
}

async function searchFilesInFolder(folderPath: string, fileName: string): Promise<JsonRecord[]> {
  const result = await listPages("/v1/search/resources/files", {
    q: fileName,
    parentPath: folderPath,
    count: "20",
  });
  return result.resources.filter((item): item is JsonRecord => isRecord(item));
}

async function detail(resourceIdValue: string): Promise<ApiResponse> {
  return readRequest(`/v1/drive/resources/${encodeURIComponent(resourceIdValue)}`);
}

async function poll<T>(load: () => Promise<T>, until: (value: T) => boolean): Promise<T> {
  let value = await load();
  if (until(value)) {
    return value;
  }
  for (const waitMs of [250, 500, 1_000, 2_000, 4_000]) {
    await Bun.sleep(waitMs);
    value = await load();
    if (until(value)) {
      return value;
    }
  }
  throw new Error("Phase 18 probe poll never observed the expected read-after-write state");
}

function renameResource(id: string, name: string): Promise<ApiResponse> {
  return apiRequest(`/v1/drive/resources/${encodeURIComponent(id)}/rename`, {
    method: "POST",
    body: { name },
  });
}

function moveResource(id: string, parentId: string): Promise<ApiResponse> {
  return apiRequest(`/v1/drive/resources/${encodeURIComponent(id)}/move`, {
    method: "POST",
    body: { parentId },
  });
}

function entrySummary(
  listing: JsonRecord[],
  id: string,
): { present: boolean; name: unknown; type: unknown } {
  const entry = listing.find((item) => item.resourceId === id);
  return {
    present: entry !== undefined,
    name: entry?.name ?? null,
    type: entry?.type ?? null,
  };
}

function detailSummary(response: ApiResponse): {
  status: number;
  name: unknown;
  path: unknown;
  parentPath: unknown;
  type: unknown;
} {
  const body = isRecord(response.body) ? response.body : undefined;
  return {
    status: response.status,
    name: body?.name ?? null,
    path: body?.path ?? null,
    parentPath: body?.parentPath ?? null,
    type: body?.type ?? null,
  };
}

async function deleteForCleanup(path: string, id: string): Promise<void> {
  if (!path.startsWith(PREFIX_PATH)) {
    throw new Error(`refusing to clean a path outside the integration prefix: ${path}`);
  }
  const response = await apiRequest(`/v1/drive/resources/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (response.status !== 204 && response.status !== 404) {
    throw new Error(`Phase 18 cleanup failed with HTTP ${response.status}`);
  }
}

describeProbe("MYBOX rename/move contract probe", () => {
  beforeAll(async () => {
    const prefix = await lookupFolder(PREFIX_PATH);
    if (prefix === undefined) {
      throw new Error(`integration prefix is missing: ${PREFIX_PATH}`);
    }

    const unique = `phase18-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    rootPath = joinRemotePath(PREFIX_PATH, unique);
    rootId = await createFolder(resourceId(prefix, `integration prefix ${PREFIX_PATH}`), unique);
  });

  afterAll(async () => {
    if (rootPath !== "" && rootId !== "") {
      await deleteForCleanup(rootPath, rootId);
    }
  });

  test("observes root identity and search-based root resolution", async () => {
    const rootPage = await readRequest("/v1/drive/resources", {
      query: { count: "1000" },
    });
    assertStatus(rootPage, 200, "Phase 18 root listing");
    const rootResources = asArray(
      asRecord(rootPage.body, "root listing").resources,
      "root listing resources",
    ).filter((item): item is JsonRecord => isRecord(item));
    const parentIds = new Set(
      rootResources
        .map((item) => item.parentId)
        .filter((value): value is string => typeof value === "string" && value.length > 0),
    );

    const searchRoot = await listPages("/v1/search/resources/folders", {
      path: "/",
      count: "20",
    });
    const searchRootRecords = searchRoot.resources.filter((item): item is JsonRecord =>
      isRecord(item),
    );

    console.log(
      JSON.stringify({
        phase18RootObservation: {
          rootListCount: rootResources.length,
          distinctRootParentIdCount: parentIds.size,
          searchRootCount: searchRootRecords.length,
          searchRootPaths: searchRootRecords.map((item) => String(item.path)),
          searchRootTypes: searchRootRecords.map((item) => String(item.type)),
          searchRootResourceIdPresent: searchRootRecords.map(
            (item) => typeof item.resourceId === "string" && item.resourceId.length > 0,
          ),
          searchRootParentIdPresent: searchRootRecords.map(
            (item) => typeof item.parentId === "string" && item.parentId.length > 0,
          ),
          searchRootParentIdMatchesRootChildren: searchRootRecords.map((item) =>
            [...parentIds].every((parentId) => parentId === item.resourceId),
          ),
        },
      }),
    );

    expect(parentIds.size).toBeLessThanOrEqual(1);
  });

  test("observes file rename response, ID retention and read-after-write", async () => {
    const folderName = "rename-file";
    const folderPath = joinRemotePath(rootPath, folderName);
    const folderId = await createFolder(rootId, folderName);
    const fileId = await createFile(folderId, "before.txt", "phase18 rename");

    const response = await renameResource(fileId, "after.txt");
    const summarized = summarizeResponse(response);

    const observed = await poll(
      async () => {
        const [detailResponse, listing] = await Promise.all([detail(fileId), children(folderId)]);
        return { detailResponse, listing };
      },
      ({ detailResponse, listing }) =>
        detailResponse.status === 200 &&
        isRecord(detailResponse.body) &&
        detailResponse.body.name === "after.txt" &&
        listing.some((item) => item.resourceId === fileId && item.name === "after.txt"),
    );

    const newNameSearch = await searchFilesInFolder(folderPath, "after.txt");
    const oldNameSearch = await searchFilesInFolder(folderPath, "before.txt");

    console.log(
      JSON.stringify({
        phase18RenameFile: {
          ...summarized,
          sameIdDetail: detailSummary(observed.detailResponse),
          listingEntry: entrySummary(observed.listing, fileId),
          listingCount: observed.listing.length,
          newNameSearchCount: newNameSearch.length,
          newNameSearchSameId: newNameSearch.every((item) => item.resourceId === fileId),
          oldNameSearchCount: oldNameSearch.length,
        },
      }),
    );

    expect(summarized.status).toBe(200);
    expect(observed.detailResponse.status).toBe(200);
  });

  test("observes rename onto an existing sibling name", async () => {
    const folderName = "rename-conflict";
    const folderId = await createFolder(rootId, folderName);
    const firstId = await createFile(folderId, "a.txt", "phase18 conflict a");
    const secondId = await createFile(folderId, "b.txt", "phase18 conflict b");

    const response = await renameResource(secondId, "a.txt");
    const summarized = summarizeResponse(response);

    const listing = await poll(
      () => children(folderId),
      (value) => value.length <= 2,
    );
    const [firstDetail, secondDetail] = await Promise.all([detail(firstId), detail(secondId)]);

    console.log(
      JSON.stringify({
        phase18RenameConflict: {
          ...summarized,
          listingCount: listing.length,
          listingNames: listing.map((item) => item.name),
          first: { id: firstId === secondId ? "same" : "distinct", ...detailSummary(firstDetail) },
          second: detailSummary(secondDetail),
        },
      }),
    );

    expect(summarized.status).toBe(409);
    expect(summarized.code).toBe("PLAT-409");
  });

  test("observes rename to the identical current name", async () => {
    const folderName = "rename-identical";
    const folderId = await createFolder(rootId, folderName);
    const fileId = await createFile(folderId, "same.txt", "phase18 identical");
    const response = await renameResource(fileId, "same.txt");
    const summarized = summarizeResponse(response);

    const listing = await poll(
      () => children(folderId),
      (value) => value.some((item) => item.resourceId === fileId),
    );

    console.log(
      JSON.stringify({
        phase18RenameIdentical: {
          ...summarized,
          listingEntry: entrySummary(listing, fileId),
          listingCount: listing.length,
          detail: detailSummary(await detail(fileId)),
        },
      }),
    );

    expect(summarized.status).toBe(200);
  });

  test("observes file move across folders and ID retention", async () => {
    const folderName = "move-file";
    const folderPath = joinRemotePath(rootPath, folderName);
    const folderId = await createFolder(rootId, folderName);
    const sourceId = await createFolder(folderId, "src");
    const destinationId = await createFolder(folderId, "dst");
    const fileId = await createFile(sourceId, "mv.txt", "phase18 move");

    const response = await moveResource(fileId, destinationId);
    const summarized = summarizeResponse(response);

    const observed = await poll(
      async () => {
        const [sourceChildren, destinationChildren, detailResponse] = await Promise.all([
          children(sourceId),
          children(destinationId),
          detail(fileId),
        ]);
        return { sourceChildren, destinationChildren, detailResponse };
      },
      ({ sourceChildren, destinationChildren }) =>
        destinationChildren.some((item) => item.resourceId === fileId) &&
        !sourceChildren.some((item) => item.resourceId === fileId),
    );

    const newParentSearch = await searchFilesInFolder(joinRemotePath(folderPath, "dst"), "mv.txt");
    const oldParentSearch = await searchFilesInFolder(joinRemotePath(folderPath, "src"), "mv.txt");

    console.log(
      JSON.stringify({
        phase18MoveFile: {
          ...summarized,
          sameIdDetail: detailSummary(observed.detailResponse),
          destinationEntry: entrySummary(observed.destinationChildren, fileId),
          sourceEntry: entrySummary(observed.sourceChildren, fileId),
          destinationCount: observed.destinationChildren.length,
          sourceCount: observed.sourceChildren.length,
          newParentSearchCount: newParentSearch.length,
          newParentSearchSameId: newParentSearch.every((item) => item.resourceId === fileId),
          oldParentSearchCount: oldParentSearch.length,
        },
      }),
    );

    expect(summarized.status).toBe(200);
  });

  test("observes move to the current parent folder", async () => {
    const folderName = "move-noop";
    const folderId = await createFolder(rootId, folderName);
    const fileId = await createFile(folderId, "s.txt", "phase18 noop");

    const response = await moveResource(fileId, folderId);
    const summarized = summarizeResponse(response);

    const listing = await poll(
      () => children(folderId),
      (value) => value.some((item) => item.resourceId === fileId),
    );

    console.log(
      JSON.stringify({
        phase18MoveSameParent: {
          ...summarized,
          listingEntry: entrySummary(listing, fileId),
          listingCount: listing.length,
          detail: detailSummary(await detail(fileId)),
        },
      }),
    );

    expect(summarized.status).toBe(200);
  });

  test("observes move onto an existing destination name", async () => {
    const folderName = "move-conflict";
    const folderId = await createFolder(rootId, folderName);
    const sourceId = await createFolder(folderId, "src");
    const destinationId = await createFolder(folderId, "dst");
    const movingId = await createFile(sourceId, "x.txt", "phase18 move conflict source");
    const existingId = await createFile(destinationId, "x.txt", "phase18 move conflict existing");

    const response = await moveResource(movingId, destinationId);
    const summarized = summarizeResponse(response);

    const destinationChildren = await poll(
      () => children(destinationId),
      (value) => value.length <= 2,
    );
    const [movingDetail, existingDetail] = await Promise.all([
      detail(movingId),
      detail(existingId),
    ]);

    console.log(
      JSON.stringify({
        phase18MoveConflict: {
          ...summarized,
          destinationCount: destinationChildren.length,
          destinationNames: destinationChildren.map((item) => item.name),
          moving: detailSummary(movingDetail),
          existing: detailSummary(existingDetail),
          sourceEntry: entrySummary(await children(sourceId), movingId),
        },
      }),
    );

    expect(summarized.status).toBe(409);
    expect(summarized.code).toBe("PLAT-409");
  });

  test("observes move of a folder into its own descendant", async () => {
    const folderName = "move-descendant";
    const folderId = await createFolder(rootId, folderName);
    const innerId = await createFolder(folderId, "inner");
    const fileId = await createFile(innerId, "f.txt", "phase18 descendant");

    const response = await moveResource(folderId, innerId);
    const summarized = summarizeResponse(response);

    const [folderChildren, innerChildren, folderDetail] = await Promise.all([
      children(folderId),
      children(innerId),
      detail(folderId),
    ]);

    console.log(
      JSON.stringify({
        phase18MoveDescendant: {
          ...summarized,
          folderChildrenNames: folderChildren.map((item) => item.name),
          innerChildrenNames: innerChildren.map((item) => item.name),
          innerEntry: entrySummary(folderChildren, innerId),
          fileEntry: entrySummary(innerChildren, fileId),
          folderDetail: detailSummary(folderDetail),
        },
      }),
    );

    expect(summarized.status).toBe(400);
    expect(summarized.code).toBe("PLAT-400");
  });

  test("observes folder rename followed by folder move", async () => {
    const folderName = "folder-ops";
    const folderId = await createFolder(rootId, folderName);
    const fileId = await createFile(folderId, "f.txt", "phase18 folder ops");
    const targetId = await createFolder(rootId, "folder-ops-target");

    const renameResponse = await renameResource(folderId, "folder-ops-renamed");
    const renameSummary = summarizeResponse(renameResponse);
    const afterRename = await poll(
      () => detail(folderId),
      (response) => isRecord(response.body) && response.body.name === "folder-ops-renamed",
    );

    const moveResponse = await moveResource(folderId, targetId);
    const moveSummary = summarizeResponse(moveResponse);
    const afterMove = await poll(
      async () => {
        const [targetChildren, rootChildren, folderDetail, fileDetail] = await Promise.all([
          children(targetId),
          children(rootId),
          detail(folderId),
          detail(fileId),
        ]);
        return { targetChildren, rootChildren, folderDetail, fileDetail };
      },
      ({ targetChildren, rootChildren }) =>
        targetChildren.some((item) => item.resourceId === folderId) &&
        !rootChildren.some((item) => item.resourceId === folderId),
    );

    console.log(
      JSON.stringify({
        phase18FolderRenameMove: {
          rename: { ...renameSummary, detail: detailSummary(afterRename) },
          move: { ...moveSummary, detail: detailSummary(afterMove.folderDetail) },
          targetEntry: entrySummary(afterMove.targetChildren, folderId),
          rootEntry: entrySummary(afterMove.rootChildren, folderId),
          childFileDetail: detailSummary(afterMove.fileDetail),
          targetEntryCount: afterMove.targetChildren.length,
        },
      }),
    );

    expect(renameSummary.status).toBe(200);
    expect(moveSummary.status).toBe(200);
  });

  test("observes move with an unknown destination parent", async () => {
    const folderName = "move-unknown";
    const folderId = await createFolder(rootId, folderName);
    const fileId = await createFile(folderId, "u.txt", "phase18 unknown parent");
    const before = await children(folderId);

    const response = await moveResource(fileId, `missing-${crypto.randomUUID()}`);
    const summarized = summarizeResponse(response);
    const after = await children(folderId);

    console.log(
      JSON.stringify({
        phase18MoveUnknownParent: {
          ...summarized,
          beforeCount: before.length,
          afterCount: after.length,
          entryPreserved: entrySummary(after, fileId).present,
          detail: detailSummary(await detail(fileId)),
        },
      }),
    );

    expect(summarized.status).toBe(400);
    expect(summarized.code).toBe("PLAT-400");
  });
});

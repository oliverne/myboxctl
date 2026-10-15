import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFakeHttpServer, type FakeHttpServer, type RecordedRequest } from "../http/server.ts";

const servers: FakeHttpServer[] = [];
const directories: string[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.close();
  }
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

function storageResponse(maxFileBytes = 1_000_000) {
  return {
    fileCounts: {
      archive: 0,
      audio: 0,
      document: 0,
      etc: 0,
      executable: 0,
      image: 0,
      total: 0,
      video: 0,
    },
    maxFileBytes,
    quotaBytes: 10_000_000,
    trashAutoDeleteDays: 30,
    usedBytes: 0,
  };
}

async function runCli(
  args: string[],
  baseUrl: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const subprocess = Bun.spawn(["bun", "run", "src/cli.ts", ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      MYBOX_PAT: "test-pat",
      MYBOX_BASE_URL: baseUrl,
      MYBOX_PLAN: "20TB",
      MYBOX_TIMEOUT_MS: "5000",
      MYBOX_RATE_LIMIT_STATE_PATH: join(
        tmpdir(),
        `myboxctl-cli-keypoint-rate-limit-${crypto.randomUUID()}.json`,
      ),
    },
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

type RemoteState = {
  resources: Map<
    string,
    {
      resourceId: string;
      name: string;
      type: "folder" | "file";
      parentId: string | null;
      path: string;
      size: number;
      modifiedAt: string;
    }
  >;
  byId: Map<string, string>;
  nextId: number;
  folderPosts: number;
  failFirstFolderPost: boolean;
  lastReservation?:
    | { fileName: string; fileSize: number; parentId?: string; modifiedTime?: string }
    | undefined;
};

function createRemoteState(): RemoteState {
  return {
    resources: new Map(),
    byId: new Map(),
    nextId: 1,
    folderPosts: 0,
    failFirstFolderPost: false,
  };
}

function resourceItem(resource: {
  resourceId: string;
  name: string;
  type: "folder" | "file";
  size: number;
  modifiedAt: string;
  path?: string;
  parentId?: string | null;
}) {
  const parentPath =
    resource.path === undefined || resource.path === "/"
      ? "/"
      : resource.path.slice(0, resource.path.lastIndexOf("/")) || "/";
  return {
    resourceId: resource.resourceId,
    parentId: resource.parentId ?? "parent-1",
    name: resource.name,
    type: resource.type,
    size: resource.size,
    createdAt: "2026-10-15T00:00:00Z",
    modifiedAt: resource.modifiedAt,
    accessedAt: "2026-10-15T00:00:00Z",
    isFavorite: false,
    isHidden: false,
    lastModifiedBy: "tester",
    ...(resource.path === undefined ? {} : { path: resource.path, parentPath }),
  };
}

function createRecursiveHandler(state: RemoteState, server: () => FakeHttpServer) {
  return (request: RecordedRequest) => {
    if (request.path === "/v1/drive/storage") {
      return { body: storageResponse() };
    }
    if (request.path === "/v1/search/resources/folders") {
      const path = request.query.get("path") ?? "";
      const folder = state.resources.get(path);
      return {
        body: {
          resources: folder?.type === "folder" ? [resourceItem(folder)] : [],
          responseMetaData: {},
        },
      };
    }
    if (request.path === "/v1/search/resources/files") {
      const name = request.query.get("q") ?? "";
      const file = [...state.resources.values()].find(
        (resource) => resource.type === "file" && resource.name === name,
      );
      return {
        body: { resources: file ? [resourceItem(file)] : [], responseMetaData: {} },
      };
    }
    if (request.path === "/v1/drive/folders" && request.method === "POST") {
      state.folderPosts += 1;
      if (state.failFirstFolderPost && state.folderPosts === 1) {
        return { status: 500, body: { code: "SERVER", message: "injected folder failure" } };
      }
      const body = JSON.parse(request.bodyText) as { folderName: string; parentId?: string };
      const parentPath = body.parentId === undefined ? "/" : (state.byId.get(body.parentId) ?? "/");
      const path = parentPath === "/" ? `/${body.folderName}` : `${parentPath}/${body.folderName}`;
      const resource = {
        resourceId: `folder-${state.nextId++}`,
        name: body.folderName,
        type: "folder" as const,
        parentId: body.parentId ?? null,
        path,
        size: 0,
        modifiedAt: "2026-10-15T00:00:00.000Z",
      };
      state.resources.set(path, resource);
      state.byId.set(resource.resourceId, path);
      return { status: 201, body: { name: resource.name, resourceId: resource.resourceId } };
    }
    if (request.path === "/v1/drive/files" && request.method === "POST") {
      const body = JSON.parse(request.bodyText) as {
        fileName: string;
        fileSize: number;
        parentId?: string;
        modifiedTime?: string;
      };
      state.lastReservation = body;
      return { status: 201, body: { uploadUrl: `${server().baseUrl}/storage/upload`, offset: 0 } };
    }
    if (request.path === "/storage/upload") {
      const reservation = state.lastReservation;
      if (reservation === undefined) {
        return { status: 500, body: { code: "UNEXPECTED", message: "missing reservation" } };
      }
      const parentPath =
        reservation.parentId === undefined ? "/" : (state.byId.get(reservation.parentId) ?? "/");
      const path =
        parentPath === "/" ? `/${reservation.fileName}` : `${parentPath}/${reservation.fileName}`;
      const resource = {
        resourceId: `file-${state.nextId++}`,
        name: reservation.fileName,
        type: "file" as const,
        parentId: reservation.parentId ?? null,
        path,
        size: reservation.fileSize,
        modifiedAt: reservation.modifiedTime ?? "2026-10-15T00:00:00.000Z",
      };
      state.resources.set(path, resource);
      state.byId.set(resource.resourceId, path);
      return {
        body: {
          resourceId: resource.resourceId,
          name: resource.name,
          fileSize: resource.size,
        },
      };
    }
    if (request.path.startsWith("/v1/drive/resources/")) {
      const resourceId = decodeURIComponent(request.path.slice("/v1/drive/resources/".length));
      const path = state.byId.get(resourceId);
      const resource = path === undefined ? undefined : state.resources.get(path);
      if (resource === undefined) {
        return { status: 404, body: { code: "NOT_FOUND", message: "missing" } };
      }
      return { body: resourceItem(resource) };
    }
    if (request.path.startsWith("/v1/drive/folders/") && request.path.endsWith("/resources")) {
      const folderId = decodeURIComponent(
        request.path.slice("/v1/drive/folders/".length, -"/resources".length),
      );
      const children = [...state.resources.values()].filter(
        (resource) => resource.parentId === folderId,
      );
      return {
        body: {
          resources: children.map((child) => resourceItem(child)),
          responseMetaData: {},
          fileCount: children.filter((child) => child.type === "file").length,
          subFolderCount: children.filter((child) => child.type === "folder").length,
        },
      };
    }
    return { status: 500, body: { code: "UNEXPECTED", message: "unexpected request" } };
  };
}

async function recursiveFixture(): Promise<{
  directory: string;
  local: string;
  checkpoint: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), "myboxctl-upload-checkpoint-cli-"));
  directories.push(directory);
  const local = join(directory, "payload");
  await mkdir(local);
  await writeFile(join(local, "a.txt"), "a");
  return { directory, local, checkpoint: join(directory, "payload.upload.json") };
}

describe("upload checkpoint CLI contract", () => {
  test("rejects checkpoint options outside a recursive directory upload", async () => {
    const { local, checkpoint } = await recursiveFixture();
    const server = await createFakeHttpServer();
    servers.push(server);

    const fileResult = await runCli(
      ["upload", join(local, "a.txt"), "/", "--checkpoint", checkpoint, "--json"],
      server.baseUrl,
    );
    expect(fileResult.exitCode).toBe(2);
    expect(JSON.parse(fileResult.stdout)).toMatchObject({
      ok: false,
      error: { kind: "invalid-arguments" },
    });

    const combined = await runCli(
      [
        "upload",
        local,
        "/",
        "--recursive",
        "--checkpoint",
        checkpoint,
        "--resume",
        checkpoint,
        "--json",
      ],
      server.baseUrl,
    );
    expect(combined.exitCode).toBe(2);
    expect(server.requests).toHaveLength(0);
  });

  test("uploads a checkpointed tree and removes the checkpoint on success", async () => {
    const { local, checkpoint } = await recursiveFixture();
    const state = createRemoteState();
    let server: FakeHttpServer | undefined;
    server = await createFakeHttpServer({
      handler: createRecursiveHandler(state, () => server as FakeHttpServer),
    });
    servers.push(server);

    const result = await runCli(
      ["upload", local, "/", "--recursive", "--checkpoint", checkpoint, "--json"],
      server.baseUrl,
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      command: "upload",
      action: "uploaded",
      data: {
        type: "folder",
        remotePath: "/payload",
        filesUploaded: 1,
        foldersCreated: 1,
        filesSkipped: 0,
        resumed: false,
      },
    });
    await expect(stat(checkpoint)).rejects.toMatchObject({ code: "ENOENT" });
  }, 20_000);

  test("keeps the checkpoint on failure and resumes it to completion", async () => {
    const { local, checkpoint } = await recursiveFixture();
    const state = createRemoteState();
    state.failFirstFolderPost = true;
    let server: FakeHttpServer | undefined;
    server = await createFakeHttpServer({
      handler: createRecursiveHandler(state, () => server as FakeHttpServer),
    });
    servers.push(server);

    const failed = await runCli(
      ["upload", local, "/", "--recursive", "--checkpoint", checkpoint, "--json"],
      server.baseUrl,
    );
    expect(failed.exitCode).toBe(6);
    expect(failed.stderr).toBe("");
    const failure = JSON.parse(failed.stdout);
    expect(failure).toMatchObject({
      ok: false,
      error: { kind: "api-unavailable", code: "FOLDER_CREATION_UNCERTAIN" },
      resumeCheckpointPath: checkpoint,
    });
    const saved = JSON.parse(await readFile(checkpoint, "utf8"));
    expect(saved).toMatchObject({
      state: "in-progress",
      inFlight: { kind: "folder", relativePath: "" },
    });

    const resumed = await runCli(
      ["upload", local, "/", "--recursive", "--resume", checkpoint, "--json"],
      server.baseUrl,
    );

    expect(resumed.exitCode).toBe(0);
    expect(JSON.parse(resumed.stdout)).toMatchObject({
      ok: true,
      data: { filesUploaded: 1, foldersCreated: 1, resumed: true, checkpointPath: checkpoint },
    });
    await expect(stat(checkpoint)).rejects.toMatchObject({ code: "ENOENT" });
  }, 30_000);
});

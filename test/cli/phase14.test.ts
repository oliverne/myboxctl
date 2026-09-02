import { describe, expect, mock, test } from "bun:test";

import { createProgram } from "../../src/cli.ts";
import { DomainError } from "../../src/errors.ts";
import { runInfo } from "../../src/features/info.ts";
import { runList } from "../../src/features/list.ts";
import { runMkdir } from "../../src/features/mkdir.ts";
import { publicResource } from "../../src/features/public-resource.ts";
import type { EventPresentationOptions } from "../../src/human-ui.ts";
import type { ResourceItem, SearchResourceItem } from "../../src/mybox/contract.ts";
import { failure, success } from "../../src/output.ts";
import { parseRemoteDestination } from "../../src/remote/destination.ts";

function runtimeStub() {
  return {
    config: { timeoutMs: 1_000 },
    client: {},
    resolver: {
      resolveCanonical: async () => ({
        kind: "root",
        path: {
          kind: "root",
          normalized: "/",
          components: [],
          parentPath: undefined,
          basename: undefined,
        },
        resource: null,
      }),
      listChildren: async () => [],
    },
    uploader: {},
    downloader: {},
    events: { sink: { emit() {} }, finish() {}, writeHumanFailure() {} },
  } as never;
}

describe("Phase 14 CLI contract", () => {
  test("exposes canonical commands and only the ls shorthand alias", () => {
    const help = createProgram().helpInformation();

    expect(help).toContain("list|ls");
    expect(help).toContain("info");
    expect(help).toContain("mkdir");
    expect(help).toContain("upload");
    expect(help).toContain("download");
    expect(help).toContain("delete");
    expect(help).not.toMatch(/\n\s+stat\b/);
    expect(help).not.toMatch(/\n\s+ensure-dir\b/);
    expect(help).not.toMatch(/\n\s+put\b/);
  });

  test("preserves trailing slash directory intent separately from remote identity", () => {
    expect(parseRemoteDestination("/store")).toMatchObject({
      path: { normalized: "/store" },
      directoryIntent: false,
    });
    expect(parseRemoteDestination("/store/")).toMatchObject({
      path: { normalized: "/store" },
      directoryIntent: true,
    });
    expect(parseRemoteDestination("/")).toMatchObject({
      path: { normalized: "/" },
      directoryIntent: true,
    });
  });

  test("versions success and failure machine envelopes with explicit nullable fields", () => {
    expect(success("info", "found", {})).toMatchObject({ schemaVersion: 1, ok: true });
    expect(failure("info", new DomainError("not-found", "missing"))).toEqual({
      schemaVersion: 1,
      ok: false,
      command: "info",
      error: {
        kind: "not-found",
        message: "missing",
        retryable: false,
        code: null,
        requestId: null,
        retryAfterMs: null,
      },
    });
  });

  test("info turns a missing resource into a not-found failure", async () => {
    const resolver = {
      resolveCanonical: async () => ({
        kind: "absent",
        path: {
          kind: "child",
          normalized: "/missing",
          components: ["missing"],
          parentPath: "/",
          basename: "missing",
        },
        resource: null,
      }),
    } as never;

    await expect(runInfo("/missing", resolver)).rejects.toMatchObject({ kind: "not-found" });
  });

  test("list renders a file target as one row and mkdir creates one level", async () => {
    const file = {
      resourceId: "file-1",
      name: "report.txt",
      type: "file",
      size: 3,
      modifiedAt: "2026-09-01T00:00:00+09:00",
    };
    let created: unknown;
    const resolver = {
      resolveCanonical: async () => ({
        kind: "found",
        path: {
          ...file,
          kind: "child",
          normalized: "/report.txt",
          components: ["report.txt"],
          parentPath: "/",
          basename: "report.txt",
        },
        resource: file,
      }),
      detail: async () => ({
        ...file,
        parentId: "root",
        createdAt: file.modifiedAt,
        accessedAt: file.modifiedAt,
        isFavorite: false,
        isHidden: false,
        lastModifiedBy: "test",
      }),
      listChildren: async () => [],
      resolveForMutation: async () => ({
        kind: "absent",
        path: {
          kind: "child",
          normalized: "/new",
          components: ["new"],
          parentPath: "/",
          basename: "new",
        },
        resource: null,
      }),
      createFolder: async (input: unknown) => {
        created = input;
        return { resourceId: "folder-1", name: "new" };
      },
    } as never;

    const listed = await runList("/report.txt", resolver);
    expect(listed.data.resources).toEqual([
      {
        resourceId: "file-1",
        path: "/report.txt",
        name: "report.txt",
        type: "file",
        sizeBytes: 3,
        modifiedAt: "2026-08-31T15:00:00.000Z",
      },
    ]);
    const made = await runMkdir("/new", {}, resolver);
    expect(made).toMatchObject({
      action: "created",
      data: { path: "/new", resourceId: "folder-1" },
    });
    expect(created).toEqual({ folderName: "new" });
  });

  test("mkdir reconciles a retryable create response loss without repeating the mutation", async () => {
    const path = {
      kind: "child" as const,
      normalized: "/new",
      components: ["new"],
      parentPath: "/",
      basename: "new",
    };
    let createCalls = 0;
    const resolveForMutation = mock()
      .mockResolvedValueOnce({ kind: "absent", path, resource: null })
      .mockResolvedValueOnce({
        kind: "found",
        path,
        resource: {
          resourceId: "folder-1",
          name: "new",
          type: "folder",
          path: "/new",
          parentPath: "/",
        },
      });
    const resolver = {
      resolveForMutation,
      createFolder: async () => {
        createCalls += 1;
        throw new DomainError("api-unavailable", "response lost", { retryable: true });
      },
    } as never;

    await expect(runMkdir("/new", {}, resolver)).resolves.toMatchObject({
      action: "created",
      data: { path: "/new", resourceId: "folder-1", createdPaths: ["/new"] },
    });
    expect(createCalls).toBe(1);
    expect(resolveForMutation).toHaveBeenLastCalledWith(path, { poll: true });
  });

  test("accepts presentation options before and after the subcommand", async () => {
    const seen: Array<Record<string, unknown> | undefined> = [];
    const factory = async (presentation?: EventPresentationOptions) => {
      seen.push(presentation);
      return runtimeStub();
    };

    await createProgram(factory).parseAsync(["node", "myboxctl", "--json", "list"]);
    await createProgram(factory).parseAsync(["node", "myboxctl", "list", "--json"]);

    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatchObject({ command: "list", json: true });
    expect(seen[1]).toMatchObject({ command: "list", json: true });
  });
});

describe("public resource contract hardening", () => {
  function item(overrides: Partial<ResourceItem> = {}): ResourceItem {
    return {
      resourceId: "r-1",
      parentId: "p-1",
      name: "name.txt",
      type: "file",
      size: 0,
      createdAt: "2026-01-01T00:00:00Z",
      modifiedAt: "2026-01-01T00:00:00Z",
      accessedAt: "2026-01-01T00:00:00Z",
      isFavorite: false,
      isHidden: false,
      lastModifiedBy: "tester",
      ...overrides,
    };
  }

  function expectApiResponseInvalid(action: () => unknown): void {
    let error: unknown;
    try {
      action();
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(DomainError);
    const domainError = error as DomainError;
    expect(domainError.kind).toBe("api-unavailable");
    expect(domainError.code).toBe("API_RESPONSE_INVALID");
  }

  test("rejects an unknown resource type", () => {
    expectApiResponseInvalid(() => publicResource(item({ type: "symlink" }), "/name.txt"));
  });

  test("rejects a missing resource type that reaches public conversion", () => {
    expectApiResponseInvalid(() =>
      publicResource({ resourceId: "r-1", name: "name.txt" } as SearchResourceItem, "/name.txt"),
    );
  });

  test("rejects an invalid modifiedAt value", () => {
    expectApiResponseInvalid(() =>
      publicResource(item({ modifiedAt: "not-a-real-date" }), "/name.txt"),
    );
  });

  test("rejects ambiguous or timezone-less modifiedAt values", () => {
    for (const modifiedAt of ["0", "01/02/2026", "2026-09-01", "2026-01-01T00:00:00"]) {
      expectApiResponseInvalid(() => publicResource(item({ modifiedAt }), "/name.txt"));
    }
  });

  test("accepts RFC 3339 modifiedAt values with UTC or an explicit offset", () => {
    expect(
      publicResource(item({ modifiedAt: "2026-01-01T00:00:00Z" }), "/name.txt").modifiedAt,
    ).toBe("2026-01-01T00:00:00.000Z");
    expect(
      publicResource(item({ modifiedAt: "2026-01-01T09:00:00+09:00" }), "/name.txt").modifiedAt,
    ).toBe("2026-01-01T00:00:00.000Z");
  });

  test("treats an absent modifiedAt as null without guessing a type", () => {
    const resource = publicResource(
      { resourceId: "r-1", name: "name.txt", type: "file" } as SearchResourceItem,
      "/name.txt",
    );
    expect(resource.type).toBe("file");
    expect(resource.modifiedAt).toBeNull();
    expect(resource.sizeBytes).toBeNull();
  });
});

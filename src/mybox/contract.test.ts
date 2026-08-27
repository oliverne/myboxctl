import { describe, expect, test } from "bun:test";

import {
  createUploadResponseSchema,
  downloadUrlResponseSchema,
  resourceItemSchema,
  searchResourceListResponseSchema,
  storageResponseSchema,
} from "./contract.ts";

describe("MYBOX response schemas", () => {
  test("accepts documented resource fields and preserves unknown fields", () => {
    const resource = {
      resourceId: "resource-1",
      parentId: "parent-1",
      name: "report.md",
      type: "file",
      size: 12,
      createdAt: "2026-08-22T10:00:00Z",
      modifiedAt: "2026-08-22T10:00:00Z",
      accessedAt: "2026-08-22T10:00:00Z",
      isFavorite: false,
      isHidden: false,
      lastModifiedBy: "tester",
      serverField: "kept",
    };

    const result = resourceItemSchema.safeParse(resource);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.serverField).toBe("kept");
    }
  });

  test("distinguishes search resources from the full root resource contract", () => {
    const result = searchResourceListResponseSchema.safeParse({
      resources: [{ resourceId: "resource-1", name: "report.md" }],
      responseMetaData: { nextCursor: "" },
    });
    expect(result.success).toBe(true);
    expect(
      resourceItemSchema.safeParse({ resourceId: "resource-1", name: "report.md", type: "file" })
        .success,
    ).toBe(false);
  });

  test("normalizes omitted optional search envelope fields", () => {
    expect(searchResourceListResponseSchema.parse({})).toEqual({
      resources: [],
      responseMetaData: {},
    });
  });

  test("accepts the official storage response and rejects non-integer limits", () => {
    const response = {
      fileCounts: {
        archive: 1,
        audio: 2,
        document: 3,
        etc: 4,
        executable: 5,
        image: 6,
        total: 28,
        video: 7,
      },
      maxFileBytes: 10_000,
      quotaBytes: 100_000,
      trashAutoDeleteDays: 30,
      usedBytes: 20_000,
    };

    expect(storageResponseSchema.safeParse(response).success).toBe(true);
    expect(storageResponseSchema.safeParse({ ...response, maxFileBytes: 1.5 }).success).toBe(false);
    expect(storageResponseSchema.safeParse({ ...response, fileCounts: {} }).success).toBe(false);
  });

  test("rejects malformed reservation responses", () => {
    expect(
      createUploadResponseSchema.safeParse({ uploadUrl: "not-a-url", offset: -1 }).success,
    ).toBe(false);
    expect(createUploadResponseSchema.safeParse({ uploadUrl: "https://upload.test" }).success).toBe(
      true,
    );
  });

  test("accepts a bounded one-time download URL response", () => {
    expect(
      downloadUrlResponseSchema.parse({
        downloadUrl: "https://storage.example.test/file?token=secret",
        expiresIn: 600,
      }),
    ).toMatchObject({ expiresIn: 600 });
    expect(
      downloadUrlResponseSchema.safeParse({ downloadUrl: "not-a-url", expiresIn: 601 }).success,
    ).toBe(false);
  });
});

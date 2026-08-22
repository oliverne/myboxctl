import { describe, expect, test } from "bun:test";

import {
  createUploadResponseSchema,
  resourceItemSchema,
  searchResourceListResponseSchema,
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
      resources: [{ resourceId: "resource-1", name: "report.md", type: "file" }],
      responseMetaData: { nextCursor: "" },
    });
    expect(result.success).toBe(true);
    expect(
      resourceItemSchema.safeParse({ resourceId: "resource-1", name: "report.md", type: "file" })
        .success,
    ).toBe(false);
  });

  test("rejects malformed reservation responses", () => {
    expect(
      createUploadResponseSchema.safeParse({ uploadUrl: "not-a-url", offset: -1 }).success,
    ).toBe(false);
    expect(createUploadResponseSchema.safeParse({ uploadUrl: "https://upload.test" }).success).toBe(
      true,
    );
  });
});

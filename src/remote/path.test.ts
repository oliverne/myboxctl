import { describe, expect, test } from "bun:test";

import { basename, components, normalizeRemotePath, parentPath, parseRemotePath } from "./path.ts";

describe("remote paths", () => {
  test.each([
    ["/", "/"],
    ["/foo", "/foo"],
    ["/foo/bar.txt", "/foo/bar.txt"],
    ["/foo//bar/", "/foo/bar"],
    ["/한글 폴더/# % +", "/한글 폴더/# % +"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeRemotePath(input)).toBe(expected);
  });

  test("exposes root and child path information with a root distinction", () => {
    const root = parseRemotePath("//");
    expect(root.kind).toBe("root");
    expect(root.normalized).toBe("/");
    expect(root.parentPath).toBeUndefined();
    expect(root.basename).toBeUndefined();
    expect(root.components).toEqual([]);

    const child = parseRemotePath("/foo//bar.txt/");
    expect(child.kind).toBe("child");
    expect(child.normalized).toBe("/foo/bar.txt");
    expect(child.parentPath).toBe("/foo");
    expect(child.basename).toBe("bar.txt");
    expect(child.components).toEqual(["foo", "bar.txt"]);
  });

  test("provides pure parent, basename, and component helpers", () => {
    expect(parentPath("/foo/bar")).toBe("/foo");
    expect(parentPath("/")).toBeUndefined();
    expect(basename("/foo/bar")).toBe("bar");
    expect(basename("/")).toBeUndefined();
    expect(components("/foo//bar/")).toEqual(["foo", "bar"]);
  });

  test.each(["", "foo", "../foo", "/foo/../bar", "\\foo", "/foo\\bar"])(
    "rejects structurally invalid path %j",
    (input) => {
      try {
        parseRemotePath(input);
        throw new Error("expected path parsing to fail");
      } catch (error) {
        expect(error).toMatchObject({ kind: "invalid-remote-path" });
      }
    },
  );

  test.each([...Array.from({ length: 32 }, (_, codePoint) => codePoint), 0x7f])(
    "rejects U+%s in a path component",
    (codePoint) => {
      const control = String.fromCodePoint(codePoint);
      expect(() => parseRemotePath(`/safe/before${control}after`)).toThrow(
        expect.objectContaining({ kind: "invalid-remote-path" }),
      );
    },
  );
});

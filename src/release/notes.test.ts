import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  countReleaseNoteBullets,
  ReleaseNoteError,
  readReleaseNote,
  releaseNoteFileName,
  releaseNoteRelativePath,
  releaseNoteVersion,
  validateReleaseNote,
} from "./notes.ts";

function note(bullets: number): string {
  return Array.from({ length: bullets }, (_, index) => `- change ${index + 1}`).join("\n");
}

describe("release note paths", () => {
  test("derives path and version from a stable tag", () => {
    expect(releaseNoteFileName("v0.4.0")).toBe("v0.4.0.md");
    expect(releaseNoteRelativePath("v0.4.0")).toBe("docs/releases/v0.4.0.md");
    expect(releaseNoteVersion("v0.4.0")).toBe("0.4.0");
  });

  test("rejects tags that are not stable vX.Y.Z", () => {
    for (const tag of [
      "0.4.0",
      "v0.4",
      "v0.4.0.1",
      "v0.4.0-rc.1",
      "v0.4.0+build.1",
      "v01.4.0",
      "v0.04.0",
      "v0.4.00",
      "v0.4.0/../x",
      "v0.4.0 ",
      "",
    ]) {
      expect(() => releaseNoteFileName(tag)).toThrow(ReleaseNoteError);
    }
  });
});

describe("release note body", () => {
  test("counts -, *, and + bullets but not headings or prose", () => {
    const body = "# v0.4.0\n\n- one\n* two\n+ three\n\nplain paragraph\n";
    expect(countReleaseNoteBullets(body)).toBe(3);
  });

  test("accepts 3 to 6 bullets and trims trailing whitespace", () => {
    expect(validateReleaseNote("v0.4.0", note(3))).toBe(note(3));
    expect(validateReleaseNote("v0.4.0", note(6))).toBe(note(6));
    expect(validateReleaseNote("v0.4.0", `${note(3)}\n\n`)).toBe(note(3));
    expect(validateReleaseNote("v0.4.0", note(3).replace(/\n/gu, "\r\n"))).toBe(note(3));
  });

  test("rejects empty bodies and bullet counts outside the contract", () => {
    expect(() => validateReleaseNote("v0.4.0", "")).toThrow(ReleaseNoteError);
    expect(() => validateReleaseNote("v0.4.0", "   \n\n")).toThrow(ReleaseNoteError);
    expect(() => validateReleaseNote("v0.4.0", note(2))).toThrow("must contain 3-6 bullets");
    expect(() => validateReleaseNote("v0.4.0", note(7))).toThrow("must contain 3-6 bullets");
  });
});

describe("readReleaseNote", () => {
  test("reads and validates the note for the requested tag", async () => {
    const directory = await mkdtemp(join(tmpdir(), "myboxctl-release-note-"));
    try {
      await mkdir(join(directory, "docs", "releases"), { recursive: true });
      await writeFile(join(directory, "docs", "releases", "v0.4.0.md"), `${note(4)}\n`, "utf8");

      const result = await readReleaseNote("v0.4.0", { root: directory });
      expect(result.body).toBe(note(4));
      expect(result.path).toBe(join(directory, "docs/releases/v0.4.0.md"));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("reports a missing note with its relative path", async () => {
    const directory = await mkdtemp(join(tmpdir(), "myboxctl-release-note-"));
    try {
      await expect(readReleaseNote("v0.4.0", { root: directory })).rejects.toThrow(
        "Missing release note: docs/releases/v0.4.0.md",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("does not accept a note written for another version", async () => {
    const directory = await mkdtemp(join(tmpdir(), "myboxctl-release-note-"));
    try {
      await mkdir(join(directory, "docs", "releases"), { recursive: true });
      await writeFile(join(directory, "docs", "releases", "v0.4.1.md"), `${note(3)}\n`, "utf8");
      await expect(readReleaseNote("v0.4.0", { root: directory })).rejects.toThrow(
        "Missing release note",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

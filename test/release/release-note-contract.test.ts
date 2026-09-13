import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";

import {
  RELEASE_NOTES_DIR,
  readReleaseNote,
  releaseNoteRelativePath,
} from "../../src/release/notes.ts";

const NON_NOTE_FILES = new Set(["README.md"]);

describe("repository release notes", () => {
  test("every markdown file in docs/releases is a valid vX.Y.Z note", async () => {
    const entries = await readdir(RELEASE_NOTES_DIR, { withFileTypes: true });
    const files = entries
      .filter(
        (entry) => entry.isFile() && entry.name.endsWith(".md") && !NON_NOTE_FILES.has(entry.name),
      )
      .map((entry) => entry.name)
      .sort();

    for (const name of files) {
      const tag = name.slice(0, -".md".length);
      // Throws ReleaseNoteError when the file name is not a stable vX.Y.Z tag.
      expect(releaseNoteRelativePath(tag)).toBe(`${RELEASE_NOTES_DIR}/${name}`);

      const { body } = await readReleaseNote(tag, { root: "." });
      expect(body.length).toBeGreaterThan(0);
    }
  });
});

import { readFile as defaultReadFile } from "node:fs/promises";
import { resolve } from "node:path";

export const RELEASE_NOTES_DIR = "docs/releases";
export const MIN_RELEASE_NOTE_BULLETS = 3;
export const MAX_RELEASE_NOTE_BULLETS = 6;

const STABLE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const BULLET_LINE = /^\s*[-*+]\s+\S/u;

type ReadFile = typeof defaultReadFile;

export type ReadReleaseNoteOptions = {
  root?: string;
  readFile?: ReadFile;
};

export class ReleaseNoteError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ReleaseNoteError";
  }
}

/**
 * Stable release tag only. Prerelease and build metadata are intentionally rejected until a release
 * actually needs them, so `docs/releases/` never contains a name the GitHub Release job cannot use.
 */
export function releaseNoteFileName(tag: string): string {
  if (!STABLE_TAG.test(tag)) {
    throw new ReleaseNoteError(`Invalid release tag: ${tag} (expected vX.Y.Z)`);
  }
  return `${tag}.md`;
}

export function releaseNoteRelativePath(tag: string): string {
  return `${RELEASE_NOTES_DIR}/${releaseNoteFileName(tag)}`;
}

export function releaseNoteVersion(tag: string): string {
  if (!STABLE_TAG.test(tag)) {
    throw new ReleaseNoteError(`Invalid release tag: ${tag} (expected vX.Y.Z)`);
  }
  return tag.slice(1);
}

export function countReleaseNoteBullets(body: string): number {
  let count = 0;
  for (const line of body.split(/\r?\n/u)) {
    if (BULLET_LINE.test(line)) {
      count += 1;
    }
  }
  return count;
}

export function validateReleaseNote(tag: string, body: string): string {
  const fileName = releaseNoteFileName(tag);
  const normalized = body.replace(/\r\n/gu, "\n").replace(/\s+$/u, "");

  if (normalized.length === 0) {
    throw new ReleaseNoteError(`${fileName} is empty`);
  }

  const bullets = countReleaseNoteBullets(normalized);
  if (bullets < MIN_RELEASE_NOTE_BULLETS || bullets > MAX_RELEASE_NOTE_BULLETS) {
    throw new ReleaseNoteError(
      `${fileName} must contain ${MIN_RELEASE_NOTE_BULLETS}-${MAX_RELEASE_NOTE_BULLETS} bullets, found ${bullets}`,
    );
  }

  return normalized;
}

/**
 * Resolves the note path from the tag, so a note written for another version cannot satisfy the tag
 * being published. Missing files and invalid bodies throw `ReleaseNoteError`.
 */
export async function readReleaseNote(
  tag: string,
  options: ReadReleaseNoteOptions = {},
): Promise<{ path: string; body: string }> {
  const relative = releaseNoteRelativePath(tag);
  const path = resolve(options.root ?? ".", relative);
  const readFile = options.readFile ?? defaultReadFile;

  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ReleaseNoteError(`Missing release note: ${relative}`, { cause });
    }
    throw cause;
  }

  return { path, body: validateReleaseNote(tag, raw) };
}

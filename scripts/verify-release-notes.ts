import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { ReleaseNoteError, readReleaseNote } from "../src/release/notes.ts";

const USAGE = "Usage: bun run scripts/verify-release-notes.ts --tag vX.Y.Z [--root .] [--out path]";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

const tag = option("--tag");
if (tag === undefined) {
  process.stderr.write(`${USAGE}\n`);
  process.exit(1);
}

try {
  const { body } = await readReleaseNote(tag, { root: option("--root") ?? "." });
  const out = option("--out");

  if (out === undefined) {
    process.stdout.write(`${body}\n`);
  } else {
    const path = resolve(out);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${body}\n`, "utf8");
    process.stdout.write(`Wrote release note for ${tag} to ${path}\n`);
  }
} catch (error) {
  const message = error instanceof ReleaseNoteError ? error.message : String(error);
  process.stderr.write(`Release note verification failed: ${message}\n`);
  process.exit(1);
}

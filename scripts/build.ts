import { chmod, mkdir } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import { validateReleaseVersion } from "./release-config.ts";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

const version = validateReleaseVersion(option("--version") ?? "0.0.0");
const outfile = resolve(option("--outfile") ?? "dist/cli.js");

await mkdir(dirname(outfile), { recursive: true });
const result = await Bun.build({
  entrypoints: [resolve("src/cli.ts")],
  target: "bun",
  outdir: dirname(outfile),
  naming: basename(outfile),
  define: {
    MYBOXCTL_VERSION: JSON.stringify(version),
  },
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

if (process.platform !== "win32") {
  await chmod(outfile, 0o755);
}

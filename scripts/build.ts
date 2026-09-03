import { chmod, mkdir } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

function validateReleaseVersion(value: string): string {
  if (!SEMVER.test(value)) {
    throw new Error(`Invalid release version: ${value}`);
  }
  return value;
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

const version = validateReleaseVersion(option("--version") ?? "0.0.0");
const outfile = resolve(option("--outfile") ?? "dist/cli.js");

await mkdir(dirname(outfile), { recursive: true });
const result = await Bun.build({
  entrypoints: [resolve("src/cli.ts")],
  target: "node",
  format: "esm",
  banner: [
    `import { createRequire as __createRequire } from "module";`,
    `const __require = __createRequire(import.meta.url);`,
  ].join("\n"),
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

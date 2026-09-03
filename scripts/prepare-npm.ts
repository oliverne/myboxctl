import { chmod, copyFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

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
const distPath = resolve(option("--dist") ?? "dist/cli.js");
const outDir = resolve(option("--outdir") ?? join("release", "npm"));
const binDir = join(outDir, "bin");
const distOutDir = join(outDir, "dist");

const LAUNCHER = `#!/usr/bin/env node
import { runCli } from "../dist/cli.js";

const code = await runCli();
process.exit(code ?? 0);
`;

const PACKAGE = {
  name: "@oliverne/myboxctl",
  version,
  description: "Agent-friendly CLI for NAVER MYBOX file operations",
  type: "module",
  bin: { myboxctl: "bin/myboxctl.js" },
  engines: { node: ">=20" },
  files: ["bin", "dist", "LICENSE"],
  license: "MIT",
  repository: { type: "git", url: "git+https://github.com/oliverne/myboxctl.git" },
};

await mkdir(binDir, { recursive: true });
await mkdir(distOutDir, { recursive: true });
await copyFile(distPath, join(distOutDir, "cli.js"));
await writeFile(join(binDir, "myboxctl.js"), LAUNCHER);
await chmod(join(binDir, "myboxctl.js"), 0o755);
await copyFile("LICENSE", join(outDir, "LICENSE"));
await writeFile(join(outDir, "package.json"), `${JSON.stringify(PACKAGE, null, 2)}\n`);

console.log(`Prepared npm package at ${outDir} (v${version})`);

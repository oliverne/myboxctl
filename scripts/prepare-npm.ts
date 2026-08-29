import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  archiveName,
  type BunReleaseTarget,
  RELEASE_TARGETS,
  targetFor,
  validateReleaseVersion,
} from "./release-config.ts";

function values(name: string): string[] {
  const found: string[] = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name && process.argv[index + 1] !== undefined) {
      found.push(process.argv[index + 1] as string);
    }
  }
  return found;
}

function option(name: string, fallback?: string): string {
  const value = values(name).at(-1) ?? fallback;
  if (value === undefined) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

async function run(command: string[], cwd = process.cwd()): Promise<void> {
  const child = Bun.spawn(command, { cwd, stdout: "inherit", stderr: "inherit" });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(`Command failed (${exitCode}): ${command.join(" ")}`);
  }
}

function safeDirectoryName(packageName: string): string {
  return packageName.replace("@", "").replace("/", "-");
}

function packageMetadata(name: string, version: string): Record<string, unknown> {
  return {
    name,
    version,
    description: "Standalone myboxctl executable for one operating system and architecture",
    license: "MIT",
    repository: {
      type: "git",
      url: "git+https://github.com/oliverne/myboxctl.git",
    },
    files: ["bin"],
  };
}

function launcher(packages: Record<string, string>): string {
  return `#!/usr/bin/env node
"use strict";

const { spawnSync } = require("node:child_process");
const { dirname, join } = require("node:path");

const packages = ${JSON.stringify(packages, null, 2)};
const key = process.platform + "-" + process.arch;
const packageName = packages[key];
if (!packageName) {
  console.error("myboxctl does not provide a standalone binary for " + key + ".");
  process.exit(1);
}

let packageJson;
try {
  packageJson = require.resolve(packageName + "/package.json");
} catch {
  console.error("The optional package " + packageName + " is missing. Reinstall @oliverne/myboxctl without omitting optional dependencies.");
  process.exit(1);
}

const executable = join(dirname(packageJson), "bin", process.platform === "win32" ? "myboxctl.exe" : "myboxctl");
const result = spawnSync(executable, process.argv.slice(2), { stdio: "inherit" });
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
if (result.signal) {
  process.kill(process.pid, result.signal);
}
process.exit(result.status ?? 1);
`;
}

const version = validateReleaseVersion(option("--version"));
const releaseDirectory = resolve(option("--release-dir", "release"));
const outputDirectory = resolve(option("--outdir", join(releaseDirectory, "npm")));
const requestedTargets = values("--target");
const targets =
  requestedTargets.length === 0
    ? RELEASE_TARGETS
    : requestedTargets.map((value) => targetFor(value as BunReleaseTarget));
const checksumLines = (await readFile(join(releaseDirectory, "SHA256SUMS"), "utf8")).split(
  /\r?\n/u,
);

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

const optionalDependencies: Record<string, string> = {};
const launcherPackages: Record<string, string> = {};
for (const target of targets) {
  const asset = archiveName(version, target);
  const expected = checksumLines.find((line) => line.endsWith(`  ${asset}`))?.split(/\s+/u)[0];
  if (expected === undefined) {
    throw new Error(`Missing checksum for ${asset}.`);
  }
  const assetPath = join(releaseDirectory, asset);
  const actual = createHash("sha256")
    .update(await readFile(assetPath))
    .digest("hex");
  if (actual !== expected) {
    throw new Error(`Checksum mismatch for ${asset}.`);
  }

  const packageDirectory = join(outputDirectory, safeDirectoryName(target.npmPackage));
  const binDirectory = join(packageDirectory, "bin");
  const extractDirectory = join(outputDirectory, ".extract", `${target.platform}-${target.arch}`);
  await mkdir(binDirectory, { recursive: true });
  await mkdir(extractDirectory, { recursive: true });
  if (target.archive === "zip") {
    await run(["unzip", "-q", assetPath, target.executable, "-d", extractDirectory]);
  } else {
    await run(["tar", "-xzf", assetPath, "-C", extractDirectory, target.executable]);
  }
  await copyFile(join(extractDirectory, target.executable), join(binDirectory, target.executable));
  if (target.nodePlatform !== "win32") {
    await chmod(join(binDirectory, target.executable), 0o755);
  }

  const metadata = {
    ...packageMetadata(target.npmPackage, version),
    os: [target.nodePlatform],
    cpu: [target.arch],
  };
  await writeFile(join(packageDirectory, "package.json"), `${JSON.stringify(metadata, null, 2)}\n`);
  await copyFile("LICENSE", join(packageDirectory, "LICENSE"));
  optionalDependencies[target.npmPackage] = version;
  launcherPackages[`${target.nodePlatform}-${target.arch}`] = target.npmPackage;
}

const rootDirectory = join(outputDirectory, "oliverne-myboxctl");
await mkdir(join(rootDirectory, "bin"), { recursive: true });
const launcherPath = join(rootDirectory, "bin", "myboxctl.js");
await writeFile(launcherPath, launcher(launcherPackages));
await chmod(launcherPath, 0o755);
await copyFile("LICENSE", join(rootDirectory, "LICENSE"));
const rootMetadata = {
  ...packageMetadata("@oliverne/myboxctl", version),
  description: "Agent-friendly CLI for NAVER MYBOX file operations",
  bin: { myboxctl: "bin/myboxctl.js" },
  engines: { node: ">=18" },
  optionalDependencies,
};
await writeFile(join(rootDirectory, "package.json"), `${JSON.stringify(rootMetadata, null, 2)}\n`);
await rm(join(outputDirectory, ".extract"), { recursive: true, force: true });

if (process.argv.includes("--link-native")) {
  if (targets.length !== 1) {
    throw new Error("--link-native requires exactly one --target.");
  }
  const target = targets[0];
  if (target === undefined) {
    throw new Error("Native target is missing.");
  }
  const scopeDirectory = join(rootDirectory, "node_modules", "@oliverne");
  await mkdir(scopeDirectory, { recursive: true });
  const relativePackageDirectory = join("..", "..", "..", safeDirectoryName(target.npmPackage));
  await symlink(
    relativePackageDirectory,
    join(scopeDirectory, target.npmPackage.split("/")[1] as string),
    "dir",
  );
}

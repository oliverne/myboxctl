import { createHash } from "node:crypto";
import { chmod, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import {
  archiveName,
  type BunReleaseTarget,
  RELEASE_TARGETS,
  targetFor,
  validateReleaseVersion,
} from "./release-config.ts";
import { renderPackaging } from "./render-packaging.ts";

function values(name: string): string[] {
  const found: string[] = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name && process.argv[index + 1] !== undefined) {
      found.push(process.argv[index + 1] as string);
    }
  }
  return found;
}

function requiredOption(name: string): string {
  const value = values(name).at(-1);
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

async function sha256(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

async function buildTarget(
  version: string,
  bunTarget: BunReleaseTarget,
  outputDirectory: string,
): Promise<string> {
  const target = targetFor(bunTarget);
  const stagingDirectory = join(outputDirectory, ".staging", `${target.platform}-${target.arch}`);
  const executablePath = join(stagingDirectory, target.executable);
  await rm(stagingDirectory, { recursive: true, force: true });
  await mkdir(stagingDirectory, { recursive: true });

  await run([
    process.execPath,
    "build",
    resolve("src/cli.ts"),
    "--compile",
    "--minify",
    `--target=${target.bunTarget}`,
    `--outfile=${executablePath}`,
    "--no-compile-autoload-bunfig",
    "--define",
    `MYBOXCTL_VERSION=${JSON.stringify(version)}`,
  ]);

  if (target.nodePlatform !== "win32") {
    await chmod(executablePath, 0o755);
  }
  await cp("LICENSE", join(stagingDirectory, "LICENSE"));

  const assetPath = join(outputDirectory, archiveName(version, target));
  await rm(assetPath, { force: true });
  if (target.archive === "zip") {
    await run(["zip", "-q", "-9", assetPath, target.executable, "LICENSE"], stagingDirectory);
  } else {
    const tarPath = `${assetPath}.tar`;
    await run(["tar", "-cf", tarPath, target.executable, "LICENSE"], stagingDirectory);
    await writeFile(assetPath, Bun.gzipSync(await readFile(tarPath), { level: 9 }));
    await rm(tarPath, { force: true });
  }
  return assetPath;
}

const version = validateReleaseVersion(requiredOption("--version"));
const outputDirectory = resolve(values("--outdir").at(-1) ?? "release");
const requestedTargets = values("--target");
const targets =
  requestedTargets.length === 0
    ? RELEASE_TARGETS
    : requestedTargets.map((value) => targetFor(value as BunReleaseTarget));

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

const assets: string[] = [];
for (const target of targets) {
  assets.push(await buildTarget(version, target.bunTarget, outputDirectory));
}

const checksums = [];
for (const asset of assets.toSorted((left, right) => left.localeCompare(right))) {
  checksums.push(`${await sha256(asset)}  ${basename(asset)}`);
}
await writeFile(join(outputDirectory, "SHA256SUMS"), `${checksums.join("\n")}\n`);
if (targets.length === RELEASE_TARGETS.length) {
  await renderPackaging(version, outputDirectory);
}
await rm(join(outputDirectory, ".staging"), { recursive: true, force: true });

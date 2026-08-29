import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  archiveName,
  type BunReleaseTarget,
  packageKey,
  targetFor,
  validateReleaseVersion,
} from "./release-config.ts";

function option(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (value === undefined) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

async function run(command: string[], cwd = process.cwd()): Promise<string> {
  const child = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`Command failed (${exitCode}): ${command.join(" ")}\n${stderr}`);
  }
  return stdout;
}

const version = validateReleaseVersion(option("--version"));
const target = targetFor(option("--target") as BunReleaseTarget);
const releaseDirectory = resolve(
  process.argv.includes("--release-dir") ? option("--release-dir") : "release",
);
const asset = archiveName(version, target);
const assetPath = join(releaseDirectory, asset);
const expectedLine = (await readFile(join(releaseDirectory, "SHA256SUMS"), "utf8"))
  .split(/\r?\n/u)
  .find((line) => line.endsWith(`  ${asset}`));
if (expectedLine === undefined) {
  throw new Error(`Missing checksum for ${asset}.`);
}
const expectedChecksum = expectedLine.split(/\s+/u)[0];
const actualChecksum = createHash("sha256")
  .update(await readFile(assetPath))
  .digest("hex");
if (actualChecksum !== expectedChecksum) {
  throw new Error(`Checksum mismatch for ${asset}.`);
}

const currentKey = packageKey(process.platform, process.arch);
const targetKey = packageKey(target.nodePlatform, target.arch);
if (currentKey !== targetKey) {
  throw new Error(`Native smoke requires ${targetKey}, current runner is ${currentKey}.`);
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), "myboxctl-release-"));
try {
  const extractCommand =
    process.platform === "win32"
      ? ["tar", "--force-local", "-xf", assetPath, "-C", temporaryDirectory]
      : ["tar", "-xf", assetPath, "-C", temporaryDirectory];
  await run(extractCommand);
  const executable = join(temporaryDirectory, target.executable);
  const versionOutput = await run([executable, "--version"]);
  if (versionOutput !== `${version}\n`) {
    throw new Error(`Unexpected version output: ${JSON.stringify(versionOutput)}`);
  }
  const helpOutput = await run([executable, "--help"]);
  if (!helpOutput.includes("Usage: myboxctl") || !helpOutput.includes("download")) {
    throw new Error("Release help smoke failed.");
  }
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

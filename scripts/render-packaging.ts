import { chmod, copyFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { archiveName, RELEASE_TARGETS, validateReleaseVersion } from "./release-config.ts";

function checksumMap(contents: string): Map<string, string> {
  const checksums = new Map<string, string>();
  for (const line of contents.trim().split(/\r?\n/u)) {
    const [checksum, name] = line.split(/\s+/u);
    if (checksum !== undefined && name !== undefined) {
      checksums.set(name, checksum);
    }
  }
  return checksums;
}

function requireChecksum(checksums: Map<string, string>, asset: string): string {
  const checksum = checksums.get(asset);
  if (checksum === undefined) {
    throw new Error(`Missing checksum for ${asset}.`);
  }
  return checksum;
}

export async function renderPackaging(
  versionValue: string,
  releaseDirectory: string,
): Promise<void> {
  const version = validateReleaseVersion(versionValue);
  const checksums = checksumMap(await readFile(join(releaseDirectory, "SHA256SUMS"), "utf8"));
  const byKey = new Map(
    RELEASE_TARGETS.map((target) => [`${target.platform}-${target.arch}`, target]),
  );
  const asset = (key: string) => {
    const target = byKey.get(key);
    if (target === undefined) {
      throw new Error(`Unknown packaging target: ${key}`);
    }
    return archiveName(version, target);
  };
  const url = (name: string) =>
    `https://github.com/oliverne/myboxctl/releases/download/v${version}/${name}`;

  const darwinArm = asset("darwin-arm64");
  const darwinX64 = asset("darwin-x64");
  const linuxArm = asset("linux-arm64");
  const linuxX64 = asset("linux-x64");
  const windowsX64 = asset("windows-x64");
  const formula = `class Myboxctl < Formula
  desc "Agent-friendly CLI for NAVER MYBOX file operations"
  homepage "https://github.com/oliverne/myboxctl"
  version "${version}"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "${url(darwinArm)}"
      sha256 "${requireChecksum(checksums, darwinArm)}"
    else
      url "${url(darwinX64)}"
      sha256 "${requireChecksum(checksums, darwinX64)}"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "${url(linuxArm)}"
      sha256 "${requireChecksum(checksums, linuxArm)}"
    else
      url "${url(linuxX64)}"
      sha256 "${requireChecksum(checksums, linuxX64)}"
    end
  end

  def install
    bin.install "myboxctl"
  end

  test do
    assert_equal "${version}", shell_output("#{bin}/myboxctl --version").strip
  end
end
`;
  await writeFile(join(releaseDirectory, "myboxctl.rb"), formula);

  const scoopManifest = {
    version,
    description: "Agent-friendly CLI for NAVER MYBOX file operations",
    homepage: "https://github.com/oliverne/myboxctl",
    license: "MIT",
    architecture: {
      "64bit": {
        url: url(windowsX64),
        hash: requireChecksum(checksums, windowsX64),
      },
    },
    bin: "myboxctl.exe",
  };
  await writeFile(
    join(releaseDirectory, "myboxctl.json"),
    `${JSON.stringify(scoopManifest, null, 2)}\n`,
  );

  const installerPath = join(releaseDirectory, "install.sh");
  await copyFile("packaging/install.sh", installerPath);
  const installer = (await readFile(installerPath, "utf8")).replaceAll(
    "__MYBOXCTL_VERSION__",
    version,
  );
  await writeFile(installerPath, installer);
  await chmod(installerPath, 0o755);
}

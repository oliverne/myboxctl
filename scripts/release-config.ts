export const RELEASE_TARGETS = [
  {
    bunTarget: "bun-darwin-arm64",
    platform: "darwin",
    nodePlatform: "darwin",
    arch: "arm64",
    archive: "tar.gz",
    executable: "myboxctl",
    npmPackage: "@oliverne/myboxctl-darwin-arm64",
  },
  {
    bunTarget: "bun-darwin-x64",
    platform: "darwin",
    nodePlatform: "darwin",
    arch: "x64",
    archive: "tar.gz",
    executable: "myboxctl",
    npmPackage: "@oliverne/myboxctl-darwin-x64",
  },
  {
    bunTarget: "bun-linux-arm64",
    platform: "linux",
    nodePlatform: "linux",
    arch: "arm64",
    archive: "tar.gz",
    executable: "myboxctl",
    npmPackage: "@oliverne/myboxctl-linux-arm64",
  },
  {
    bunTarget: "bun-linux-x64",
    platform: "linux",
    nodePlatform: "linux",
    arch: "x64",
    archive: "tar.gz",
    executable: "myboxctl",
    npmPackage: "@oliverne/myboxctl-linux-x64",
  },
  {
    bunTarget: "bun-windows-x64",
    platform: "windows",
    nodePlatform: "win32",
    arch: "x64",
    archive: "zip",
    executable: "myboxctl.exe",
    npmPackage: "@oliverne/myboxctl-windows-x64",
  },
] as const;

export type ReleaseTarget = (typeof RELEASE_TARGETS)[number];
export type BunReleaseTarget = ReleaseTarget["bunTarget"];

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

export function validateReleaseVersion(value: string): string {
  if (!SEMVER.test(value)) {
    throw new Error(`Invalid release version: ${value}`);
  }
  return value;
}

export function targetFor(value: string): ReleaseTarget {
  const target = RELEASE_TARGETS.find((candidate) => candidate.bunTarget === value);
  if (target === undefined) {
    throw new Error(`Unsupported release target: ${value}`);
  }
  return target;
}

export function archiveName(version: string, target: ReleaseTarget): string {
  return `myboxctl-v${version}-${target.platform}-${target.arch}.${target.archive}`;
}

export function packageKey(platform: NodeJS.Platform, arch: string): string {
  return `${platform}-${arch}`;
}

export function npmPackageFor(platform: NodeJS.Platform, arch: string): string | undefined {
  return RELEASE_TARGETS.find(
    (target) => packageKey(target.nodePlatform, target.arch) === packageKey(platform, arch),
  )?.npmPackage;
}

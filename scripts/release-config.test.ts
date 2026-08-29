import { describe, expect, test } from "bun:test";

import {
  archiveName,
  npmPackageFor,
  RELEASE_TARGETS,
  targetFor,
  validateReleaseVersion,
} from "./release-config.ts";

describe("release config", () => {
  test("defines five unique supported standalone targets", () => {
    expect(RELEASE_TARGETS).toHaveLength(5);
    expect(new Set(RELEASE_TARGETS.map((target) => target.bunTarget)).size).toBe(5);
    expect(new Set(RELEASE_TARGETS.map((target) => target.npmPackage)).size).toBe(5);
  });

  test("accepts release and prerelease SemVer without a v prefix", () => {
    expect(validateReleaseVersion("1.2.3")).toBe("1.2.3");
    expect(validateReleaseVersion("0.1.0-beta.1")).toBe("0.1.0-beta.1");
    expect(() => validateReleaseVersion("v1.2.3")).toThrow("Invalid release version");
    expect(() => validateReleaseVersion("1.2")).toThrow("Invalid release version");
  });

  test("uses deterministic archive and npm package mappings", () => {
    const linux = targetFor("bun-linux-x64");
    const windows = targetFor("bun-windows-x64");
    expect(archiveName("1.2.3", linux)).toBe("myboxctl-v1.2.3-linux-x64.tar.gz");
    expect(archiveName("1.2.3", windows)).toBe("myboxctl-v1.2.3-windows-x64.zip");
    expect(npmPackageFor("linux", "x64")).toBe("@oliverne/myboxctl-linux-x64");
    expect(npmPackageFor("win32", "arm64")).toBeUndefined();
  });
});

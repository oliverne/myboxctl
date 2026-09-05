import { afterEach, describe, expect, test } from "bun:test";
import type { PathLike, Stats } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AppConfig, ConfigError, loadConfig } from "./config.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "myboxctl-config-"));
  temporaryDirectories.push(directory);
  return directory;
}

// Windows cannot represent POSIX mode bits through chmod/stat, so the real
// filesystem cannot faithfully exercise the Unix-only permission check. We read
// the real file metadata and override only the mode field to keep the check
// deterministic across platforms.
const statWithMode =
  (mode: number) =>
  async (path: PathLike): Promise<Stats> => {
    const stats = await stat(path);
    return { ...stats, mode };
  };

describe("loadConfig", () => {
  test("uses MYBOX_PAT verbatim and applies defaults", async () => {
    const config = await loadConfig({
      env: { MYBOX_PAT: "  raw-pat-value  " },
      homeDir: "/home/tester",
      platform: "linux",
    });

    expect(config).toBeInstanceOf(AppConfig);
    expect(config.pat).toBe("  raw-pat-value  ");
    expect(config.baseUrl).toBe("https://open-api.mybox.naver.com");
    expect(config.timeoutMs).toBe(30_000);
    expect(config.credentialsPath).toBe(join("/home/tester", ".config", "myboxctl", "credentials"));
    expect(JSON.stringify(config)).not.toContain("raw-pat-value");
  });

  test("reads one trimmed token line from XDG credentials", async () => {
    const directory = await temporaryDirectory();
    const credentialsDirectory = join(directory, "myboxctl");
    const credentialsPath = join(credentialsDirectory, "credentials");
    await mkdir(credentialsDirectory, { recursive: true });
    await writeFile(credentialsPath, "  file-token\n", { mode: 0o600 });
    await chmod(credentialsPath, 0o600);

    const config = await loadConfig({
      env: { XDG_CONFIG_HOME: directory },
      platform: "linux",
      stat: statWithMode(0o600) as unknown as typeof stat,
    });

    expect(config.pat).toBe("file-token");
    expect(config.credentialsPath).toBe(credentialsPath);
  });

  test("rejects missing, empty, multiline, and insecure credentials", async () => {
    await expect(
      loadConfig({ env: { XDG_CONFIG_HOME: await temporaryDirectory() }, platform: "linux" }),
    ).rejects.toMatchObject({ kind: "invalid-arguments" });

    await expect(loadConfig({ env: { MYBOX_PAT: "" } })).rejects.toMatchObject({
      kind: "invalid-arguments",
    });

    const directory = await temporaryDirectory();
    const credentialsPath = join(directory, "credentials");
    await writeFile(credentialsPath, "first\nsecond\n", { mode: 0o600 });
    await chmod(credentialsPath, 0o600);
    await expect(
      loadConfig({
        env: {},
        credentialsPath,
        platform: "linux",
        stat: statWithMode(0o600) as unknown as typeof stat,
      }),
    ).rejects.toMatchObject({ kind: "invalid-arguments" });

    await writeFile(credentialsPath, "token\n", { mode: 0o644 });
    await chmod(credentialsPath, 0o644);
    await expect(
      loadConfig({
        env: {},
        credentialsPath,
        platform: "linux",
        stat: statWithMode(0o644) as unknown as typeof stat,
      }),
    ).rejects.toMatchObject({ kind: "invalid-arguments" });
  });

  test("validates timeout and base URL overrides", async () => {
    const baseEnv = { MYBOX_PAT: "token" };
    const config = await loadConfig({
      env: { ...baseEnv, MYBOX_BASE_URL: "http://localhost:1234/", MYBOX_TIMEOUT_MS: "1250" },
    });
    expect(config.baseUrl).toBe("http://localhost:1234");
    expect(config.timeoutMs).toBe(1250);

    for (const timeout of ["0", "-1", "1.5", "abc", "Infinity"]) {
      await expect(
        loadConfig({ env: { ...baseEnv, MYBOX_TIMEOUT_MS: timeout } }),
      ).rejects.toBeInstanceOf(ConfigError);
    }
    await expect(
      loadConfig({ env: { ...baseEnv, MYBOX_BASE_URL: "ftp://example.test" } }),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  test("loads a plan from config and lets MYBOX_PLAN take precedence", async () => {
    const directory = await temporaryDirectory();
    const configDirectory = join(directory, "myboxctl");
    await mkdir(configDirectory, { recursive: true });
    await writeFile(join(configDirectory, "config.json"), '{"plan":"80GB"}\n');

    const fromFile = await loadConfig({
      env: { MYBOX_PAT: "token", XDG_CONFIG_HOME: directory },
    });
    expect(fromFile.plan).toBe("80GB");
    expect(fromFile.rateLimits).toMatchObject({
      searchRequestsPerMinute: 10,
      deleteRequestsPerMinute: 60,
      downloadUrlsPerDay: 1_000,
      isDefault: false,
    });

    const fromEnvironment = await loadConfig({
      env: { MYBOX_PAT: "token", XDG_CONFIG_HOME: directory, MYBOX_PLAN: "20TB" },
    });
    expect(fromEnvironment.plan).toBe("20TB");
    expect(fromEnvironment.rateLimits).toMatchObject({
      searchRequestsPerMinute: 30,
      deleteRequestsPerMinute: 240,
      downloadUrlsPerDay: 50_000,
    });
  });

  test("rejects invalid plan configuration", async () => {
    await expect(
      loadConfig({ env: { MYBOX_PAT: "token", MYBOX_PLAN: "enterprise" } }),
    ).rejects.toBeInstanceOf(ConfigError);
    const directory = await temporaryDirectory();
    await writeFile(join(directory, "config.json"), '{"plan":"30GB","limit":1}\n');
    await expect(
      loadConfig({ env: { MYBOX_PAT: "token" }, configPath: join(directory, "config.json") }),
    ).rejects.toBeInstanceOf(ConfigError);
  });
});

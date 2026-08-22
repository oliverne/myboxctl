import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
    expect(config.credentialsPath).toBe("/home/tester/.config/myboxctl/credentials");
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
    await expect(loadConfig({ env: {}, credentialsPath, platform: "linux" })).rejects.toMatchObject(
      { kind: "invalid-arguments" },
    );

    await writeFile(credentialsPath, "token\n", { mode: 0o644 });
    await chmod(credentialsPath, 0o644);
    await expect(loadConfig({ env: {}, credentialsPath, platform: "linux" })).rejects.toMatchObject(
      { kind: "invalid-arguments" },
    );
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
});

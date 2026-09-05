import type { Stats } from "node:fs";
import { readFile as defaultReadFile, stat as defaultStat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_BASE_URL = "https://open-api.mybox.naver.com";
export const DEFAULT_TIMEOUT_MS = 30_000;

export type ConfigEnvironment = Record<string, string | undefined>;

type ReadFile = typeof defaultReadFile;
type Stat = typeof defaultStat;

export type ConfigOptions = {
  env?: ConfigEnvironment;
  homeDir?: string;
  platform?: NodeJS.Platform;
  credentialsPath?: string;
  readFile?: ReadFile;
  stat?: Stat;
};

export class ConfigError extends Error {
  readonly kind = "invalid-arguments" as const;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ConfigError";
  }
}

/**
 * Runtime configuration. The PAT is intentionally held in a private field so
 * JSON serialization of this object cannot accidentally include it.
 */
export class AppConfig {
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly credentialsPath: string;
  #pat: string;

  constructor(values: {
    pat: string;
    baseUrl: string;
    timeoutMs: number;
    credentialsPath: string;
  }) {
    this.#pat = values.pat;
    this.baseUrl = values.baseUrl;
    this.timeoutMs = values.timeoutMs;
    this.credentialsPath = values.credentialsPath;
  }

  get pat(): string {
    return this.#pat;
  }

  toJSON(): { baseUrl: string; timeoutMs: number; credentialsPath: string } {
    return {
      baseUrl: this.baseUrl,
      timeoutMs: this.timeoutMs,
      credentialsPath: this.credentialsPath,
    };
  }
}

function defaultCredentialsPath(env: ConfigEnvironment, homeDirectory: string): string {
  const xdgConfigHome = env.XDG_CONFIG_HOME;
  if (xdgConfigHome !== undefined && xdgConfigHome.length > 0) {
    return join(xdgConfigHome, "myboxctl", "credentials");
  }

  return join(homeDirectory, ".config", "myboxctl", "credentials");
}

function parseTimeout(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_TIMEOUT_MS;
  }

  if (!/^\d+$/.test(value)) {
    throw new ConfigError("MYBOX_TIMEOUT_MS must be a positive integer.");
  }

  const timeout = Number(value);
  if (!Number.isSafeInteger(timeout) || timeout <= 0) {
    throw new ConfigError("MYBOX_TIMEOUT_MS must be a positive integer.");
  }

  return timeout;
}

function parseBaseUrl(value: string | undefined): string {
  const raw = value ?? DEFAULT_BASE_URL;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch (error) {
    throw new ConfigError("MYBOX_BASE_URL must be a valid HTTP(S) URL.", { cause: error });
  }

  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new ConfigError("MYBOX_BASE_URL must be a valid HTTP(S) URL.");
  }

  return parsed.toString().replace(/\/$/, "");
}

function credentialLines(contents: string): string {
  const lines = contents.split(/\r?\n/);
  if (lines.at(-1) === "") {
    lines.pop();
  }

  if (lines.length !== 1) {
    throw new ConfigError("The credentials file must contain exactly one token line.");
  }

  const token = lines[0]?.trim() ?? "";
  if (token.length === 0) {
    throw new ConfigError("The credentials file contains an empty token.");
  }

  return token;
}

async function readCredentialFile(
  path: string,
  platform: NodeJS.Platform,
  readFile: ReadFile,
  stat: Stat,
): Promise<string> {
  let fileStats: Stats;
  try {
    fileStats = await stat(path);
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    if (code === "ENOENT") {
      throw new ConfigError("MYBOX_PAT or a credentials file is required.", { cause: error });
    }

    throw new ConfigError("The MYBOX credentials file could not be read.", { cause: error });
  }

  if (platform !== "win32" && (fileStats.mode & 0o077) !== 0) {
    throw new ConfigError(
      "The credentials file must be readable only by its owner; run chmod 600.",
    );
  }

  let contents: string;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    throw new ConfigError("The MYBOX credentials file could not be read.", { cause: error });
  }

  return credentialLines(contents);
}

export async function loadConfig(options: ConfigOptions = {}): Promise<AppConfig> {
  const env = options.env ?? process.env;
  const homeDirectory = options.homeDir ?? env.HOME ?? homedir();
  const credentialsPath = options.credentialsPath ?? defaultCredentialsPath(env, homeDirectory);

  let pat: string;
  if (env.MYBOX_PAT !== undefined) {
    if (env.MYBOX_PAT.trim().length === 0) {
      throw new ConfigError("MYBOX_PAT must not be empty.");
    }
    pat = env.MYBOX_PAT;
  } else {
    pat = await readCredentialFile(
      credentialsPath,
      options.platform ?? process.platform,
      options.readFile ?? defaultReadFile,
      options.stat ?? defaultStat,
    );
  }

  return new AppConfig({
    pat,
    baseUrl: parseBaseUrl(env.MYBOX_BASE_URL),
    timeoutMs: parseTimeout(env.MYBOX_TIMEOUT_MS),
    credentialsPath,
  });
}

export function serializeConfig(config: AppConfig): {
  baseUrl: string;
  timeoutMs: number;
  credentialsPath: string;
} {
  return config.toJSON();
}

import { mkdir, readFile, rename, rmdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { DomainError } from "../errors.ts";

export const SEARCH_REQUEST_LIMIT = 10;
export const SEARCH_WINDOW_MS = 60_000;
export const DELETE_REQUEST_LIMIT = 60;
export const DELETE_WINDOW_MS = 60_000;

const STATE_VERSION = 1;
const LOCK_RETRY_MS = 25;
const LOCK_TIMEOUT_MS = 5_000;
const STALE_LOCK_MS = 30_000;

export type RateLimitRequest = {
  method: string;
  url: URL;
};

export type RateLimitResponse = {
  status: number;
  headers: Headers;
};

export type RequestRateLimiter = {
  beforeRequest(request: RateLimitRequest): Promise<void>;
  recordResponse(request: RateLimitRequest, response: RateLimitResponse): Promise<void>;
};

type BucketState = {
  requests: number[];
  blockedUntil?: number;
};

type RateLimitState = {
  version: typeof STATE_VERSION;
  buckets: Record<string, BucketState>;
};

export type SharedRateLimiterDependencies = {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
};

const defaultDependencies: SharedRateLimiterDependencies = {
  now: () => Date.now(),
  sleep: (ms) => Bun.sleep(ms),
  random: () => Math.random(),
};

export const noOpRateLimiter: RequestRateLimiter = {
  beforeRequest: async () => undefined,
  recordResponse: async () => undefined,
};

function systemErrorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

function stateError(cause: unknown): DomainError {
  return new DomainError("api-unavailable", "The local MYBOX rate-limit state is unavailable.", {
    code: "RATE_LIMIT_STATE_UNAVAILABLE",
    retryable: true,
    cause,
  });
}

function emptyState(): RateLimitState {
  return { version: STATE_VERSION, buckets: {} };
}

function parseState(contents: string): RateLimitState {
  const value = JSON.parse(contents) as unknown;
  if (
    typeof value !== "object" ||
    value === null ||
    !("version" in value) ||
    value.version !== STATE_VERSION ||
    !("buckets" in value) ||
    typeof value.buckets !== "object" ||
    value.buckets === null ||
    Array.isArray(value.buckets)
  ) {
    throw new Error("Invalid rate-limit state");
  }

  const buckets: Record<string, BucketState> = {};
  for (const [key, rawBucket] of Object.entries(value.buckets)) {
    const requests =
      typeof rawBucket === "object" && rawBucket !== null && "requests" in rawBucket
        ? rawBucket.requests
        : undefined;
    if (
      typeof rawBucket !== "object" ||
      rawBucket === null ||
      !Array.isArray(requests) ||
      !requests.every((item: unknown) => typeof item === "number" && Number.isFinite(item))
    ) {
      throw new Error("Invalid rate-limit bucket");
    }

    const blockedUntil =
      "blockedUntil" in rawBucket &&
      typeof rawBucket.blockedUntil === "number" &&
      Number.isFinite(rawBucket.blockedUntil)
        ? rawBucket.blockedUntil
        : undefined;
    buckets[key] = {
      requests,
      ...(blockedUntil === undefined ? {} : { blockedUntil }),
    };
  }

  return { version: STATE_VERSION, buckets };
}

type BucketConfig = {
  key: string;
  limit: number;
  windowMs: number;
};

function bucketForRequest(request: RateLimitRequest): BucketConfig | undefined {
  const method = request.method.toUpperCase();
  if (method === "GET" && request.url.pathname.startsWith("/v1/search/")) {
    return {
      key: `${request.url.origin}:search`,
      limit: SEARCH_REQUEST_LIMIT,
      windowMs: SEARCH_WINDOW_MS,
    };
  }
  if (method === "DELETE" && /^\/v1\/drive\/resources\/[^/]+$/.test(request.url.pathname)) {
    return {
      key: `${request.url.origin}:delete`,
      limit: DELETE_REQUEST_LIMIT,
      windowMs: DELETE_WINDOW_MS,
    };
  }
  return undefined;
}

function clampedRandom(random: () => number): number {
  return Math.min(Math.max(random(), 0), 1);
}

export function parseRetryAfterMs(headers: Headers, now = Date.now()): number | undefined {
  const value = headers.get("Retry-After");
  if (value === null) {
    return undefined;
  }

  const seconds = Number(value.trim());
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1_000;
  }

  const retryAt = Date.parse(value);
  if (Number.isFinite(retryAt)) {
    return Math.max(0, retryAt - now);
  }

  return undefined;
}

export function fallbackRateLimitDelayMs(random: () => number): number {
  return SEARCH_WINDOW_MS + Math.floor(clampedRandom(random) * 1_000);
}

export function defaultRateLimitStatePath(
  env: Record<string, string | undefined> = process.env,
  homeDirectory = homedir(),
): string {
  if (env.MYBOX_RATE_LIMIT_STATE_PATH !== undefined && env.MYBOX_RATE_LIMIT_STATE_PATH.length > 0) {
    return env.MYBOX_RATE_LIMIT_STATE_PATH;
  }

  const stateHome =
    env.XDG_STATE_HOME && env.XDG_STATE_HOME.length > 0
      ? env.XDG_STATE_HOME
      : process.platform === "win32" && env.LOCALAPPDATA
        ? env.LOCALAPPDATA
        : join(homeDirectory, ".local", "state");
  return join(stateHome, "myboxctl", "rate-limit.json");
}

export class SharedRateLimiter implements RequestRateLimiter {
  readonly statePath: string;
  readonly dependencies: SharedRateLimiterDependencies;

  constructor(
    options: { statePath: string },
    dependencies: Partial<SharedRateLimiterDependencies> = {},
  ) {
    this.statePath = options.statePath;
    this.dependencies = { ...defaultDependencies, ...dependencies };
  }

  private async acquireLock(): Promise<void> {
    const lockPath = `${this.statePath}.lock`;
    const startedAt = this.dependencies.now();
    await mkdir(dirname(this.statePath), { recursive: true, mode: 0o700 });

    while (true) {
      try {
        await mkdir(lockPath, { mode: 0o700 });
        return;
      } catch (error) {
        if (systemErrorCode(error) !== "EEXIST") {
          throw stateError(error);
        }

        try {
          const lockStats = await stat(lockPath);
          if (Date.now() - lockStats.mtimeMs > STALE_LOCK_MS) {
            await rmdir(lockPath);
            continue;
          }
        } catch (lockError) {
          if (!["ENOENT", "ENOTEMPTY"].includes(systemErrorCode(lockError) ?? "")) {
            throw stateError(lockError);
          }
        }

        if (this.dependencies.now() - startedAt >= LOCK_TIMEOUT_MS) {
          throw stateError(error);
        }
        await this.dependencies.sleep(LOCK_RETRY_MS);
      }
    }
  }

  private async readState(): Promise<RateLimitState> {
    try {
      return parseState(await readFile(this.statePath, "utf8"));
    } catch (error) {
      if (systemErrorCode(error) === "ENOENT") {
        return emptyState();
      }
      throw stateError(error);
    }
  }

  private async writeState(state: RateLimitState): Promise<void> {
    const temporaryPath = `${this.statePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(state)}\n`, { mode: 0o600 });
      await rename(temporaryPath, this.statePath);
    } catch (error) {
      throw stateError(error);
    }
  }

  private async withState<T>(update: (state: RateLimitState) => T): Promise<T> {
    const lockPath = `${this.statePath}.lock`;
    await this.acquireLock();
    try {
      const state = await this.readState();
      const result = update(state);
      await this.writeState(state);
      return result;
    } finally {
      await rmdir(lockPath).catch(() => undefined);
    }
  }

  async beforeRequest(request: RateLimitRequest): Promise<void> {
    const config = bucketForRequest(request);
    if (config === undefined) {
      return;
    }

    while (true) {
      const waitMs = await this.withState((state) => {
        const now = this.dependencies.now();
        const bucket = state.buckets[config.key] ?? { requests: [] };
        bucket.requests = bucket.requests.filter(
          (requestedAt) => requestedAt > now - config.windowMs,
        );
        state.buckets[config.key] = bucket;

        if (bucket.blockedUntil !== undefined && bucket.blockedUntil > now) {
          return bucket.blockedUntil - now;
        }
        if (bucket.requests.length >= config.limit) {
          return Math.max(1, (bucket.requests[0] ?? now) + config.windowMs - now);
        }

        bucket.requests.push(now);
        return 0;
      });

      if (waitMs <= 0) {
        return;
      }
      await this.dependencies.sleep(waitMs);
    }
  }

  async recordResponse(request: RateLimitRequest, response: RateLimitResponse): Promise<void> {
    const config = bucketForRequest(request);
    if (config === undefined || response.status !== 429) {
      return;
    }

    const delayMs =
      parseRetryAfterMs(response.headers, this.dependencies.now()) ??
      fallbackRateLimitDelayMs(this.dependencies.random);
    await this.withState((state) => {
      const bucket = state.buckets[config.key] ?? { requests: [] };
      bucket.blockedUntil = Math.max(bucket.blockedUntil ?? 0, this.dependencies.now() + delayMs);
      state.buckets[config.key] = bucket;
    });
  }
}

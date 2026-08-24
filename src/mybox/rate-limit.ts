import { mkdir, readFile, rename, rmdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { DomainError } from "../errors.ts";

export const SEARCH_REQUEST_LIMIT = 10;
export const SEARCH_WINDOW_MS = 60_000;
export const DELETE_REQUEST_LIMIT = 60;
export const DELETE_WINDOW_MS = 60_000;
export const OTHER_REQUEST_LIMIT = 60;
export const OTHER_WINDOW_MS = 60_000;

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
  policy?: Partial<SharedRateLimiterPolicy>;
};

/**
 * Test-only timing and bucket overrides. Production callers use the conservative defaults below;
 * these values deliberately have no environment-variable or CLI surface.
 */
export type SharedRateLimiterPolicy = {
  searchRequestLimit: number;
  searchWindowMs: number;
  deleteRequestLimit: number;
  deleteWindowMs: number;
  otherRequestLimit: number;
  otherWindowMs: number;
  lockRetryMs: number;
  lockTimeoutMs: number;
  staleLockMs: number;
};

const defaultDependencies: SharedRateLimiterDependencies = {
  now: () => Date.now(),
  sleep: (ms) => Bun.sleep(ms),
  random: () => Math.random(),
};

const defaultPolicy: SharedRateLimiterPolicy = {
  searchRequestLimit: SEARCH_REQUEST_LIMIT,
  searchWindowMs: SEARCH_WINDOW_MS,
  deleteRequestLimit: DELETE_REQUEST_LIMIT,
  deleteWindowMs: DELETE_WINDOW_MS,
  otherRequestLimit: OTHER_REQUEST_LIMIT,
  otherWindowMs: OTHER_WINDOW_MS,
  lockRetryMs: LOCK_RETRY_MS,
  lockTimeoutMs: LOCK_TIMEOUT_MS,
  staleLockMs: STALE_LOCK_MS,
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

    const blockedUntil = "blockedUntil" in rawBucket ? rawBucket.blockedUntil : undefined;
    if (
      blockedUntil !== undefined &&
      (typeof blockedUntil !== "number" || !Number.isFinite(blockedUntil))
    ) {
      throw new Error("Invalid rate-limit bucket cooldown");
    }
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

function bucketForRequest(
  request: RateLimitRequest,
  policy: SharedRateLimiterPolicy,
): BucketConfig | undefined {
  const method = request.method.toUpperCase();
  if (method === "GET" && request.url.pathname.startsWith("/v1/search/")) {
    return {
      key: `${request.url.origin}:search`,
      limit: policy.searchRequestLimit,
      windowMs: policy.searchWindowMs,
    };
  }
  if (method === "DELETE" && /^\/v1\/drive\/resources\/[^/]+$/.test(request.url.pathname)) {
    return {
      key: `${request.url.origin}:delete`,
      limit: policy.deleteRequestLimit,
      windowMs: policy.deleteWindowMs,
    };
  }

  let operation: string | undefined;
  if (method === "GET" && request.url.pathname === "/v1/drive/storage") {
    operation = "storage";
  } else if (method === "GET" && request.url.pathname === "/v1/drive/resources") {
    operation = "root-list";
  } else if (
    method === "GET" &&
    /^\/v1\/drive\/folders\/[^/]+\/resources$/.test(request.url.pathname)
  ) {
    operation = "folder-list";
  } else if (method === "GET" && /^\/v1\/drive\/resources\/[^/]+$/.test(request.url.pathname)) {
    operation = "resource-detail";
  } else if (method === "POST" && request.url.pathname === "/v1/drive/folders") {
    operation = "folder-create";
  } else if (method === "POST" && request.url.pathname === "/v1/drive/files") {
    operation = "upload-reservation";
  }
  if (operation !== undefined) {
    return {
      key: `${request.url.origin}:${operation}`,
      limit: policy.otherRequestLimit,
      windowMs: policy.otherWindowMs,
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
  readonly policy: SharedRateLimiterPolicy;

  constructor(
    options: { statePath: string },
    dependencies: Partial<SharedRateLimiterDependencies> = {},
  ) {
    this.statePath = options.statePath;
    this.dependencies = {
      ...defaultDependencies,
      ...dependencies,
      policy: dependencies.policy ?? {},
    };
    this.policy = { ...defaultPolicy, ...(this.dependencies.policy ?? {}) };
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
          if (this.dependencies.now() - lockStats.mtimeMs > this.policy.staleLockMs) {
            await rmdir(lockPath);
            continue;
          }
        } catch (lockError) {
          if (!["ENOENT", "ENOTEMPTY"].includes(systemErrorCode(lockError) ?? "")) {
            throw stateError(lockError);
          }
        }

        if (this.dependencies.now() - startedAt >= this.policy.lockTimeoutMs) {
          throw stateError(error);
        }
        await this.dependencies.sleep(this.policy.lockRetryMs);
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
    const config = bucketForRequest(request, this.policy);
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
    const config = bucketForRequest(request, this.policy);
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

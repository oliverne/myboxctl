import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  DELETE_REQUEST_LIMIT,
  DELETE_WINDOW_MS,
  defaultRateLimitStatePath,
  parseRetryAfterMs,
  SEARCH_REQUEST_LIMIT,
  SEARCH_WINDOW_MS,
  SharedRateLimiter,
} from "./rate-limit.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function temporaryStatePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "myboxctl-rate-limit-"));
  temporaryDirectories.push(directory);
  return join(directory, "rate-limit.json");
}

async function runRateLimitWorker(
  statePath: string,
  mode: "reserve" | "cooldown",
  options: {
    readyDirectory?: string;
    startFile?: string;
    windowMs?: number;
    retryAfter?: string;
  } = {},
): Promise<{ durationMs: number }> {
  const worker = Bun.spawn(
    [process.execPath, join(import.meta.dir, "../../test/helpers/rate-limit-worker.ts")],
    {
      env: {
        PATH: process.env.PATH ?? "",
        TMPDIR: process.env.TMPDIR ?? tmpdir(),
        MYBOX_RATE_LIMIT_WORKER_STATE_PATH: statePath,
        MYBOX_RATE_LIMIT_WORKER_MODE: mode,
        MYBOX_RATE_LIMIT_WORKER_LIMIT: "1",
        MYBOX_RATE_LIMIT_WORKER_WINDOW_MS: String(options.windowMs ?? 250),
        ...(options.readyDirectory === undefined
          ? {}
          : { MYBOX_RATE_LIMIT_WORKER_READY_DIRECTORY: options.readyDirectory }),
        ...(options.startFile === undefined
          ? {}
          : { MYBOX_RATE_LIMIT_WORKER_START_FILE: options.startFile }),
        ...(options.retryAfter === undefined
          ? {}
          : { MYBOX_RATE_LIMIT_WORKER_RETRY_AFTER: options.retryAfter }),
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, exitCode] = await Promise.all([new Response(worker.stdout).text(), worker.exited]);
  if (exitCode !== 0) {
    throw new Error(`rate-limit worker exited with ${exitCode}`);
  }
  return JSON.parse(stdout) as { durationMs: number };
}

async function waitForWorkers(readyDirectory: string, expectedCount: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if ((await readdir(readyDirectory)).length >= expectedCount) {
      return;
    }
    await Bun.sleep(5);
  }
  throw new Error("rate-limit workers did not become ready");
}

function fakeClock(start = 100_000) {
  let current = start;
  const sleeps: number[] = [];
  return {
    now: () => current,
    random: () => 0,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      current += ms;
    },
    sleeps,
  };
}

const searchRequest = {
  method: "GET",
  url: new URL("https://open-api.mybox.naver.com/v1/search/resources/folders?path=%2Fa"),
};

const deleteRequest = {
  method: "DELETE",
  url: new URL("https://open-api.mybox.naver.com/v1/drive/resources/file-1"),
};

describe("SharedRateLimiter", () => {
  test("derives its state path from an explicit override or XDG state home", () => {
    expect(
      defaultRateLimitStatePath(
        { MYBOX_RATE_LIMIT_STATE_PATH: "/custom/rate-limit.json" },
        "/home/tester",
      ),
    ).toBe("/custom/rate-limit.json");
    expect(defaultRateLimitStatePath({ XDG_STATE_HOME: "/state" }, "/home/tester")).toBe(
      "/state/myboxctl/rate-limit.json",
    );
  });

  test("parses Retry-After seconds and HTTP dates without capping the delay", () => {
    expect(parseRetryAfterMs(new Headers({ "Retry-After": "45" }), 0)).toBe(45_000);
    expect(
      parseRetryAfterMs(new Headers({ "Retry-After": "Thu, 01 Jan 1970 00:01:00 GMT" }), 10_000),
    ).toBe(50_000);
  });

  test("shares a conservative search window across limiter instances", async () => {
    const statePath = await temporaryStatePath();
    const clock = fakeClock();
    const first = new SharedRateLimiter({ statePath }, clock);
    const second = new SharedRateLimiter({ statePath }, clock);

    for (let index = 0; index < SEARCH_REQUEST_LIMIT; index += 1) {
      await first.beforeRequest(searchRequest);
    }
    await second.beforeRequest(searchRequest);

    expect(clock.sleeps).toEqual([SEARCH_WINDOW_MS]);
    const state = await Bun.file(statePath).text();
    expect(state).not.toContain("resources/folders");
    expect(state).not.toContain("path=%2Fa");
    expect(state).not.toContain("test-pat");
    expect(state).not.toContain("request-body");
    expect(await Bun.file(`${statePath}.lock`).exists()).toBe(false);
  });

  test("atomically shares a search slot across Bun child processes without persisting request data", async () => {
    const statePath = await temporaryStatePath();
    const readyDirectory = join(dirname(statePath), "worker-ready");
    const startFile = join(dirname(statePath), "worker-start");
    await mkdir(readyDirectory);
    const firstWorker = runRateLimitWorker(statePath, "reserve", { readyDirectory, startFile });
    const secondWorker = runRateLimitWorker(statePath, "reserve", { readyDirectory, startFile });
    await waitForWorkers(readyDirectory, 2);
    await writeFile(startFile, "");
    const [first, second] = await Promise.all([firstWorker, secondWorker]);

    expect(Math.max(first.durationMs, second.durationMs)).toBeGreaterThanOrEqual(100);
    const state = await Bun.file(statePath).text();
    expect(state).not.toContain("worker-query-secret");
    expect(state).not.toContain("worker-pat-secret");
    expect(state).not.toContain("worker-body-secret");
    expect(state).not.toContain("resources/folders");
    expect(await Bun.file(`${statePath}.lock`).exists()).toBe(false);
  });

  test("shares a 429 cooldown across Bun child processes", async () => {
    const statePath = await temporaryStatePath();
    await runRateLimitWorker(statePath, "cooldown", { retryAfter: "0.6" });

    const result = await runRateLimitWorker(statePath, "reserve", { windowMs: 250 });

    expect(result.durationMs).toBeGreaterThanOrEqual(150);
  });

  test("blocks all processes for Retry-After after a search 429", async () => {
    const statePath = await temporaryStatePath();
    const clock = fakeClock();
    const first = new SharedRateLimiter({ statePath }, clock);
    const second = new SharedRateLimiter({ statePath }, clock);

    await first.beforeRequest(searchRequest);
    await first.recordResponse(searchRequest, {
      status: 429,
      headers: new Headers({ "Retry-After": "12" }),
    });
    await second.beforeRequest(searchRequest);

    expect(clock.sleeps).toEqual([12_000]);
  });

  test("shares the 60 per minute delete window across limiter instances", async () => {
    const statePath = await temporaryStatePath();
    const clock = fakeClock();
    const first = new SharedRateLimiter({ statePath }, clock);
    const second = new SharedRateLimiter({ statePath }, clock);

    for (let index = 0; index < DELETE_REQUEST_LIMIT; index += 1) {
      await first.beforeRequest(deleteRequest);
    }
    await second.beforeRequest(deleteRequest);

    expect(clock.sleeps).toEqual([DELETE_WINDOW_MS]);
  });

  test("shares delete 429 cooldown without blocking the search bucket", async () => {
    const statePath = await temporaryStatePath();
    const clock = fakeClock();
    const first = new SharedRateLimiter({ statePath }, clock);
    const second = new SharedRateLimiter({ statePath }, clock);

    await first.beforeRequest(deleteRequest);
    await first.recordResponse(deleteRequest, {
      status: 429,
      headers: new Headers({ "Retry-After": "12" }),
    });
    await second.beforeRequest(searchRequest);
    expect(clock.sleeps).toEqual([]);

    await second.beforeRequest(deleteRequest);
    expect(clock.sleeps).toEqual([12_000]);
  });

  test("uses one search window when 429 has no usable Retry-After", async () => {
    const statePath = await temporaryStatePath();
    const clock = fakeClock();
    const limiter = new SharedRateLimiter({ statePath }, clock);

    await limiter.recordResponse(searchRequest, { status: 429, headers: new Headers() });
    await limiter.beforeRequest(searchRequest);

    expect(clock.sleeps).toEqual([SEARCH_WINDOW_MS]);
  });

  test("does not throttle endpoints outside the configured buckets", async () => {
    const statePath = await temporaryStatePath();
    const clock = fakeClock();
    const limiter = new SharedRateLimiter({ statePath }, clock);

    await limiter.beforeRequest({
      method: "GET",
      url: new URL("https://open-api.mybox.naver.com/v1/drive/resources"),
    });

    expect(clock.sleeps).toEqual([]);
    expect(await Bun.file(statePath).exists()).toBe(false);
  });

  test("fails closed when the shared state is malformed", async () => {
    const statePath = await temporaryStatePath();
    await Bun.write(statePath, "not-json\n");
    const limiter = new SharedRateLimiter({ statePath });

    await expect(limiter.beforeRequest(searchRequest)).rejects.toMatchObject({
      kind: "api-unavailable",
      code: "RATE_LIMIT_STATE_UNAVAILABLE",
    });
  });

  test("fails closed when a state bucket has an invalid cooldown", async () => {
    const statePath = await temporaryStatePath();
    await Bun.write(
      statePath,
      JSON.stringify({
        version: 1,
        buckets: { "https://example.test:search": { requests: [], blockedUntil: "soon" } },
      }),
    );
    const limiter = new SharedRateLimiter({ statePath });

    await expect(limiter.beforeRequest(searchRequest)).rejects.toMatchObject({
      kind: "api-unavailable",
      code: "RATE_LIMIT_STATE_UNAVAILABLE",
    });
  });

  test("recovers an empty stale lock directory using an injected test policy", async () => {
    const statePath = await temporaryStatePath();
    const lockPath = `${statePath}.lock`;
    await mkdir(lockPath);
    const staleAt = new Date(Date.now() - 1_000);
    await utimes(lockPath, staleAt, staleAt);
    const limiter = new SharedRateLimiter(
      { statePath },
      { policy: { staleLockMs: 10, lockRetryMs: 1, lockTimeoutMs: 100 } },
    );

    await limiter.beforeRequest(searchRequest);

    expect(await Bun.file(lockPath).exists()).toBe(false);
  });

  test("fails closed instead of bypassing an active lock after the injected timeout", async () => {
    const statePath = await temporaryStatePath();
    const clock = fakeClock(Date.now());
    await mkdir(`${statePath}.lock`);
    const limiter = new SharedRateLimiter(
      { statePath },
      {
        ...clock,
        policy: { staleLockMs: 60_000, lockRetryMs: 5, lockTimeoutMs: 10 },
      },
    );

    await expect(limiter.beforeRequest(searchRequest)).rejects.toMatchObject({
      kind: "api-unavailable",
      code: "RATE_LIMIT_STATE_UNAVAILABLE",
    });
    expect(await readdir(`${statePath}.lock`)).toEqual([]);
  });
});

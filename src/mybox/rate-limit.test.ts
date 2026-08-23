import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
});

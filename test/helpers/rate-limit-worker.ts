import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { SharedRateLimiter } from "../../src/mybox/rate-limit.ts";

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`missing rate-limit worker environment: ${name}`);
  }
  return value;
}

function numberEnvironment(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`invalid rate-limit worker environment: ${name}`);
  }
  return parsed;
}

const statePath = requiredEnvironment("MYBOX_RATE_LIMIT_WORKER_STATE_PATH");
const mode = requiredEnvironment("MYBOX_RATE_LIMIT_WORKER_MODE");
const readyDirectory = process.env.MYBOX_RATE_LIMIT_WORKER_READY_DIRECTORY;
const startFile = process.env.MYBOX_RATE_LIMIT_WORKER_START_FILE;
if ((readyDirectory === undefined) !== (startFile === undefined)) {
  throw new Error("incomplete rate-limit worker synchronization environment");
}
const limiter = new SharedRateLimiter(
  { statePath },
  {
    policy: {
      searchRequestLimit: numberEnvironment("MYBOX_RATE_LIMIT_WORKER_LIMIT", 1),
      searchWindowMs: numberEnvironment("MYBOX_RATE_LIMIT_WORKER_WINDOW_MS", 200),
      lockRetryMs: 5,
      lockTimeoutMs: 2_000,
      staleLockMs: 2_000,
    },
  },
);
const request = {
  method: "GET",
  url: new URL(
    "https://open-api.mybox.naver.com/v1/search/resources/folders?query=worker-query-secret" +
      "&pat=worker-pat-secret&body=worker-body-secret",
  ),
};

if (readyDirectory !== undefined && startFile !== undefined) {
  await writeFile(join(readyDirectory, String(process.pid)), "");
  while (!(await Bun.file(startFile).exists())) {
    await Bun.sleep(5);
  }
}

const requestedAt = Date.now();
if (mode === "reserve") {
  await limiter.beforeRequest(request);
} else if (mode === "cooldown") {
  await limiter.recordResponse(request, {
    status: 429,
    headers: new Headers({
      "Retry-After": requiredEnvironment("MYBOX_RATE_LIMIT_WORKER_RETRY_AFTER"),
    }),
  });
} else {
  throw new Error("invalid rate-limit worker mode");
}

process.stdout.write(`${JSON.stringify({ durationMs: Date.now() - requestedAt })}\n`);

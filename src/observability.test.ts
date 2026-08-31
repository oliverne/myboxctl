import { describe, expect, test } from "bun:test";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MyboxClient } from "./mybox/client.ts";
import { SharedRateLimiter } from "./mybox/rate-limit.ts";
import { MyboxUploader } from "./mybox/upload.ts";
import type { ObservabilityEventInput } from "./observability.ts";

describe("observability event boundaries", () => {
  test("distinguishes local quota wait start and completion", async () => {
    const directory = await mkdtemp(join(tmpdir(), "myboxctl-events-rate-"));
    const events: ObservabilityEventInput[] = [];
    let now = 0;
    try {
      const limiter = new SharedRateLimiter(
        { statePath: join(directory, "state.json") },
        {
          now: () => now,
          sleep: async (ms) => {
            now += ms;
          },
          random: () => 0,
          eventSink: { emit: (event) => events.push(event) },
          policy: { searchRequestLimit: 1, searchWindowMs: 1_000 },
        },
      );
      const request = {
        method: "GET",
        url: new URL("https://open-api.mybox.naver.com/v1/search/resources/files"),
      };
      await limiter.beforeRequest(request);
      await limiter.beforeRequest(request);
      expect(events.map((event) => event.event)).toEqual([
        "rate-limit.wait-started",
        "rate-limit.wait-completed",
      ]);
      expect(events[0]).toMatchObject({
        level: "warning",
        data: { operation: "search", waitMs: 1_000, reason: "quota" },
      });

      events.length = 0;
      await limiter.recordResponse(request, {
        status: 429,
        headers: new Headers({ "Retry-After": "2" }),
      });
      await limiter.beforeRequest(request);
      expect(events[0]).toMatchObject({
        event: "rate-limit.wait-started",
        data: { operation: "search", waitMs: 2_000, reason: "server-cooldown" },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("reports one GET 429 fallback retry without exposing request data", async () => {
    const events: ObservabilityEventInput[] = [];
    const waits: number[] = [];
    let requests = 0;
    const client = new MyboxClient(
      { pat: "secret", baseUrl: "https://open-api.mybox.naver.com", timeoutMs: 1_000 },
      {
        fetch: (async () => {
          requests += 1;
          return requests === 1
            ? new Response(JSON.stringify({ code: "TOO_MANY_REQUESTS" }), { status: 429 })
            : Response.json({ ok: true });
        }) as unknown as typeof globalThis.fetch,
        sleep: async (ms) => {
          waits.push(ms);
        },
        random: () => 0,
        now: () => 0,
        eventSink: { emit: (event) => events.push(event) },
      },
    );

    await expect(client.requestJson("GET", "/test")).resolves.toEqual({ ok: true });
    expect(waits).toEqual([60_000]);
    expect(events).toEqual([
      {
        type: "event",
        level: "warning",
        event: "http.retry-scheduled",
        data: {
          operation: "request",
          attempt: 1,
          waitMs: 60_000,
          delaySource: "fallback",
          status: 429,
        },
      },
      {
        type: "event",
        level: "warning",
        event: "http.retry-completed",
        data: {
          operation: "request",
          attempt: 1,
          waitMs: 60_000,
          delaySource: "fallback",
          status: 429,
        },
      },
    ]);
  });

  test("emits throttled monotonic file-byte progress through completion", async () => {
    const directory = await mkdtemp(join(tmpdir(), "myboxctl-events-upload-"));
    const path = join(directory, "payload.bin");
    const size = 2 * 1_024 * 1_024;
    await writeFile(path, new Uint8Array(size));
    const handle = await open(path, "r");
    const events: ObservabilityEventInput[] = [];
    let now = 0;
    try {
      const uploader = new MyboxUploader({
        now: () => {
          now += 1_100;
          return now;
        },
        eventSink: { emit: (event) => events.push(event) },
        fetch: (async (_url, init) => {
          await new Response(init?.body).arrayBuffer();
          return Response.json({ resourceId: "resource-1", name: "payload.bin", fileSize: size });
        }) as typeof globalThis.fetch,
      });
      await uploader.uploadContent({
        uploadUrl: "https://upload.example.test/signed",
        fileHandle: handle,
        fileName: "payload.bin",
        fileSize: size,
        offset: 0,
        resume: false,
        signal: AbortSignal.timeout(5_000),
      });
      const progress = events.filter((event) => event.event.startsWith("upload.transfer-"));
      expect(progress.map((event) => event.event)).toEqual([
        "upload.transfer-started",
        "upload.transfer-progress",
        "upload.transfer-progress",
        "upload.transfer-completed",
      ]);
      const bytes = progress.map((event) =>
        "transferredBytes" in event.data ? event.data.transferredBytes : -1,
      );
      expect(bytes).toEqual([0, 1_024 * 1_024, size, size]);
    } finally {
      await handle.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

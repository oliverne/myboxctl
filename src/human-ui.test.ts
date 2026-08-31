import { describe, expect, test } from "bun:test";

import { createEventPresentation, type EventWriter } from "./human-ui.ts";
import type { ObservabilityEventInput } from "./observability.ts";

function capture(isTTY: boolean, columns = 80) {
  let output = "";
  const writer: EventWriter = {
    isTTY,
    columns,
    write(value) {
      output += value;
    },
  };
  return { writer, output: () => output };
}

function retryEvent(): ObservabilityEventInput {
  return {
    type: "event",
    level: "warning",
    event: "http.retry-scheduled",
    data: {
      operation: "resource-detail",
      status: 429,
      attempt: 1,
      waitMs: 60_000,
      delaySource: "fallback",
    },
  };
}

describe("event presentation", () => {
  test("writes warning events as independent JSON Lines", () => {
    const captured = capture(false);
    const presentation = createEventPresentation({
      command: "stat",
      json: true,
      writer: captured.writer,
    });
    presentation.sink.emit(retryEvent());
    expect(JSON.parse(captured.output())).toMatchObject({
      type: "event",
      event: "http.retry-scheduled",
      command: "stat",
    });
  });

  test("quiet suppresses events but not final human failures", () => {
    const captured = capture(false);
    const presentation = createEventPresentation({
      command: "stat",
      quiet: true,
      writer: captured.writer,
    });
    presentation.sink.emit(retryEvent());
    presentation.writeHumanFailure(new Error("hidden internal detail"));
    expect(captured.output()).toBe("Error: An unexpected internal error occurred.\n");
  });

  test("uses one redraw line for delayed TTY progress and cleans it before failure", () => {
    const captured = capture(true, 42);
    const presentation = createEventPresentation({ command: "upload", writer: captured.writer });
    presentation.sink.emit({
      type: "event",
      level: "info",
      event: "upload.transfer-progress",
      data: {
        transferredBytes: 512,
        totalBytes: 1_024,
        percent: 50,
        offset: 0,
        elapsedMs: 600,
      },
    });
    presentation.writeHumanFailure(new Error("boom"));
    expect(captured.output()).toContain("\r\u001b[2KUpload 50% 512B/1.0KiB\nError:");
  });

  test("default non-TTY hides info while verbose prints line logs", () => {
    const normal = capture(false);
    const verbose = capture(false);
    const event: ObservabilityEventInput = {
      type: "event",
      level: "info",
      event: "upload.stage-started",
      data: { stage: "reservation" },
    };
    createEventPresentation({ command: "put", writer: normal.writer }).sink.emit(event);
    createEventPresentation({ command: "put", verbose: true, writer: verbose.writer }).sink.emit(
      event,
    );
    expect(normal.output()).toBe("");
    expect(verbose.output()).toBe("Upload reservation started.\n");
  });

  test("TERM=dumb never emits cursor control even when stderr reports a TTY", () => {
    const captured = capture(true);
    const presentation = createEventPresentation({
      command: "upload",
      verbose: true,
      writer: captured.writer,
      env: { TERM: "dumb" },
    });
    presentation.sink.emit({
      type: "event",
      level: "info",
      event: "upload.transfer-progress",
      data: {
        transferredBytes: 512,
        totalBytes: 1_024,
        percent: 50,
        offset: 0,
        elapsedMs: 1_000,
      },
    });
    expect(captured.output()).not.toContain("\u001b");
    expect(captured.output()).not.toContain("\r");
    expect(captured.output()).toEndWith("\n");
  });

  test("NO_COLOR output stays free of color escape sequences", () => {
    const captured = capture(false);
    const presentation = createEventPresentation({
      command: "stat",
      writer: captured.writer,
      env: { NO_COLOR: "1" },
    });
    presentation.sink.emit(retryEvent());
    expect(captured.output()).not.toContain("\u001b[");
    expect(captured.output()).toContain("Warning: retrying resource-detail");
  });

  test("updates a TTY wait countdown and clears it on completion", () => {
    const captured = capture(true);
    let now = 0;
    let tick: (() => void) | undefined;
    let cleared = false;
    const presentation = createEventPresentation({
      command: "stat",
      writer: captured.writer,
      timer: {
        now: () => now,
        setInterval(callback) {
          tick = callback;
          return 1;
        },
        clearInterval() {
          cleared = true;
        },
      },
    });
    presentation.sink.emit({
      type: "event",
      level: "warning",
      event: "rate-limit.wait-started",
      data: { operation: "search", waitMs: 3_000, reason: "quota" },
    });
    now = 1_000;
    tick?.();
    presentation.sink.emit({
      type: "event",
      level: "warning",
      event: "rate-limit.wait-completed",
      data: { operation: "search", waitMs: 3_000, reason: "quota" },
    });
    expect(cleared).toBe(true);
    expect(captured.output()).toContain("Waiting for search: 2s remaining");
    expect(captured.output()).toEndWith("Rate limit wait completed for search.\n");
  });
});

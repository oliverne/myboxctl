import { normalizeError } from "./errors.ts";
import type { EventSink, ObservabilityEvent } from "./observability.ts";
import { renderJson, sanitizeForOutput } from "./output.ts";

export type EventWriter = {
  write(value: string): void;
  isTTY: boolean;
  columns: number;
};

export type EventPresentationOptions = {
  command: string;
  json?: boolean;
  verbose?: boolean;
  quiet?: boolean;
  writer?: EventWriter;
  env?: Record<string, string | undefined>;
  timer?: {
    now(): number;
    setInterval(callback: () => void, ms: number): unknown;
    clearInterval(handle: unknown): void;
  };
  additionalSink?: EventSink;
};

export type EventPresentation = {
  sink: EventSink;
  finish(): void;
  writeHumanFailure(error: unknown): void;
};

function defaultWriter(): EventWriter {
  return {
    write: (value) => process.stderr.write(value),
    isTTY: process.stderr.isTTY === true,
    columns: process.stderr.columns ?? 80,
  };
}

function formatDuration(ms: number): string {
  if (ms < 1_000) {
    return `${Math.ceil(ms)}ms`;
  }
  return `${Math.ceil(ms / 1_000)}s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) {
    return `${bytes}B`;
  }
  if (bytes < 1_024 * 1_024) {
    return `${(bytes / 1_024).toFixed(1)}KiB`;
  }
  return `${(bytes / (1_024 * 1_024)).toFixed(1)}MiB`;
}

function humanEvent(event: ObservabilityEvent, columns: number, verbose: boolean): string {
  if (event.event === "rate-limit.wait-started") {
    return `Warning: waiting ${formatDuration(event.data.waitMs)} for ${event.data.operation} rate limit (${event.data.reason}).`;
  }
  if (event.event === "rate-limit.wait-completed") {
    return `Rate limit wait completed for ${event.data.operation}.`;
  }
  if (event.event === "http.retry-scheduled") {
    return `Warning: retrying ${event.data.operation} in ${formatDuration(event.data.waitMs)} (${event.data.delaySource}).`;
  }
  if (event.event === "http.retry-completed") {
    return `Retry wait completed for ${event.data.operation}.`;
  }
  if (event.event === "upload.resume") {
    return `Warning: resuming upload from ${formatBytes(event.data.offset)} of ${formatBytes(event.data.totalBytes)}.`;
  }
  if (event.event === "upload.stage-started") {
    return `Upload ${event.data.stage} started.`;
  }
  if (event.event === "upload.stage-completed") {
    return `Upload ${event.data.stage} completed${event.data.elapsedMs === undefined ? "" : ` in ${formatDuration(event.data.elapsedMs)}`}.`;
  }
  if (event.event === "download.quota-advisory") {
    return `${event.level === "warning" ? "Warning: " : ""}Recursive download will request ${event.data.expectedDownloads} download URLs (daily reference limit ${event.data.dailyLimit}${event.data.isDefault ? ", conservative default" : `, plan ${event.data.plan}`}).`;
  }
  if (event.event.startsWith("download.transfer-")) {
    const data = (
      event as Extract<
        ObservabilityEvent,
        {
          event:
            | "download.transfer-started"
            | "download.transfer-progress"
            | "download.transfer-completed";
        }
      >
    ).data;
    const label = data.relativePath === undefined ? "Download" : `Download ${data.relativePath}`;
    return `${label} ${Math.floor(data.percent)}% ${formatBytes(data.transferredBytes)}/${formatBytes(data.totalBytes)}`;
  }

  const data = (
    event as Extract<
      ObservabilityEvent,
      {
        event: "upload.transfer-started" | "upload.transfer-progress" | "upload.transfer-completed";
      }
    >
  ).data;
  const percent = `${Math.floor(data.percent)}%`;
  const bytes = `${formatBytes(data.transferredBytes)}/${formatBytes(data.totalBytes)}`;
  if (columns < 48) {
    return `Upload ${percent} ${bytes}`;
  }
  const usable = Math.max(8, Math.min(24, columns - 42));
  const complete = Math.min(usable, Math.round((usable * data.percent) / 100));
  const bar = `${"#".repeat(complete)}${"-".repeat(usable - complete)}`;
  const bytesPerSecond = data.elapsedMs > 0 ? data.transferredBytes / (data.elapsedMs / 1_000) : 0;
  const speed =
    verbose && bytesPerSecond > 0 ? ` ${(bytesPerSecond / (1_024 * 1_024)).toFixed(1)}MiB/s` : "";
  const eta =
    verbose && bytesPerSecond > 0 && data.transferredBytes < data.totalBytes
      ? ` ETA ${formatDuration(((data.totalBytes - data.transferredBytes) / bytesPerSecond) * 1_000)}`
      : "";
  return `Upload [${bar}] ${percent} ${bytes}${speed}${eta}`;
}

function shouldRender(event: ObservabilityEvent, options: EventPresentationOptions): boolean {
  if (options.quiet) {
    return false;
  }
  if (options.json === true && options.verbose !== true) {
    return false;
  }
  if (options.verbose) {
    return true;
  }
  if (event.level === "warning") {
    return true;
  }
  if (
    options.json !== true &&
    options.writer?.isTTY === true &&
    (event.event === "upload.transfer-started" ||
      event.event === "upload.transfer-progress" ||
      event.event === "upload.transfer-completed" ||
      event.event === "download.transfer-started" ||
      event.event === "download.transfer-progress" ||
      event.event === "download.transfer-completed")
  ) {
    return event.data.elapsedMs >= 500;
  }
  return false;
}

export function createEventPresentation(options: EventPresentationOptions): EventPresentation {
  const env = options.env ?? (options.writer === undefined ? process.env : {});
  const baseWriter = options.writer ?? defaultWriter();
  const writer = {
    ...baseWriter,
    isTTY: baseWriter.isTTY && env.TERM !== "dumb",
  };
  const resolved = { ...options, writer };
  let activeLine = false;
  const timer =
    options.timer ??
    ({
      now: () => Date.now(),
      setInterval: (callback, ms) => setInterval(callback, ms),
      clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
    } satisfies NonNullable<EventPresentationOptions["timer"]>);
  let countdown: { handle: unknown; endsAt: number; label: string } | undefined;

  const finishActiveLine = () => {
    if (activeLine) {
      writer.write("\n");
      activeLine = false;
    }
  };

  const stopCountdown = () => {
    if (countdown !== undefined) {
      timer.clearInterval(countdown.handle);
      countdown = undefined;
      finishActiveLine();
    }
  };

  const redrawCountdown = () => {
    if (countdown === undefined) return;
    const remaining = Math.max(0, countdown.endsAt - timer.now());
    writer.write(`\r\u001b[2K${countdown.label}: ${formatDuration(remaining)} remaining`);
    activeLine = true;
  };

  const startCountdown = (label: string, waitMs: number) => {
    if (!writer.isTTY || resolved.json || resolved.quiet || waitMs < 1_000) return;
    stopCountdown();
    const entry = { handle: undefined as unknown, endsAt: timer.now() + waitMs, label };
    entry.handle = timer.setInterval(redrawCountdown, 1_000);
    countdown = entry;
    redrawCountdown();
  };

  const finish = () => {
    stopCountdown();
    finishActiveLine();
  };

  const sink: EventSink = {
    emit(event) {
      options.additionalSink?.emit(event);
      const contextualEvent = { ...event, command: options.command } as ObservabilityEvent;
      if (!shouldRender(contextualEvent, resolved)) {
        return;
      }
      if (
        contextualEvent.event === "rate-limit.wait-completed" ||
        contextualEvent.event === "http.retry-completed"
      ) {
        stopCountdown();
      }
      if (resolved.json) {
        finishActiveLine();
        writer.write(renderJson(sanitizeForOutput(contextualEvent)));
        return;
      }

      const line = humanEvent(contextualEvent, writer.columns, resolved.verbose === true);
      const progress =
        contextualEvent.event.startsWith("upload.transfer-") ||
        contextualEvent.event.startsWith("download.transfer-");
      if (writer.isTTY && progress) {
        writer.write(`\r\u001b[2K${line}`);
        activeLine = true;
        if (
          contextualEvent.event === "upload.transfer-completed" ||
          contextualEvent.event === "download.transfer-completed"
        ) {
          finishActiveLine();
        }
        return;
      }
      finishActiveLine();
      writer.write(`${line}\n`);
      if (contextualEvent.event === "rate-limit.wait-started") {
        startCountdown(
          `Waiting for ${contextualEvent.data.operation}`,
          contextualEvent.data.waitMs,
        );
      } else if (contextualEvent.event === "http.retry-scheduled") {
        startCountdown(`Retrying ${contextualEvent.data.operation}`, contextualEvent.data.waitMs);
      }
    },
  };

  return {
    sink,
    finish,
    writeHumanFailure(error) {
      finish();
      const normalized = normalizeError(error);
      const serialized = normalized.toJSON();
      writer.write(`Error: ${serialized.message}\n`);
      if (serialized.code !== undefined) {
        writer.write(`Code: ${serialized.code}\n`);
      }
      if (serialized.requestId !== undefined) {
        writer.write(`Request ID: ${serialized.requestId}\n`);
      }
      if (serialized.retryAfterMs !== undefined) {
        writer.write(`Retry after: ${formatDuration(serialized.retryAfterMs)}\n`);
      }
      if (serialized.partialTransfer !== undefined) {
        const partial = serialized.partialTransfer;
        writer.write(
          `Partial transfer: ${partial.filesCompleted} files, ${partial.foldersCompleted} folders, ${formatBytes(partial.bytesCompleted)} completed${partial.mutationMayHaveOccurred ? "; mutation may have occurred" : ""}.\n`,
        );
      }
    },
  };
}

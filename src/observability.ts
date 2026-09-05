export type EventLevel = "info" | "warning";

export type WaitReason = "quota" | "server-cooldown";
export type RetryDelaySource = "backoff" | "retry-after" | "fallback";

type EventBase<Name extends string, Data> = {
  type: "event";
  level: EventLevel;
  event: Name;
  data: Data;
};

export type ObservabilityEventInput =
  | EventBase<
      "rate-limit.wait-started" | "rate-limit.wait-completed",
      { operation: string; waitMs: number; reason: WaitReason }
    >
  | EventBase<
      "http.retry-scheduled" | "http.retry-completed",
      {
        operation: string;
        attempt: number;
        waitMs: number;
        delaySource: RetryDelaySource;
        status?: number;
      }
    >
  | EventBase<
      "upload.stage-started" | "upload.stage-completed",
      { stage: "reservation" | "transfer" | "postcondition"; elapsedMs?: number }
    >
  | EventBase<
      "upload.transfer-started" | "upload.transfer-progress" | "upload.transfer-completed",
      {
        transferredBytes: number;
        totalBytes: number;
        percent: number;
        offset: number;
        elapsedMs: number;
      }
    >
  | EventBase<"upload.resume", { offset: number; totalBytes: number }>
  | EventBase<
      "download.transfer-started" | "download.transfer-progress" | "download.transfer-completed",
      {
        transferredBytes: number;
        totalBytes: number;
        percent: number;
        elapsedMs: number;
        relativePath?: string;
        filesCompleted?: number;
        totalFiles?: number;
      }
    >
  | EventBase<
      "download.quota-advisory",
      { plan: string | null; isDefault: boolean; expectedDownloads: number; dailyLimit: number }
    >;

export type ObservabilityEvent = ObservabilityEventInput & { command: string };

export type EventSink = {
  emit(event: ObservabilityEventInput): void;
};

export const noOpEventSink: EventSink = {
  emit: () => undefined,
};

export function eventSinkFrom(
  emit: ((event: ObservabilityEventInput) => void) | undefined,
): EventSink {
  return emit === undefined ? noOpEventSink : { emit };
}

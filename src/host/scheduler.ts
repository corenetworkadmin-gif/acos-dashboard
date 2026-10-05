import { createHash } from "node:crypto";

// Scheduler and event bus (architecture 26, 27, 31). Scheduled and event-triggered
// work is durable and always routed through the ordinary operation pipeline, so
// autonomy never implies additional authority. This module holds the pure,
// deterministic logic; the host runtime owns persistence and execution.

export type ScheduleKind = "interval" | "event";

export interface ScheduledTask {
  id: string;
  name: string;
  capability: string;
  action: string;
  target: string;
  input: string;
  kind: ScheduleKind;
  intervalMs: number | null;
  eventName: string | null;
  enabled: boolean;
  created: number;
  lastRun: number | null;
  nextRun: number | null;
  runs: number;
  idempotencyKey: string | null;
}

export interface EventRecord {
  id: string;
  timestamp: number;
  name: string;
  detail: string;
}

// Recovery journal markers (architecture 40). Order matters: it is the vocabulary
// a durable update writes as it progresses, and the last marker decides recovery.
export const journalMarkers = [
  "UPDATE_STARTED",
  "SNAPSHOT_CREATED",
  "OLD_STATE_PRESERVED",
  "NEW_STATE_ACTIVATION_STARTED",
  "HEALTH_CHECK_PENDING",
] as const;
export type JournalMarker = (typeof journalMarkers)[number];

export interface JournalEntry {
  id: string;
  operationId: string;
  marker: JournalMarker;
  timestamp: number;
  detail: string;
  resolved: boolean;
}

export type RecoveryDecision = "ROLL_FORWARD" | "ROLLBACK" | "RECOVERY_REQUIRED";

export interface RecoveryAction {
  operationId: string;
  lastMarker: JournalMarker;
  decision: RecoveryDecision;
  reason: string;
}

export interface IdempotencyRecord {
  operationId: string;
  status:
    | "RUNNING"
    | "COMPLETED"
    | "FAILED"
    | "CANCELLED"
    | "RECOVERY_REQUIRED";
  timestamp: number;
}

// Idempotency key derivation (architecture 37). A stable digest of the canonical
// operation description plus the caller key means identical retries collapse onto
// the same record even across restarts.
export function idempotencyDigest(
  capability: string,
  action: string,
  target: string,
  input: string,
  key: string,
): string {
  return createHash("sha256")
    .update(JSON.stringify({ capability, action, target, input, key }))
    .digest("hex");
}

// Interval scheduling anchors the next run to the previous scheduled time so long
// work cannot silently drift the cadence forward.
export function nextIntervalRun(task: ScheduledTask, now: number): number {
  const interval = task.intervalMs ?? 0;
  if (interval <= 0) return now;
  const base = task.nextRun ?? task.lastRun ?? now;
  let next = base + interval;
  while (next <= now) next += interval;
  return next;
}

export function dueIntervalTasks(
  tasks: ScheduledTask[],
  now: number,
): ScheduledTask[] {
  return tasks.filter(
    (task) =>
      task.enabled &&
      task.kind === "interval" &&
      task.nextRun !== null &&
      task.nextRun <= now,
  );
}

export function eventTasks(
  tasks: ScheduledTask[],
  name: string,
): ScheduledTask[] {
  return tasks.filter(
    (task) =>
      task.enabled && task.kind === "event" && task.eventName === name,
  );
}

// Recovery reconciliation (architecture 40). The last unresolved marker decides
// whether the system rolls forward, rolls back, or demands explicit recovery.
// Anything ambiguous fails closed to RECOVERY_REQUIRED.
export function reconcileJournal(entries: JournalEntry[]): RecoveryAction[] {
  const byOperation = new Map<string, JournalEntry[]>();
  for (const entry of entries) {
    if (entry.resolved) continue;
    const list = byOperation.get(entry.operationId) ?? [];
    list.push(entry);
    byOperation.set(entry.operationId, list);
  }
  const actions: RecoveryAction[] = [];
  for (const [operationId, list] of byOperation) {
    list.sort((a, b) => a.timestamp - b.timestamp);
    const last = list[list.length - 1];
    let decision: RecoveryDecision;
    let reason: string;
    switch (last.marker) {
      case "UPDATE_STARTED":
        decision = "ROLLBACK";
        reason =
          "Update started but no snapshot was taken; the last committed state is authoritative.";
        break;
      case "SNAPSHOT_CREATED":
      case "OLD_STATE_PRESERVED":
        decision = "ROLLBACK";
        reason =
          "A preserved snapshot exists and activation never started; roll back to the preserved state.";
        break;
      case "NEW_STATE_ACTIVATION_STARTED":
        decision = "RECOVERY_REQUIRED";
        reason =
          "New-state activation began and did not finish; the outcome is ambiguous and requires an administrator.";
        break;
      case "HEALTH_CHECK_PENDING":
        decision = "ROLL_FORWARD";
        reason =
          "New state was activated and only verification remained; roll forward and re-verify integrity.";
        break;
    }
    actions.push({ operationId, lastMarker: last.marker, decision, reason });
  }
  return actions;
}

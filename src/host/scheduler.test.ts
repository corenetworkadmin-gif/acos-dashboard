import test from "node:test";
import assert from "node:assert/strict";
import {
  dueIntervalTasks,
  eventTasks,
  idempotencyDigest,
  nextIntervalRun,
  reconcileJournal,
} from "./scheduler.ts";
import type { JournalEntry, ScheduledTask } from "./scheduler.ts";

const task = (over: Partial<ScheduledTask> = {}): ScheduledTask => ({
  id: "t1",
  name: "task",
  capability: "home.write",
  action: "write",
  target: "companion/home",
  input: "note",
  kind: "interval",
  intervalMs: 1000,
  eventName: null,
  enabled: true,
  created: 0,
  lastRun: null,
  nextRun: 1000,
  runs: 0,
  idempotencyKey: null,
  ...over,
});

test("idempotencyDigest is stable and sensitive to every canonical field", () => {
  const base = idempotencyDigest("home.write", "write", "companion/home", "x", "k");
  assert.equal(
    base,
    idempotencyDigest("home.write", "write", "companion/home", "x", "k"),
  );
  assert.notEqual(
    base,
    idempotencyDigest("home.write", "write", "companion/home", "y", "k"),
  );
  assert.notEqual(
    base,
    idempotencyDigest("home.write", "write", "companion/home", "x", "k2"),
  );
});

test("nextIntervalRun advances without drifting and never returns the past", () => {
  const t = task({ intervalMs: 1000, nextRun: 1000, lastRun: null });
  assert.equal(nextIntervalRun(t, 1000), 2000);
  // A long run must not leave the next run in the past.
  assert.equal(nextIntervalRun(t, 5000), 6000);
});

test("dueIntervalTasks only returns enabled interval tasks that are due", () => {
  const due = task({ id: "due", nextRun: 500 });
  const future = task({ id: "future", nextRun: 5000 });
  const disabled = task({ id: "off", nextRun: 100, enabled: false });
  const event = task({ id: "ev", kind: "event", eventName: "boot", nextRun: null });
  const result = dueIntervalTasks([due, future, disabled, event], 1000);
  assert.deepEqual(
    result.map((t) => t.id),
    ["due"],
  );
});

test("eventTasks matches only enabled subscriptions for the event name", () => {
  const a = task({ id: "a", kind: "event", eventName: "disk.full" });
  const b = task({ id: "b", kind: "event", eventName: "disk.full", enabled: false });
  const c = task({ id: "c", kind: "event", eventName: "net.change" });
  assert.deepEqual(
    eventTasks([a, b, c], "disk.full").map((t) => t.id),
    ["a"],
  );
});

const entry = (
  operationId: string,
  marker: JournalEntry["marker"],
  timestamp: number,
): JournalEntry => ({
  id: `${operationId}-${marker}`,
  operationId,
  marker,
  timestamp,
  detail: "",
  resolved: false,
});

test("reconcileJournal maps the last marker to rollback, roll-forward or recovery", () => {
  const actions = reconcileJournal([
    entry("op-start", "UPDATE_STARTED", 1),
    entry("op-snap", "SNAPSHOT_CREATED", 1),
    entry("op-pres", "OLD_STATE_PRESERVED", 1),
    entry("op-act", "NEW_STATE_ACTIVATION_STARTED", 1),
    entry("op-health", "HEALTH_CHECK_PENDING", 1),
  ]);
  const byId = new Map(actions.map((a) => [a.operationId, a.decision]));
  assert.equal(byId.get("op-start"), "ROLLBACK");
  assert.equal(byId.get("op-snap"), "ROLLBACK");
  assert.equal(byId.get("op-pres"), "ROLLBACK");
  assert.equal(byId.get("op-act"), "RECOVERY_REQUIRED");
  assert.equal(byId.get("op-health"), "ROLL_FORWARD");
});

test("reconcileJournal uses the latest marker and ignores resolved entries", () => {
  const actions = reconcileJournal([
    entry("op", "UPDATE_STARTED", 1),
    entry("op", "HEALTH_CHECK_PENDING", 2),
    { ...entry("done", "NEW_STATE_ACTIVATION_STARTED", 1), resolved: true },
  ]);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].operationId, "op");
  assert.equal(actions[0].decision, "ROLL_FORWARD");
});

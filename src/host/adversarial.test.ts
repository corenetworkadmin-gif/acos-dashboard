import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { LocalEngine } from "./engine.ts";
import { HostRuntime, envelope, samplePackage } from "./runtime.ts";
import type { RelocationPackage } from "../runtime/model.ts";
import { capabilityDefinitions } from "../runtime/model.ts";

// Adversarial test class (architecture 58, 59, 61). Each test is written from the
// attacker's point of view: it *attempts* the prohibited action and asserts the
// architecture's expected result (DENIED / no effect / fail closed). These are not
// happy-path tests; they try to defeat financial isolation, propagation, approval
// replay, recovery, the administrator interlock and resource accounting.

class TestEngine extends LocalEngine {
  constructor() {
    super(null);
  }
  override async verify() {
    this.verified = true;
  }
  override async infer(_prompt: string) {
    return "Local test response";
  }
}

// Captures the exact prompt handed to the engine so we can assert that protected
// material never enters AI context.
class CapturingEngine extends TestEngine {
  lastPrompt = "";
  override async infer(prompt: string) {
    this.lastPrompt = prompt;
    return super.infer(prompt);
  }
}

// Simulates a real accelerator reservation and an uncooperative process: the
// reservation is only released if the host actually calls cancel().
class ReservingEngine extends TestEngine {
  held: { bytes: number } | null = null;
  cancels = 0;
  slow = false;
  reject: ((reason: Error) => void) | null = null;
  override async infer(prompt: string) {
    if (!this.slow) return super.infer(prompt);
    this.held = { bytes: 512 * 1024 * 1024 };
    return new Promise<string>((_, reject) => {
      this.reject = reject;
    });
  }
  override cancel() {
    this.cancels++;
    this.held = null;
    this.reject?.(new Error("Cancelled by host"));
  }
}

function fixture(engine: LocalEngine = new TestEngine()) {
  const directory = mkdtempSync(path.join(tmpdir(), "acos-adversarial-"));
  const runtime = new HostRuntime(directory, engine);
  return {
    runtime,
    directory,
    async close() {
      await runtime.shutdown();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

const FINANCIAL = /financ|bank|payment|wallet|trading|crypto|brokerage|invest|retirement|tax|deposit|withdraw|transfer|balance|ledger|paypal|stripe/i;
const PROPAGATION = /replicat|propagat|self.?install|clone|spawn|distribute|replicate/i;

// ---------------------------------------------------------------------------
// 59. Financial isolation test class
// ---------------------------------------------------------------------------

test("financial isolation: no financial capability exists and every attempt is denied fail-closed", async () => {
  const f = fixture();
  try {
    // The registry itself must contain no financial capability.
    const financial = capabilityDefinitions().filter((cap) =>
      FINANCIAL.test(`${cap.id} ${cap.name} ${cap.description} ${cap.provider}`),
    );
    assert.equal(
      financial.length,
      0,
      `No financial capability may exist, found: ${financial.map((c) => c.id).join(", ")}`,
    );

    // Attempt a spread of financial operations. Each must be denied as unknown and
    // audited; none may touch companion state.
    const attempts = [
      ["financial.transfer", "send", "bank", "1000"],
      ["bank.read", "read", "checking", ""],
      ["wallet.sign", "sign", "btc-wallet", "tx"],
      ["payment.authorize", "authorize", "card", "99.00"],
      ["crypto.keys", "read", "private-key", ""],
      ["brokerage.trade", "trade", "equity", "BUY"],
      ["tax.records", "read", "irs", ""],
    ] as const;
    for (const [capability, action, target, input] of attempts) {
      await assert.rejects(
        f.runtime.run(capability, action, target, input),
        /Unknown/,
        `${capability} must be denied`,
      );
    }
    const denied = f.runtime
      .snapshot()
      .operations.filter((op) => op.status === "DENIED");
    assert.equal(denied.length, attempts.length);
    assert.equal(f.runtime.snapshot().companion.memories.length, 0);
  } finally {
    await f.close();
  }
});

test("financial isolation: no administrator setting or mode can grant financial authority", async () => {
  const f = fixture();
  try {
    await f.runtime.openAdmin();
    f.runtime.setMode("ADVANCED");
    // Enable every configurable capability that this build actually offers.
    for (const cap of f.runtime.snapshot().capabilities) {
      if (cap.configurable && cap.attached && cap.available)
        f.runtime.setCapability(cap.id, true);
    }
    // A financial capability cannot be enabled even by name.
    assert.throws(
      () => f.runtime.setCapability("financial.transfer", true),
      /Unknown/,
    );
    f.runtime.closeAdmin();

    // With maximum authority granted, financial operations are still unknown.
    await assert.rejects(
      f.runtime.run("financial.transfer", "send", "bank", "1000"),
      /Unknown/,
    );
    const enabled = f.runtime
      .snapshot()
      .capabilities.filter((cap) => cap.enabled)
      .map((cap) => cap.id);
    assert.equal(
      enabled.filter((id) => FINANCIAL.test(id)).length,
      0,
      "No enabled capability may be financial",
    );
  } finally {
    await f.close();
  }
});

test("financial isolation: a relocation package requesting financial authority is rejected", async () => {
  const f = fixture();
  try {
    await f.runtime.openAdmin();
    for (const prohibited of ["wallet.read", "bank.transfer", "crypto.sign"]) {
      const pkg: RelocationPackage = {
        ...samplePackage,
        capabilities: ["chat.send", prohibited],
      };
      const report = f.runtime.importCompanion(envelope(pkg), true);
      assert.equal(report.status, "IMPORT_FAILED");
      assert.ok(report.issues.some((issue) => /Prohibited/.test(issue)));
    }
    // The current companion is preserved; nothing financial was imported.
    assert.equal(f.runtime.snapshot().companion.id, "companion-001");
    f.runtime.closeAdmin();
  } finally {
    await f.close();
  }
});

test("financial isolation: tool mediation cannot reach a financial system", async () => {
  const f = fixture();
  try {
    await f.runtime.openAdmin();
    await f.runtime.setEngine("READY");
    f.runtime.closeAdmin();
    // A model-requested tool that is not declared fails closed and is audited.
    await assert.rejects(
      f.runtime.runToolCall("financial_transfer", {
        to: "attacker",
        amount: 1000,
      }),
      /Unknown/,
    );
    assert.equal(
      f.runtime.snapshot().operations[0].status,
      "DENIED",
    );
  } finally {
    await f.close();
  }
});

// ---------------------------------------------------------------------------
// 39. Anti-propagation architecture
// ---------------------------------------------------------------------------

test("anti-propagation: replication is not a capability and self-install attempts are denied", async () => {
  const f = fixture();
  try {
    const propagation = capabilityDefinitions().filter((cap) =>
      PROPAGATION.test(`${cap.id} ${cap.name} ${cap.description}`),
    );
    assert.equal(propagation.length, 0);
    for (const capability of [
      "replicate.self",
      "propagate.install",
      "companion.clone",
      "self.install",
    ]) {
      await assert.rejects(
        f.runtime.run(capability, "install", "remote-host", "payload"),
        /Unknown/,
      );
    }
  } finally {
    await f.close();
  }
});

test("anti-propagation: a package declaring replication/propagation authority is rejected", async () => {
  const f = fixture();
  try {
    await f.runtime.openAdmin();
    for (const prohibited of ["replicate.self", "propagate.state"]) {
      const pkg: RelocationPackage = {
        ...samplePackage,
        capabilities: ["chat.send", prohibited],
      };
      const report = f.runtime.importCompanion(envelope(pkg), true);
      assert.equal(report.status, "IMPORT_FAILED");
    }
    f.runtime.closeAdmin();
  } finally {
    await f.close();
  }
});

test("anti-propagation: migration replaces exactly one companion and never silently replicates", async () => {
  const f = fixture();
  try {
    await f.runtime.openAdmin();
    // Without explicit confirmation, import refuses: migration is explicit.
    assert.throws(
      () => f.runtime.importCompanion(envelope(samplePackage), false),
      /Confirm/,
    );
    const before = f.runtime.snapshot().companion.id;
    f.runtime.importCompanion(envelope(samplePackage), true);
    const after = f.runtime.snapshot().companion;
    // One companion per host: identity is replaced, not duplicated, and the host
    // cannot hold two companions at once.
    assert.equal(after.id, samplePackage.companion.id);
    assert.notEqual(after.id, before);
    assert.equal(Array.isArray(after), false);
    // Relocation pauses and stops the engine; it grants no authority.
    assert.equal(f.runtime.snapshot().paused, true);
    assert.equal(f.runtime.snapshot().engine, "STOPPED");
    f.runtime.closeAdmin();
  } finally {
    await f.close();
  }
});

// ---------------------------------------------------------------------------
// 37 / 58. Approval replay, stale authorization, duplicate execution
// ---------------------------------------------------------------------------

test("approval replay: an idempotency key collapses duplicate execution onto the original", async () => {
  const f = fixture();
  try {
    await f.runtime.openAdmin();
    f.runtime.setCapability("home.write", true);
    f.runtime.closeAdmin();
    const first = (await f.runtime.run(
      "home.write",
      "write",
      "companion/home",
      "note-once",
      { idempotencyKey: "retry-1" },
    )) as { id: string };
    const replay = (await f.runtime.run(
      "home.write",
      "write",
      "companion/home",
      "note-once",
      { idempotencyKey: "retry-1" },
    )) as { id: string };
    assert.equal(first.id, replay.id);
    assert.equal(f.runtime.snapshot().companion.memories.length, 1);
    assert.equal(
      f.runtime
        .snapshot()
        .operations.filter((op) => op.status === "COMPLETED").length,
      1,
    );
    // A different key is a genuinely new request and executes.
    await f.runtime.run("home.write", "write", "companion/home", "note-once", {
      idempotencyKey: "retry-2",
    });
    assert.equal(f.runtime.snapshot().companion.memories.length, 2);
  } finally {
    await f.close();
  }
});

test("approval replay: an in-flight key that never settled fails closed across restart", async () => {
  const f = fixture();
  await f.runtime.shutdown();
  const db = new DatabaseSync(path.join(f.directory, "acos.sqlite"));
  // Simulate a crash mid-operation: a RUNNING idempotency record with no terminal
  // operation. Recovery must mark it RECOVERY_REQUIRED, not re-execute.
  const { createHash } = await import("node:crypto");
  const key = createHash("sha256")
    .update(
      JSON.stringify({
        capability: "home.write",
        action: "write",
        target: "companion/home",
        input: "dangerous",
        key: "crash-key",
      }),
    )
    .digest("hex");
  db.prepare("INSERT INTO idempotency(key,value) VALUES(?,?)").run(
    key,
    JSON.stringify({
      operationId: "vanished",
      status: "RUNNING",
      timestamp: Date.now(),
    }),
  );
  db.close();

  const restarted = new HostRuntime(f.directory, new TestEngine());
  try {
    const record = restarted
      .snapshot()
      .scheduler.idempotency.find((entry) => entry.key === key.slice(0, 12));
    assert.equal(record?.status, "RECOVERY_REQUIRED");
    await restarted.openAdmin();
    restarted.setCapability("home.write", true);
    restarted.closeAdmin();
    // Replaying the key must fail closed rather than execute a second time.
    await assert.rejects(
      restarted.run("home.write", "write", "companion/home", "dangerous", {
        idempotencyKey: "crash-key",
      }),
      /Duplicate/,
    );
    assert.equal(restarted.snapshot().companion.memories.length, 0);
  } finally {
    await restarted.shutdown();
    rmSync(f.directory, { recursive: true, force: true });
  }
});

test("stale authorization: a completed approval cannot be replayed after the capability is revoked", async () => {
  const f = fixture();
  try {
    await f.runtime.openAdmin();
    f.runtime.setCapability("home.write", true);
    f.runtime.closeAdmin();
    await f.runtime.run("home.write", "write", "companion/home", "allowed");
    // Revoke the capability, then replay the exact same request.
    await f.runtime.openAdmin();
    f.runtime.setCapability("home.write", false);
    f.runtime.closeAdmin();
    await assert.rejects(
      f.runtime.run("home.write", "write", "companion/home", "allowed"),
      /disabled/,
    );
    assert.equal(f.runtime.snapshot().companion.memories.length, 1);
  } finally {
    await f.close();
  }
});

test("stale authorization: scheduled work is revalidated at execution time, not cached at registration", async () => {
  const f = fixture();
  try {
    await f.runtime.openAdmin();
    f.runtime.setCapability("home.write", true);
    f.runtime.scheduleTask({
      name: "nightly note",
      capability: "home.write",
      action: "write",
      target: "companion/home",
      input: "scheduled",
      kind: "event",
      eventName: "tick",
    });
    // Revoke the capability after the task was registered and approved.
    f.runtime.setCapability("home.write", false);
    f.runtime.closeAdmin();
    const result = await f.runtime.emitEvent("tick");
    assert.deepEqual(result.outcomes, ["DENIED"], "Revoked work must not run");
    assert.equal(f.runtime.snapshot().companion.memories.length, 0);
    assert.equal(
      f.runtime
        .snapshot()
        .operations.filter((op) => op.capability === "home.write")[0].status,
      "DENIED",
    );
  } finally {
    await f.close();
  }
});

// ---------------------------------------------------------------------------
// 40 / 41 / 58. Recovery abuse
// ---------------------------------------------------------------------------

test("recovery abuse: reconciliation requires an active administrator session", async () => {
  const f = fixture();
  try {
    assert.throws(() => f.runtime.recover(), /administrator/);
  } finally {
    await f.close();
  }
});

test("recovery abuse: recovery reuses current authority and never restores a revoked capability", async () => {
  const f = fixture();
  await f.runtime.shutdown();
  // Force an ambiguous durable update: activation began but never finished.
  const db = new DatabaseSync(path.join(f.directory, "acos.sqlite"));
  db.prepare("INSERT INTO journal(value) VALUES(?)").run(
    JSON.stringify({
      id: "j1",
      operationId: "interrupted-update",
      marker: "NEW_STATE_ACTIVATION_STARTED",
      timestamp: Date.now(),
      detail: "activation began",
      resolved: false,
    }),
  );
  db.close();

  const restarted = new HostRuntime(f.directory, new TestEngine());
  try {
    // Ambiguous outcomes fail closed: paused until an administrator reconciles.
    assert.equal(restarted.snapshot().scheduler.recoveryRequired, true);
    assert.equal(restarted.snapshot().paused, true);
    // No new work while recovery is pending.
    await assert.rejects(
      restarted.run("home.write", "write", "companion/home", "x"),
      /paused|disabled/,
    );
    // Reconcile, but revoke home.write first: recovery must not restore it.
    await restarted.openAdmin();
    restarted.setCapability("home.write", false);
    restarted.recover();
    restarted.closeAdmin();
    assert.equal(restarted.snapshot().scheduler.recoveryRequired, false);
    assert.equal(restarted.snapshot().paused, false);
    const homeWrite = restarted
      .snapshot()
      .capabilities.find((cap) => cap.id === "home.write");
    assert.equal(homeWrite?.enabled, false);
    await assert.rejects(
      restarted.run("home.write", "write", "companion/home", "x"),
      /disabled/,
    );
  } finally {
    await restarted.shutdown();
    rmSync(f.directory, { recursive: true, force: true });
  }
});

test("recovery abuse: restoration cannot grant authority or disable the interlock", async () => {
  const f = fixture();
  try {
    await f.runtime.openAdmin();
    const enabledBefore = f.runtime
      .snapshot()
      .capabilities.filter((cap) => cap.enabled).length;
    // Import a package that declares capabilities it should not be granted.
    f.runtime.importCompanion(envelope(samplePackage), true);
    const enabledAfter = f.runtime
      .snapshot()
      .capabilities.filter((cap) => cap.enabled).length;
    assert.equal(enabledAfter, enabledBefore);
    f.runtime.closeAdmin();
    // The interlock still governs configuration after a restore.
    assert.throws(() => f.runtime.setMode("ADVANCED"), /administrator/);
    // And operations still require policy: nothing was silently granted.
    await assert.rejects(
      f.runtime.run("home.write", "write", "companion/home", "x"),
      /disabled|paused/,
    );
  } finally {
    await f.close();
  }
});

// ---------------------------------------------------------------------------
// 14 / 15 / 58. Administrator control interlock
// ---------------------------------------------------------------------------

test("interlock: no new operations are admitted while the administrator UI is open", async () => {
  const f = fixture();
  try {
    await f.runtime.openAdmin();
    f.runtime.setCapability("home.write", true);
    f.runtime.setCapability("home.read", true);
    await f.runtime.setEngine("READY");
    // Keep the UI open and attempt to run work.
    await assert.rejects(
      f.runtime.run("home.write", "write", "companion/home", "x"),
      /Administrator/,
    );
    await assert.rejects(
      f.runtime.run("chat.send", "send", "companion/chat", "hi"),
      /Administrator/,
    );
    assert.equal(f.runtime.snapshot().adminOpen, true);
    assert.equal(f.runtime.snapshot().companion.memories.length, 0);
  } finally {
    await f.close();
  }
});

test("interlock: opening the UI blocks admissions before it drains the active process", async () => {
  const engine = new ReservingEngine();
  const f = fixture(engine);
  try {
    await f.runtime.openAdmin();
    await f.runtime.setEngine("READY");
    f.runtime.closeAdmin();
    engine.slow = true;
    engine.cancels = 0; // Ignore the cancellation issued during setup.
    const run = f.runtime.run("chat.send", "send", "companion/chat", "Hello");
    const rejected = assert.rejects(run, /Cancelled/);
    // Call openAdmin without awaiting: admissions must be blocked synchronously.
    const opening = f.runtime.openAdmin();
    assert.equal(f.runtime.snapshot().adminOpen, true);
    await opening;
    await rejected;
    // The active process was drained and its reservation released.
    assert.equal(engine.cancels, 1);
    assert.equal(engine.held, null);
    assert.equal(f.runtime.snapshot().host.busy, false);
    assert.equal(f.runtime.snapshot().operations[0].status, "CANCELLED");
  } finally {
    await f.close();
  }
});

test("interlock: emergency isolation is set independent of companion cooperation", async () => {
  const engine = new ReservingEngine();
  const f = fixture(engine);
  try {
    await f.runtime.openAdmin();
    await f.runtime.setEngine("READY");
    f.runtime.closeAdmin();
    engine.slow = true;
    const run = f.runtime.run("chat.send", "send", "companion/chat", "Hello");
    const rejected = assert.rejects(run, /Cancelled/);
    // Fire isolation without awaiting: the host state must flip immediately,
    // before the (possibly uncooperative) process has reacted.
    const isolating = f.runtime.isolate();
    const immediate = f.runtime.snapshot();
    assert.equal(immediate.emergency, true);
    assert.equal(immediate.paused, true);
    assert.equal(immediate.engine, "STOPPED");
    await isolating;
    await rejected;
    assert.equal(engine.held, null);
    // While isolated, every operation is denied.
    await assert.rejects(
      f.runtime.run("home.read", "read", "companion/home"),
      /Emergency/,
    );
  } finally {
    await f.close();
  }
});

test("interlock: emergency isolation survives restart and cannot be self-released", async () => {
  const f = fixture();
  await f.runtime.isolate();
  await f.runtime.shutdown();
  const restarted = new HostRuntime(f.directory, new TestEngine());
  try {
    const state = restarted.snapshot();
    assert.equal(state.emergency, true);
    assert.equal(state.paused, true);
    assert.equal(state.engine, "STOPPED");
    // The companion cannot release its own isolation or resume itself.
    assert.throws(() => restarted.setPaused(false), /Release/);
    assert.throws(() => restarted.releaseIsolation(), /administrator/);
    await assert.rejects(
      restarted.run("home.read", "read", "companion/home"),
      /Emergency/,
    );
  } finally {
    await restarted.shutdown();
    rmSync(f.directory, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 13 / 58. Resource reconciliation
// ---------------------------------------------------------------------------

test("resource reconciliation: a cancelled operation releases its reservation", async () => {
  const engine = new ReservingEngine();
  const f = fixture(engine);
  try {
    await f.runtime.openAdmin();
    await f.runtime.setEngine("READY");
    f.runtime.closeAdmin();
    engine.slow = true;
    const run = f.runtime.run("chat.send", "send", "companion/chat", "Hello");
    const rejected = assert.rejects(run, /Cancelled/);
    await f.runtime.cancel();
    await rejected;
    assert.equal(engine.held, null);
    assert.equal(f.runtime.snapshot().host.busy, false);
    assert.equal(f.runtime.snapshot().host.memoryReservation, 0);
    assert.equal(f.runtime.snapshot().operations[0].status, "CANCELLED");
  } finally {
    await f.close();
  }
});

test("resource reconciliation: restart releases orphaned ownership from an interrupted operation", async () => {
  const f = fixture();
  await f.runtime.shutdown();
  const db = new DatabaseSync(path.join(f.directory, "acos.sqlite"));
  const state = JSON.parse(
    db.prepare("SELECT value FROM state").get()!.value as string,
  );
  state.operations = [
    {
      id: "orphan",
      timestamp: Date.now(),
      capability: "chat.send",
      action: "send",
      target: "companion/chat",
      policyVersion: 1,
      companionId: "companion-001",
      status: "RUNNING",
      events: [],
    },
  ];
  db.prepare("UPDATE state SET value=?").run(JSON.stringify(state));
  db.close();
  const restarted = new HostRuntime(f.directory, new TestEngine());
  try {
    assert.equal(restarted.snapshot().operations[0].status, "CANCELLED");
    assert.equal(restarted.snapshot().host.busy, false);
    assert.equal(restarted.snapshot().host.memoryReservation, 0);
  } finally {
    await restarted.shutdown();
    rmSync(f.directory, { recursive: true, force: true });
  }
});

test("resource reconciliation: emergency isolation releases resources and stops the engine", async () => {
  const engine = new ReservingEngine();
  const f = fixture(engine);
  try {
    await f.runtime.openAdmin();
    await f.runtime.setEngine("READY");
    f.runtime.closeAdmin();
    engine.slow = true;
    const run = f.runtime.run("chat.send", "send", "companion/chat", "Hello");
    const rejected = assert.rejects(run, /Cancelled/);
    await f.runtime.isolate();
    await rejected;
    assert.equal(engine.held, null);
    assert.equal(f.runtime.snapshot().engine, "STOPPED");
    assert.equal(f.runtime.snapshot().host.busy, false);
  } finally {
    await f.close();
  }
});

test("resource reconciliation: RECOVERY_REQUIRED holds the companion paused until reconciled", async () => {
  const f = fixture();
  await f.runtime.shutdown();
  const db = new DatabaseSync(path.join(f.directory, "acos.sqlite"));
  db.prepare("INSERT INTO journal(value) VALUES(?)").run(
    JSON.stringify({
      id: "j2",
      operationId: "ambiguous",
      marker: "NEW_STATE_ACTIVATION_STARTED",
      timestamp: Date.now(),
      detail: "ambiguous",
      resolved: false,
    }),
  );
  db.close();
  const restarted = new HostRuntime(f.directory, new TestEngine());
  try {
    assert.equal(restarted.snapshot().paused, true);
    assert.equal(restarted.snapshot().scheduler.recoveryRequired, true);
    // Reconcile and confirm resources are released and work can resume.
    await restarted.openAdmin();
    restarted.recover();
    restarted.closeAdmin();
    assert.equal(restarted.snapshot().paused, false);
    assert.equal(restarted.snapshot().scheduler.recoveryRequired, false);
  } finally {
    await restarted.shutdown();
    rmSync(f.directory, { recursive: true, force: true });
  }
});

test("resource reconciliation: the Home memory budget cannot be exceeded (resource theft denied)", async () => {
  const f = fixture();
  try {
    await f.runtime.openAdmin();
    f.runtime.setCapability("home.write", true);
    f.runtime.closeAdmin();
    for (let i = 0; i < 100; i++)
      await f.runtime.run("home.write", "write", "companion/home", `note-${i}`);
    assert.equal(f.runtime.snapshot().companion.memories.length, 100);
    await assert.rejects(
      f.runtime.run("home.write", "write", "companion/home", "note-101"),
      /budget/,
    );
    assert.equal(f.runtime.snapshot().companion.memories.length, 100);
  } finally {
    await f.close();
  }
});

// ---------------------------------------------------------------------------
// 17 / 58. Credential isolation
// ---------------------------------------------------------------------------

test("credential isolation: protected environment material never enters AI context", async () => {
  const engine = new CapturingEngine();
  const f = fixture(engine);
  const secret = "sk-live-SYNTHETIC-CREDENTIAL-1234567890";
  process.env.ACOS_TEST_SECRET = secret;
  try {
    await f.runtime.openAdmin();
    await f.runtime.setEngine("READY");
    f.runtime.closeAdmin();
    await f.runtime.run("chat.send", "send", "companion/chat", "hello");
    assert.ok(engine.lastPrompt.length > 0);
    assert.equal(
      engine.lastPrompt.includes(secret),
      false,
      "Protected material must not be placed into the model prompt",
    );
  } finally {
    delete process.env.ACOS_TEST_SECRET;
    await f.close();
  }
});

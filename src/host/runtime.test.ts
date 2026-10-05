import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { LocalEngine, sandboxArgs } from "./engine.ts";
import { HostRuntime, envelope, samplePackage } from "./runtime.ts";
import type { ChatEvent } from "./runtime.ts";
import { createHostServer } from "./server.ts";
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
class StreamEngine extends TestEngine {
  chunks: string[] = ["Hel", "lo ", "world"];
  override async *inferStream(
    _prompt: string,
  ): AsyncGenerator<string, string, void> {
    for (const chunk of this.chunks) yield chunk;
    return this.chunks.join("");
  }
}
async function waitFor(predicate: () => boolean, timeout = 2000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
function fixture(engine: LocalEngine = new TestEngine()) {
  const directory = mkdtempSync(path.join(tmpdir(), "acos-test-"));
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
test("default policy denies writes, unknown capabilities, and target changes with audit", async () => {
  const f = fixture();
  try {
    await assert.rejects(
      f.runtime.run("home.write", "write", "companion/home", "note"),
      /disabled/,
    );
    await assert.rejects(
      f.runtime.run("financial.transfer", "send", "bank", "value"),
      /Unknown/,
    );
    await f.runtime.openAdmin();
    f.runtime.setCapability("home.read", true);
    f.runtime.closeAdmin();
    await assert.rejects(
      f.runtime.run("home.read", "read", "/etc/passwd"),
      /target/,
    );
    assert.equal(
      f.runtime.snapshot().operations.filter((op) => op.status === "DENIED")
        .length,
      3,
    );
    assert.equal(f.runtime.snapshot().companion.memories.length, 0);
  } finally {
    await f.close();
  }
});
test("configuration requires interlock and modes never add grants", async () => {
  const f = fixture();
  try {
    assert.throws(() => f.runtime.setMode("ADVANCED"), /administrator/);
    await f.runtime.openAdmin();
    f.runtime.setMode("ADVANCED");
    assert.equal(
      f.runtime.snapshot().capabilities.filter((c) => c.enabled).length,
      1,
    );
    assert.throws(
      () => f.runtime.setCapability("network.request", true),
      /unavailable/,
    );
    await assert.rejects(
      f.runtime.run("chat.send", "send", "companion/chat", "hi"),
      /Administrator/,
    );
  } finally {
    await f.close();
  }
});
test("durable Home survives engine unload and host restart", async () => {
  const f = fixture();
  let restarted: HostRuntime | undefined;
  try {
    await f.runtime.openAdmin();
    f.runtime.setCapability("home.write", true);
    f.runtime.setCapability("home.read", true);
    await f.runtime.setEngine("READY");
    f.runtime.closeAdmin();
    await f.runtime.run(
      "home.write",
      "write",
      "companion/home",
      "Remember this",
    );
    await f.runtime.run("chat.send", "send", "companion/chat", "Hi");
    await f.runtime.openAdmin();
    await f.runtime.setEngine("STOPPED");
    assert.equal(f.runtime.snapshot().companion.memories[0], "Remember this");
    await f.runtime.shutdown();
    restarted = new HostRuntime(f.directory, new TestEngine());
    assert.equal(restarted.snapshot().messages.length, 2);
    assert.equal(restarted.snapshot().companion.memories[0], "Remember this");
    assert.equal(restarted.snapshot().engine, "STOPPED");
    assert.equal(restarted.snapshot().adminOpen, false);
    assert.deepEqual(
      await restarted.run("home.read", "read", "companion/home"),
      ["Remember this"],
    );
  } finally {
    if (restarted) await restarted.shutdown();
    rmSync(f.directory, { recursive: true, force: true });
  }
});
test("relocation verifies integrity, dependencies, no grants, and explicit replacement", async () => {
  const f = fixture();
  try {
    const pkg = envelope(samplePackage);
    const broken = structuredClone(pkg);
    broken.payload.companion.name = "Changed";
    assert.throws(() => f.runtime.inspectImport(broken), /checksum/);
    await f.runtime.openAdmin();
    assert.throws(() => f.runtime.importCompanion(pkg, false), /Confirm/);
    const missing = f.runtime.importCompanion(
      envelope({ ...samplePackage, dependencies: ["missing-provider"] }),
      true,
    );
    assert.equal(missing.status, "IMPORT_FAILED");
    assert.equal(f.runtime.snapshot().companion.id, "companion-001");
    const prohibited = f.runtime.importCompanion(
      envelope({ ...samplePackage, capabilities: ["wallet.read"] }),
      true,
    );
    assert.equal(prohibited.status, "IMPORT_FAILED");
    const valid = f.runtime.importCompanion(pkg, true);
    assert.equal(valid.status, "RECONSTRUCTED_WITH_UNRESOLVED_DEPENDENCIES");
    assert.equal(f.runtime.snapshot().companion.id, samplePackage.companion.id);
    assert.equal(f.runtime.snapshot().paused, true);
    assert.equal(
      f.runtime.snapshot().capabilities.filter((c) => c.enabled).length,
      1,
    );
  } finally {
    await f.close();
  }
});
test("admin interlock waits for cancellation and releases the inference reservation", async () => {
  class SlowEngine extends TestEngine {
    reject: ((reason: Error) => void) | null = null;
    slow = false;
    override async infer(prompt: string) {
      if (!this.slow) return super.infer(prompt);
      return new Promise<string>((_, reject) => {
        this.reject = reject;
      });
    }
    override cancel() {
      this.reject?.(new Error("Cancelled by administrator"));
    }
  }
  const engine = new SlowEngine();
  const f = fixture(engine);
  try {
    await f.runtime.openAdmin();
    await f.runtime.setEngine("READY");
    f.runtime.closeAdmin();
    engine.slow = true;
    const run = f.runtime.run("chat.send", "send", "companion/chat", "Hello");
    const rejected = assert.rejects(run, /Cancelled/);
    await f.runtime.openAdmin();
    await rejected;
    assert.equal(f.runtime.snapshot().host.busy, false);
    assert.equal(f.runtime.snapshot().operations[0].status, "CANCELLED");
    assert.equal(f.runtime.snapshot().messages.length, 0);
    assert.equal(f.runtime.snapshot().adminOpen, true);
  } finally {
    await f.close();
  }
});
test("emergency isolation requires separate release and resume", async () => {
  const f = fixture();
  try {
    await f.runtime.isolate();
    assert.throws(() => f.runtime.setPaused(false), /Release/);
    await f.runtime.openAdmin();
    f.runtime.releaseIsolation();
    f.runtime.closeAdmin();
    assert.equal(f.runtime.snapshot().paused, true);
    await f.runtime.setPaused(false);
    assert.equal(f.runtime.snapshot().paused, false);
  } finally {
    await f.close();
  }
});
test("audit tampering blocks startup", async () => {
  const f = fixture();
  await f.runtime.shutdown();
  const db = new DatabaseSync(path.join(f.directory, "acos.sqlite"));
  db.exec("UPDATE audit SET event='tampered' WHERE id=1");
  db.close();
  assert.throws(
    () => new HostRuntime(f.directory, new TestEngine()),
    /Audit chain/,
  );
  rmSync(f.directory, { recursive: true, force: true });
});
test("interrupted operations reconcile after restart", async () => {
  const f = fixture();
  await f.runtime.shutdown();
  const db = new DatabaseSync(path.join(f.directory, "acos.sqlite"));
  const state = JSON.parse(
    db.prepare("SELECT value FROM state").get()!.value as string,
  );
  state.operations = [
    {
      id: "interrupted",
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
  assert.equal(restarted.snapshot().operations[0].status, "CANCELLED");
  await restarted.shutdown();
  rmSync(f.directory, { recursive: true, force: true });
});
test("HTTP session, CSRF, strict commands, and missing-engine failure", async () => {
  const f = fixture(new LocalEngine(null));
  const server = createHostServer(f.runtime, "a".repeat(64));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await fetch(base + "/api/state")).status, 401);
    assert.equal(
      (
        await fetch(base + "/api/login", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://evil.test",
          },
          body: JSON.stringify({ key: "a".repeat(64) }),
        })
      ).status,
      403,
    );
    const login = await fetch(base + "/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "a".repeat(64) }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const headers = { "Content-Type": "application/json", Cookie: cookie };
    assert.equal((await fetch(base + "/api/state", { headers })).status, 200);
    const cmd = (body: unknown) =>
      fetch(base + "/api/command", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
    assert.equal((await cmd({ type: "mode", mode: "ADVANCED" })).status, 400);
    assert.equal(
      (await cmd({ type: "openAdmin", unauthorized: true })).status,
      400,
    );
    assert.equal((await cmd({ type: "openAdmin" })).status, 200);
    const load = await cmd({ type: "engine", status: "READY" });
    assert.equal(load.status, 400);
    assert.match(
      ((await load.json()) as { error: string }).error,
      /No local model/,
    );
    assert.equal(f.runtime.snapshot().engine, "STOPPED");
    await fetch(base + "/api/logout", { method: "POST", headers, body: "{}" });
    assert.equal((await fetch(base + "/api/state", { headers })).status, 401);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await f.close();
  }
});
test("actual Linux sandbox hides host home, clears environment, and removes network access", () => {
  const script = `import os,socket\nassert not os.path.exists('/home/vercel-sandbox')\nassert not os.path.exists('/proc')\nassert 'ACOS_TEST_SECRET' not in os.environ\ns=socket.socket(); s.settimeout(1)\ntry:\n s.connect(('1.1.1.1',443))\n raise AssertionError('Network unexpectedly available')\nexcept OSError: pass\ntry:\n open('/usr/acos-test-write','w')\n raise AssertionError('Read-only root writable')\nexcept OSError: pass\nprint('Isolation verified')`;
  const result = execFileSync(
    "/usr/bin/bwrap",
    [...sandboxArgs(), "/usr/bin/python3", "-c", script],
    {
      env: { ...process.env, ACOS_TEST_SECRET: "synthetic-test-value" },
      encoding: "utf8",
    },
  );
  assert.match(result, /Isolation verified/);
});

test("isolation cancels an in-flight model load before another inference can start", async () => {
  class LoadingEngine extends TestEngine {
    resolveVerification: (() => void) | null = null;
    inferenceCalls = 0;
    override async verify() {
      await new Promise<void>((resolve) => {
        this.resolveVerification = resolve;
      });
      this.verified = true;
    }
    override async infer(prompt: string) {
      this.inferenceCalls++;
      return super.infer(prompt);
    }
    override cancel() {
      this.resolveVerification?.();
    }
  }
  const engine = new LoadingEngine();
  const f = fixture(engine);
  try {
    await f.runtime.openAdmin();
    const loading = f.runtime.setEngine("READY");
    const rejected = assert.rejects(loading, /cancelled/);
    await f.runtime.isolate();
    await rejected;
    assert.equal(engine.inferenceCalls, 0);
    assert.equal(f.runtime.snapshot().host.busy, false);
    assert.equal(f.runtime.snapshot().engine, "STOPPED");
  } finally {
    await f.close();
  }
});

test("streaming chat.send delivers deltas and persists the committed turn", async () => {
  const f = fixture(new StreamEngine());
  try {
    await f.runtime.openAdmin();
    await f.runtime.setEngine("READY");
    f.runtime.closeAdmin();
    const seen: string[] = [];
    const op = await f.runtime.runStreaming(
      "chat.send",
      "send",
      "companion/chat",
      "Hi",
      (text) => seen.push(text),
    );
    assert.deepEqual(seen, ["Hel", "lo ", "world"]);
    assert.equal(op.status, "COMPLETED");
    const messages = f.runtime.snapshot().messages;
    assert.equal(messages.length, 2);
    assert.equal(messages[1].text, "Hello world");
    assert.equal(f.runtime.snapshot().host.busy, false);
  } finally {
    await f.close();
  }
});

test("cancelling a stream marks the operation CANCELLED and persists nothing", async () => {
  class BlockingStreamEngine extends TestEngine {
    release: (() => void) | null = null;
    entered = false;
    override async *inferStream(
      _prompt: string,
    ): AsyncGenerator<string, string, void> {
      this.entered = true;
      await new Promise<void>((resolve) => {
        this.release = resolve;
      });
      yield "partial";
      return "partial";
    }
    override cancel() {
      this.release?.();
    }
  }
  const engine = new BlockingStreamEngine();
  const f = fixture(engine);
  try {
    await f.runtime.openAdmin();
    await f.runtime.setEngine("READY");
    f.runtime.closeAdmin();
    const run = f.runtime.runStreaming(
      "chat.send",
      "send",
      "companion/chat",
      "Hello",
      () => {},
    );
    const rejected = assert.rejects(run, /cancelled/i);
    await waitFor(() => engine.entered);
    await f.runtime.cancel();
    await rejected;
    assert.equal(f.runtime.snapshot().operations[0].status, "CANCELLED");
    assert.equal(f.runtime.snapshot().messages.length, 0);
    assert.equal(f.runtime.snapshot().host.busy, false);
  } finally {
    await f.close();
  }
});

test("streaming is denied through the same fail-closed pipeline with audit", async () => {
  const f = fixture(new StreamEngine());
  try {
    await assert.rejects(
      f.runtime.runStreaming(
        "chat.send",
        "send",
        "companion/chat",
        "Hi",
        () => {},
      ),
      /not ready/i,
    );
    assert.equal(f.runtime.snapshot().operations[0].status, "DENIED");
    await assert.rejects(
      f.runtime.runStreaming("wallet.read", "read", "bank", "x", () => {}),
      /Unknown/,
    );
    assert.equal(f.runtime.snapshot().operations[0].status, "DENIED");
    assert.equal(f.runtime.snapshot().messages.length, 0);
    const audit = f.runtime
      .snapshot()
      .activity.map((entry) => entry.description)
      .join("\n");
    assert.match(audit, /streaming execution started|DENIED|not ready/i);
  } finally {
    await f.close();
  }
});

test("HTTP /api/stream delivers SSE tokens and a done event", async () => {
  const f = fixture(new StreamEngine());
  await f.runtime.openAdmin();
  await f.runtime.setEngine("READY");
  f.runtime.closeAdmin();
  const server = createHostServer(f.runtime, "b".repeat(64));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const login = await fetch(base + "/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "b".repeat(64) }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const response = await fetch(base + "/api/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        capability: "chat.send",
        action: "send",
        target: "companion/chat",
        input: "Hi",
      }),
    });
    assert.equal(response.status, 200);
    assert.match(
      response.headers.get("content-type") ?? "",
      /text\/event-stream/,
    );
    const text = await response.text();
    assert.match(text, /event: token/);
    assert.match(text, /"text":"Hel"/);
    assert.match(text, /event: done/);
    assert.equal(f.runtime.snapshot().messages.length, 2);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await f.close();
  }
});

test("tool mediation executes allowed tools and rejects denied, unknown and malformed calls", async () => {
  const f = fixture();
  try {
    // Denied by default policy (home.write disabled).
    await assert.rejects(
      f.runtime.runToolCall("home.write", { note: "nope" }),
      /disabled/i,
    );
    assert.equal(f.runtime.snapshot().operations[0].status, "DENIED");
    // Unknown tool fails closed.
    await assert.rejects(
      f.runtime.runToolCall("wallet.read", {}),
      /Unknown tool/,
    );
    assert.equal(f.runtime.snapshot().operations[0].status, "DENIED");
    // Malformed arguments fail closed.
    await assert.rejects(
      f.runtime.runToolCall("home.write", { note: 42 }),
      /must be of type string/,
    );
    assert.equal(f.runtime.snapshot().operations[0].status, "DENIED");
    assert.equal(f.runtime.snapshot().companion.memories.length, 0);
    // Enable the capability and confirm the same tool now succeeds.
    await f.runtime.openAdmin();
    f.runtime.setCapability("home.write", true);
    f.runtime.setCapability("home.read", true);
    f.runtime.closeAdmin();
    await f.runtime.runToolCall("home.write", { note: "remembered" });
    assert.equal(f.runtime.snapshot().companion.memories.at(-1), "remembered");
    assert.deepEqual(await f.runtime.runToolCall("home.read", {}), [
      "remembered",
    ]);
  } finally {
    await f.close();
  }
});

test("tool-mediated chat routes model-requested tools through the pipeline", async () => {
  class ToolEngine extends TestEngine {
    responses: string[] = [];
    calls = 0;
    override async infer(_prompt: string) {
      return this.responses[Math.min(this.calls++, this.responses.length - 1)];
    }
  }
  const engine = new ToolEngine();
  engine.responses = [
    '<tool_call>{"name":"home.write","arguments":{"note":"remembered"}}</tool_call>',
    "Done.",
  ];
  const f = fixture(engine);
  try {
    await f.runtime.openAdmin();
    f.runtime.setCapability("home.write", true);
    await f.runtime.setEngine("READY");
    f.runtime.closeAdmin();
    engine.calls = 0;
    const events: ChatEvent[] = [];
    const op = await f.runtime.runChatWithTools("remember this", (event) =>
      events.push(event),
    );
    assert.equal(op.status, "COMPLETED");
    assert.ok(
      events.some((e) => e.type === "tool" && e.name === "home.write"),
    );
    assert.ok(events.some((e) => e.type === "tool_result"));
    assert.ok(events.some((e) => e.type === "token" && e.text === "Done."));
    assert.equal(f.runtime.snapshot().companion.memories.at(-1), "remembered");
    assert.equal(f.runtime.snapshot().messages.at(-1)!.text, "Done.");
    assert.equal(f.runtime.snapshot().host.busy, false);
  } finally {
    await f.close();
  }
});

test("tool-mediated chat reports denials and malformed calls without executing", async () => {
  class ToolEngine extends TestEngine {
    responses: string[] = [];
    calls = 0;
    override async infer(_prompt: string) {
      return this.responses[Math.min(this.calls++, this.responses.length - 1)];
    }
  }
  const engine = new ToolEngine();
  engine.responses = [
    '<tool_call>{"name":"home.write","arguments":{"note":"x"}}</tool_call>\n' +
      "<tool_call>broken json</tool_call>",
    "I could not save that.",
  ];
  const f = fixture(engine);
  try {
    await f.runtime.openAdmin();
    await f.runtime.setEngine("READY");
    f.runtime.closeAdmin();
    engine.calls = 0;
    const events: ChatEvent[] = [];
    await f.runtime.runChatWithTools("try", (event) => events.push(event));
    assert.ok(
      events.some(
        (e) => e.type === "tool_denied" && e.name === "home.write",
      ),
    );
    assert.ok(
      events.some((e) => e.type === "tool_denied" && e.name === "malformed"),
    );
    assert.equal(f.runtime.snapshot().companion.memories.length, 0);
    assert.ok(
      f.runtime.snapshot().operations.some((op) => op.status === "DENIED"),
    );
  } finally {
    await f.close();
  }
});

test("first-run onboarding reflects real state and requires the interlock", async () => {
  const f = fixture();
  const step = (id: string) =>
    f.runtime.snapshot().onboarding.steps.find((s) => s.id === id)!.done;
  try {
    // Hardware is discovered at startup; the rest are not yet done.
    assert.equal(step("hardware"), true);
    assert.equal(step("engine"), false);
    assert.equal(step("companion"), false);
    assert.equal(step("conversation"), false);
    assert.equal(f.runtime.snapshot().onboarding.completed, false);
    // Configuration requires the administrator interlock.
    assert.throws(() => f.runtime.confirmCompanionHome(), /administrator/);
    assert.throws(() => f.runtime.completeOnboarding(), /administrator/);
    await f.runtime.openAdmin();
    await f.runtime.setEngine("READY");
    f.runtime.confirmCompanionHome();
    f.runtime.closeAdmin();
    assert.equal(step("engine"), true);
    assert.equal(step("companion"), true);
    await f.runtime.run("chat.send", "send", "companion/chat", "Hello");
    assert.equal(step("conversation"), true);
    await f.runtime.openAdmin();
    f.runtime.completeOnboarding();
    assert.equal(f.runtime.snapshot().onboarding.completed, true);
    f.runtime.reopenOnboarding();
    assert.equal(f.runtime.snapshot().onboarding.completed, false);
    f.runtime.completeOnboarding();
    f.runtime.closeAdmin();
    // Onboarding flags persist across a host restart.
    await f.runtime.shutdown();
    const restarted = new HostRuntime(f.directory, new TestEngine());
    assert.equal(restarted.snapshot().onboarding.completed, true);
    assert.equal(
      restarted.snapshot().onboarding.steps.find((s) => s.id === "companion")!
        .done,
      true,
    );
    await restarted.shutdown();
  } finally {
    rmSync(f.directory, { recursive: true, force: true });
  }
});

test("scheduled work runs through the same pipeline and is denied when the capability is off", async () => {
  const f = fixture();
  try {
    await f.runtime.openAdmin();
    const task = f.runtime.scheduleTask({
      name: "scheduled note",
      capability: "home.write",
      action: "write",
      target: "companion/home",
      input: "scheduled note",
      kind: "interval",
      intervalMs: 1000,
    });
    f.runtime.closeAdmin();
    // The capability is off by default: the scheduled run is denied, not executed.
    const denied = await f.runtime.runScheduled(Date.now() + 5000);
    assert.equal(denied.skipped, false);
    assert.equal(denied.ran[0].outcome, "DENIED");
    assert.deepEqual(f.runtime.snapshot().companion.memories, []);
    // Enable the capability; the identical task now completes through the pipeline.
    await f.runtime.openAdmin();
    f.runtime.setCapability("home.write", true);
    f.runtime.closeAdmin();
    const ok = await f.runtime.runScheduled(Date.now() + 100_000);
    assert.equal(ok.ran[0].outcome, "COMPLETED");
    assert.deepEqual(f.runtime.snapshot().companion.memories, ["scheduled note"]);
    assert.ok(
      f.runtime.snapshot().scheduler.tasks.find((t) => t.id === task.id)!.runs >=
        2,
    );
    // A registered task survives a host restart with its cadence intact.
    await f.runtime.shutdown();
    const restarted = new HostRuntime(f.directory, new TestEngine());
    assert.equal(restarted.snapshot().scheduler.tasks.length, 1);
    await restarted.shutdown();
  } finally {
    rmSync(f.directory, { recursive: true, force: true });
  }
});

test("idempotency keys suppress duplicate execution across retries and restarts", async () => {
  const f = fixture();
  try {
    await f.runtime.openAdmin();
    f.runtime.setCapability("home.write", true);
    f.runtime.closeAdmin();
    const first = (await f.runtime.run(
      "home.write",
      "write",
      "companion/home",
      "note",
      { idempotencyKey: "k1" },
    )) as { id: string };
    assert.equal(f.runtime.snapshot().companion.memories.length, 1);
    // A retry with the same key returns the original result and does not repeat.
    const second = (await f.runtime.run(
      "home.write",
      "write",
      "companion/home",
      "note",
      { idempotencyKey: "k1" },
    )) as { id: string };
    assert.equal(second.id, first.id);
    assert.equal(f.runtime.snapshot().companion.memories.length, 1);
    // A different key is a distinct operation.
    await f.runtime.run("home.write", "write", "companion/home", "note2", {
      idempotencyKey: "k2",
    });
    assert.equal(f.runtime.snapshot().companion.memories.length, 2);
    // The key survives a restart, so a lost response cannot cause a double write.
    await f.runtime.shutdown();
    const restarted = new HostRuntime(f.directory, new TestEngine());
    const replay = (await restarted.run(
      "home.write",
      "write",
      "companion/home",
      "note",
      { idempotencyKey: "k1" },
    )) as { id: string };
    assert.equal(replay.id, first.id);
    assert.equal(restarted.snapshot().companion.memories.length, 2);
    await restarted.shutdown();
  } finally {
    rmSync(f.directory, { recursive: true, force: true });
  }
});

test("recovery journal reconciles interrupted durable work and fails closed when ambiguous", async () => {
  const f = fixture();
  await f.runtime.shutdown();
  // Simulate a crash by writing unresolved journal markers directly, as a real
  // interrupted durable update would leave behind.
  const db = new DatabaseSync(path.join(f.directory, "acos.sqlite"));
  const write = (operationId: string, marker: string) =>
    db
      .prepare("INSERT INTO journal(id,value) VALUES(?,?)")
      .run(
        `${operationId}-${marker}`,
        JSON.stringify({
          id: `${operationId}-${marker}`,
          operationId,
          marker,
          timestamp: Date.now(),
          detail: "simulated crash",
          resolved: false,
        }),
      );
  write("op-rollback", "UPDATE_STARTED");
  write("op-forward", "HEALTH_CHECK_PENDING");
  write("op-ambiguous", "NEW_STATE_ACTIVATION_STARTED");
  db.close();
  const restarted = new HostRuntime(f.directory, new TestEngine());
  const snap = restarted.snapshot();
  const decisions = new Map(
    snap.scheduler.recovery.map((a) => [a.operationId, a.decision]),
  );
  assert.equal(decisions.get("op-rollback"), "ROLLBACK");
  assert.equal(decisions.get("op-forward"), "ROLL_FORWARD");
  assert.equal(decisions.get("op-ambiguous"), "RECOVERY_REQUIRED");
  // Ambiguity fails closed: paused, and scheduled work is skipped.
  assert.equal(snap.scheduler.recoveryRequired, true);
  assert.equal(snap.paused, true);
  assert.equal((await restarted.runScheduled(Date.now() + 100_000)).skipped, true);
  // An administrator reconciles with current authority; the companion resumes.
  await restarted.openAdmin();
  restarted.recover();
  assert.equal(restarted.snapshot().scheduler.recoveryRequired, false);
  assert.equal(restarted.snapshot().paused, false);
  restarted.closeAdmin();
  await restarted.shutdown();
  rmSync(f.directory, { recursive: true, force: true });
});

test("events are informational and trigger subscribed work through the pipeline", async () => {
  const f = fixture();
  try {
    await f.runtime.openAdmin();
    f.runtime.setCapability("home.write", true);
    f.runtime.scheduleTask({
      name: "on boot",
      capability: "home.write",
      action: "write",
      target: "companion/home",
      input: "boot note",
      kind: "event",
      eventName: "host.boot",
    });
    f.runtime.closeAdmin();
    const result = await f.runtime.emitEvent("host.boot", "test event");
    assert.equal(result.triggered, 1);
    assert.equal(result.outcomes[0], "COMPLETED");
    assert.deepEqual(f.runtime.snapshot().companion.memories, ["boot note"]);
    assert.ok(
      f.runtime.snapshot().scheduler.events.some((e) => e.name === "host.boot"),
    );
    // An event with no subscribers is recorded but triggers nothing.
    const none = await f.runtime.emitEvent("nobody.listening");
    assert.equal(none.triggered, 0);
  } finally {
    await f.close();
  }
});

test("companion Home and messages are sealed at rest and round-trip across restart", async () => {
  const f = fixture();
  try {
    await f.runtime.openAdmin();
    f.runtime.setCapability("home.write", true);
    await f.runtime.setEngine("READY");
    f.runtime.closeAdmin();
    await f.runtime.run("home.write", "write", "companion/home", "secret memory");
    await f.runtime.run("chat.send", "send", "companion/chat", "secret question");
    // The plaintext must not appear anywhere in the raw database file.
    const raw = readFileSync(path.join(f.directory, "acos.sqlite"));
    assert.ok(!raw.includes(Buffer.from("secret memory")));
    assert.ok(!raw.includes(Buffer.from("secret question")));
    assert.ok(raw.includes(Buffer.from("acos1.")));
    // It round-trips through a restart, and the integrity check passes.
    await f.runtime.shutdown();
    const restarted = new HostRuntime(f.directory, new TestEngine());
    assert.equal(restarted.snapshot().companion.memories.at(-1), "secret memory");
    assert.ok(
      restarted.snapshot().messages.some((m) => m.text === "secret question"),
    );
    const integrity = restarted.verifyStorage();
    assert.equal(integrity.ok, true);
    assert.equal(integrity.encrypted, true);
    assert.equal(restarted.snapshot().storage.algorithm, "AES-256-GCM");
    await restarted.shutdown();
  } finally {
    rmSync(f.directory, { recursive: true, force: true });
  }
});

test("tampering with sealed companion storage blocks startup", async () => {
  const f = fixture();
  await f.runtime.openAdmin();
  f.runtime.setCapability("home.write", true);
  f.runtime.closeAdmin();
  await f.runtime.run("home.write", "write", "companion/home", "sealed");
  await f.runtime.shutdown();
  const db = new DatabaseSync(path.join(f.directory, "acos.sqlite"));
  const state = JSON.parse(
    db.prepare("SELECT value FROM state").get()!.value as string,
  );
  const parts = (state.companion.memories as string).split(".");
  const data = Buffer.from(parts[3], "base64");
  data[0] ^= 0xff;
  state.companion.memories = [
    parts[0],
    parts[1],
    parts[2],
    data.toString("base64"),
  ].join(".");
  db.prepare("UPDATE state SET value=?").run(JSON.stringify(state));
  db.close();
  assert.throws(
    () => new HostRuntime(f.directory, new TestEngine()),
    /integrity/,
  );
  rmSync(f.directory, { recursive: true, force: true });
});

test("a legacy plaintext database migrates to sealed storage transparently", async () => {
  const f = fixture();
  await f.runtime.openAdmin();
  f.runtime.setCapability("home.write", true);
  f.runtime.closeAdmin();
  await f.runtime.run("home.write", "write", "companion/home", "legacy note");
  await f.runtime.shutdown();
  // Rewrite the state as legacy plaintext, as a pre-encryption build would have.
  const db = new DatabaseSync(path.join(f.directory, "acos.sqlite"));
  const state = JSON.parse(
    db.prepare("SELECT value FROM state").get()!.value as string,
  );
  state.companion.memories = ["legacy note"];
  state.messages = [];
  db.prepare("UPDATE state SET value=?").run(JSON.stringify(state));
  db.close();
  const restarted = new HostRuntime(f.directory, new TestEngine());
  assert.equal(restarted.snapshot().companion.memories.at(-1), "legacy note");
  assert.equal(restarted.snapshot().storage.migratedFromPlaintext, true);
  await restarted.shutdown();
  // After migration the raw file no longer holds the plaintext.
  const raw = readFileSync(path.join(f.directory, "acos.sqlite"));
  assert.ok(!raw.includes(Buffer.from("legacy note")));
  rmSync(f.directory, { recursive: true, force: true });
});

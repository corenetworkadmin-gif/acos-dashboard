import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { LocalEngine, sandboxArgs } from "./engine.ts";
import { HostRuntime, envelope, samplePackage } from "./runtime.ts";
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

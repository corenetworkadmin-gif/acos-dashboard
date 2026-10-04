import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { LocalEngine } from "./engine.ts";
import { HostRuntime } from "./runtime.ts";
import { createHostServer } from "./server.ts";

type Snapshot = ReturnType<HostRuntime["snapshot"]>;
async function serve(directory: string) {
  const runtime = new HostRuntime(directory, new LocalEngine(null));
  const key = "b".repeat(64); // Synthetic local test identity.
  const server = createHostServer(runtime, key);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const login = await fetch(base + "/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key }),
  });
  assert.equal(login.status, 200);
  const headers = {
    "Content-Type": "application/json",
    Cookie: login.headers.get("set-cookie")!.split(";")[0],
  };
  return {
    runtime,
    async state(): Promise<Snapshot> {
      return (await (
        await fetch(base + "/api/state", { headers })
      ).json()) as Snapshot;
    },
    async command(body: unknown, status = 200) {
      const response = await fetch(base + "/api/command", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as {
        state: Snapshot;
        error?: string;
        result?: unknown;
      };
      assert.equal(response.status, status, data.error);
      return data;
    },
    async close() {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await runtime.shutdown();
    },
  };
}
const cap = (state: Snapshot, id: string) => {
  const result = state.capabilities.find((c) => c.id === id);
  assert.ok(result);
  return result;
};

test("HTTP policy ON and OFF persist across restarts and allow/deny actual Home writes", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "acos-policy-http-"));
  let host = await serve(directory);
  try {
    const initial = await host.state();
    assert.equal(cap(initial, "home.write").enabled, false);
    assert.equal(cap(initial, "home.write").attached, true);
    assert.equal(cap(initial, "home.write").available, true);
    await host.command(
      { type: "capability", id: "home.write", enabled: true },
      400,
    );
    assert.equal((await host.state()).policyVersion, initial.policyVersion);
    await host.command({ type: "openAdmin" });
    const on = (
      await host.command({
        type: "capability",
        id: "home.write",
        enabled: true,
      })
    ).state;
    assert.equal(cap(on, "home.write").enabled, true);
    assert.equal(on.policyVersion, initial.policyVersion + 1);
    assert.equal(cap(on, "home.write").authorization.allowed, false); // Interlock still active.
    assert.match(cap(on, "home.write").authorization.reason!, /Administrator/);
    const repeated = await host.command({
      type: "capability",
      id: "home.write",
      enabled: true,
    });
    assert.equal(repeated.state.policyVersion, on.policyVersion);
    await host.command({ type: "closeAdmin" });
    assert.equal(
      cap(await host.state(), "home.write").authorization.allowed,
      true,
    );
    const operation = {
      type: "run",
      capability: "home.write",
      action: "write",
      target: "companion/home",
      input: "Synthetic authorized note",
    };
    await host.command(operation);
    assert.deepEqual((await host.state()).companion.memories, [
      "Synthetic authorized note",
    ]);
    assert.equal(host.runtime.snapshot().operations[0].status, "COMPLETED");
    assert.equal(
      host.runtime.snapshot().operations[0].policyVersion,
      on.policyVersion,
    );
    await host.close();
    host = await serve(directory);
    assert.equal(cap(await host.state(), "home.write").enabled, true);
    await host.command({ type: "openAdmin" });
    const off = (
      await host.command({
        type: "capability",
        id: "home.write",
        enabled: false,
      })
    ).state;
    assert.equal(cap(off, "home.write").enabled, false);
    assert.equal(off.policyVersion, on.policyVersion + 1);
    await host.command({ type: "closeAdmin" });
    const denied = await host.command(
      { ...operation, input: "Must never be saved" },
      400,
    );
    assert.match(denied.error!, /disabled/);
    assert.equal(host.runtime.snapshot().operations[0].status, "DENIED");
    assert.equal(
      host.runtime.snapshot().operations[0].policyVersion,
      off.policyVersion,
    );
    await host.close();
    host = await serve(directory);
    assert.equal(cap(await host.state(), "home.write").enabled, false);
    assert.deepEqual((await host.state()).companion.memories, [
      "Synthetic authorized note",
    ]);
    assert.match((await host.command(operation, 400)).error!, /disabled/);
  } finally {
    await host.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("unattached providers cannot be enabled by UI commands, mode changes or forged metadata", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "acos-unattached-"));
  const host = await serve(directory);
  try {
    await host.command({ type: "openAdmin" });
    await host.command({ type: "mode", mode: "ADVANCED" });
    const before = await host.state();
    const missing = before.capabilities.filter((c) => !c.attached);
    assert.ok(missing.length);
    for (const c of missing) {
      assert.equal(c.available, false);
      assert.equal(c.enabled, false);
      assert.match(
        (
          await host.command(
            { type: "capability", id: c.id, enabled: true },
            400,
          )
        ).error!,
        /not attached/,
      );
      const after = await host.state();
      assert.equal(cap(after, c.id).enabled, false);
      assert.equal(after.policyVersion, before.policyVersion);
    }
    await host.command(
      {
        type: "capability",
        id: "network.request",
        enabled: true,
        attached: true,
        available: true,
      },
      400,
    );
    await host.command(
      { type: "capability", id: "unknown.fixture", enabled: true },
      400,
    );
    await host.command({ type: "closeAdmin" });
    const denied = await host.command(
      {
        type: "run",
        capability: "network.request",
        action: "request",
        target: "None configured",
      },
      400,
    );
    assert.match(denied.error!, /not attached/);
    assert.equal(
      cap(await host.state(), "network.request").authorization.allowed,
      false,
    );
    assert.equal(host.runtime.snapshot().operations[0].status, "DENIED");
    // Attachment, availability, and policy are independent: core chat is attached,
    // fixed-policy enabled, but unavailable until an engine is verified and loaded.
    const chat = cap(await host.state(), "chat.send");
    assert.equal(chat.attached, true);
    assert.equal(chat.enabled, true);
    assert.equal(chat.available, false);
    assert.match(chat.availabilityReason!, /engine is not ready/);
    assert.equal(chat.authorization.allowed, false);
  } finally {
    await host.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("startup retains legitimate grants but reconciles stored attachment/contract claims with this build", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "acos-registry-restart-"));
  let runtime = new HostRuntime(directory, new LocalEngine(null));
  try {
    await runtime.openAdmin();
    runtime.setCapability("home.write", true);
    await runtime.shutdown();
    const db = new DatabaseSync(path.join(directory, "acos.sqlite"));
    try {
      const state = JSON.parse(
        db.prepare("SELECT value FROM state WHERE id=1").get()!.value as string,
      );
      const fake = state.capabilities.find(
        (c: { id: string }) => c.id === "network.request",
      );
      Object.assign(fake, {
        attached: true,
        available: true,
        enabled: true,
        provider: "Stored invented provider",
        target: "companion/home",
        minimumMode: "SAFE",
      });
      state.capabilities.push({ ...fake, id: "stored.unknown" });
      // Emulate a schema-v1 state written before attachment was explicit.
      for (const c of state.capabilities) delete c.attached;
      db.prepare("UPDATE state SET value=? WHERE id=1").run(
        JSON.stringify(state),
      );
    } finally {
      db.close();
    }
    runtime = new HostRuntime(directory, new LocalEngine(null));
    const state = runtime.snapshot();
    assert.equal(cap(state, "home.write").enabled, true);
    assert.equal(cap(state, "home.write").attached, true);
    assert.equal(cap(state, "network.request").attached, false);
    assert.equal(cap(state, "network.request").enabled, false);
    assert.equal(cap(state, "network.request").target, "None configured");
    assert.equal(cap(state, "network.request").minimumMode, "INTERMEDIATE");
    assert.equal(
      state.capabilities.some((c) => c.id === "stored.unknown"),
      false,
    );
    await assert.rejects(
      runtime.run(
        "network.request",
        "write",
        "companion/home",
        "must not save",
      ),
      /not attached/,
    );
    assert.deepEqual(runtime.snapshot().companion.memories, []);
  } finally {
    await runtime.shutdown();
    rmSync(directory, { recursive: true, force: true });
  }
});

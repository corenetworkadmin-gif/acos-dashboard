import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { LocalEngine } from "./engine.ts";
import { HostRuntime } from "./runtime.ts";
import { createHostServer } from "./server.ts";
import {
  ProviderRegistry,
  NetworkProvider,
  DeviceProvider,
  RemoteProvider,
  type DeviceBridge,
  type Provider,
  type ProviderContext,
  type ProviderResult,
  type RemoteTransport,
} from "./providers.ts";

type Snapshot = ReturnType<HostRuntime["snapshot"]>;

// A deterministic provider double so a successful provider-backed execution can
// be exercised without touching the network.
class FakeNetworkProvider implements Provider {
  readonly capability = "network.request";
  readonly name = "Fake network provider";
  readonly description = "Test double for the network capability.";
  calls: string[] = [];
  private isAttached = false;
  private allow: string[] = [];

  probe() {
    return { available: true, reason: null };
  }
  attach(config: unknown) {
    this.isAttached = true;
    this.allow = ((config as { hosts?: string[] })?.hosts ?? []).map((h) =>
      h.toLowerCase(),
    );
  }
  detach() {
    this.isAttached = false;
    this.allow = [];
  }
  attached() {
    return this.isAttached;
  }
  target() {
    return this.isAttached ? this.allow.join(",") : "None configured";
  }
  authorizeTarget(target: string) {
    if (!this.isAttached) return "No governed provider is attached.";
    return this.allow.some((host) => target.toLowerCase().includes(host))
      ? null
      : "Host is not in the attached allowlist.";
  }
  async execute(context: ProviderContext): Promise<ProviderResult> {
    this.calls.push(context.target);
    return { output: `fetched ${context.target}`, detail: { host: context.target } };
  }
}

async function serve(directory: string, providers?: ProviderRegistry) {
  const runtime = new HostRuntime(
    directory,
    new LocalEngine(null),
    providers ? { providers } : {},
  );
  const key = "c".repeat(64); // Synthetic local test identity.
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
  assert.ok(result, `capability ${id} missing`);
  return result;
};

test("provider-backed capabilities are default-denied and cannot be enabled without an attached provider", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "acos-gov-default-"));
  const host = await serve(directory);
  try {
    const initial = await host.state();
    for (const id of [
      "network.request",
      "device.microphone",
      "device.camera",
      "remote.execute",
    ]) {
      const c = cap(initial, id);
      assert.equal(c.attached, false, id);
      assert.equal(c.available, false, id);
      assert.equal(c.enabled, false, id);
      assert.equal(c.authorization.allowed, false, id);
      assert.match(c.authorization.reason!, /not attached/i);
    }
    await host.command({ type: "openAdmin" });
    await host.command({ type: "mode", mode: "ADVANCED" });
    const denied = await host.command(
      { type: "capability", id: "network.request", enabled: true },
      400,
    );
    assert.match(denied.error!, /not attached/);
    await host.command({ type: "closeAdmin" });
    const run = await host.command(
      {
        type: "run",
        capability: "network.request",
        action: "request",
        target: "https://example.com/",
        input: "https://example.com/",
      },
      400,
    );
    assert.match(run.error!, /not attached/i);
    assert.equal(host.runtime.snapshot().operations[0].status, "DENIED");
  } finally {
    await host.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("attaching a provider is a host fact; enabling is a separate grant; execution runs through the provider", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "acos-gov-run-"));
  const provider = new FakeNetworkProvider();
  const host = await serve(directory, new ProviderRegistry([provider]));
  try {
    await host.command({ type: "openAdmin" });
    await host.command({ type: "mode", mode: "ADVANCED" });
    const baseline = (await host.state()).policyVersion;
    const attached = (
      await host.command({
        type: "attachProvider",
        capability: "network.request",
        config: { hosts: ["example.com"] },
      })
    ).state;
    assert.equal(cap(attached, "network.request").attached, true);
    assert.equal(cap(attached, "network.request").available, true);
    // Attaching is a host fact; it grants no policy authority on its own.
    assert.equal(cap(attached, "network.request").enabled, false);
    assert.equal(attached.policyVersion, baseline);
    const enabled = (
      await host.command({
        type: "capability",
        id: "network.request",
        enabled: true,
      })
    ).state;
    assert.equal(cap(enabled, "network.request").enabled, true);
    assert.equal(enabled.policyVersion, baseline + 1);
    await host.command({ type: "closeAdmin" });
    const run = await host.command({
      type: "run",
      capability: "network.request",
      action: "request",
      target: "https://example.com/page",
      input: "https://example.com/page",
    });
    assert.equal(host.runtime.snapshot().operations[0].status, "COMPLETED");
    assert.deepEqual(provider.calls, ["https://example.com/page"]);
    assert.deepEqual(run.result, {
      output: "fetched https://example.com/page",
      detail: { host: "https://example.com/page" },
    });
  } finally {
    await host.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("detaching a provider revokes the dependent policy grant", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "acos-gov-detach-"));
  const host = await serve(directory, new ProviderRegistry([new FakeNetworkProvider()]));
  try {
    await host.command({ type: "openAdmin" });
    await host.command({ type: "mode", mode: "ADVANCED" });
    await host.command({
      type: "attachProvider",
      capability: "network.request",
      config: { hosts: ["example.com"] },
    });
    const enabled = (
      await host.command({
        type: "capability",
        id: "network.request",
        enabled: true,
      })
    ).state;
    const detached = (
      await host.command({ type: "detachProvider", capability: "network.request" })
    ).state;
    assert.equal(cap(detached, "network.request").attached, false);
    assert.equal(cap(detached, "network.request").enabled, false);
    assert.equal(detached.policyVersion, enabled.policyVersion + 1);
    await host.command({ type: "closeAdmin" });
    const run = await host.command(
      {
        type: "run",
        capability: "network.request",
        action: "request",
        target: "https://example.com/",
        input: "https://example.com/",
      },
      400,
    );
    assert.match(run.error!, /not attached/i);
  } finally {
    await host.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the provider's own target allowlist is enforced during admission", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "acos-gov-allow-"));
  const host = await serve(directory, new ProviderRegistry([new NetworkProvider()]));
  try {
    await host.command({ type: "openAdmin" });
    await host.command({ type: "mode", mode: "ADVANCED" });
    await host.command({
      type: "attachProvider",
      capability: "network.request",
      config: { hosts: ["localhost"] },
    });
    await host.command({
      type: "capability",
      id: "network.request",
      enabled: true,
    });
    await host.command({ type: "closeAdmin" });
    const run = (target: string, action = "request") =>
      host.command(
        {
          type: "run",
          capability: "network.request",
          action,
          target,
          input: target,
        },
        400,
      );
    assert.match((await run("http://localhost/")).error!, /private or loopback/);
    assert.match(
      (await run("https://example.com/")).error!,
      /not in the attached allowlist/,
    );
    assert.match(
      (await run("http://localhost/", "write")).error!,
      /Action does not match/,
    );
    assert.equal(host.runtime.snapshot().operations[0].status, "DENIED");
  } finally {
    await host.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a device capability cannot be attached when no bridge exists", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "acos-gov-nodev-"));
  const host = await serve(directory);
  try {
    await host.command({ type: "openAdmin" });
    const res = await host.command(
      { type: "attachProvider", capability: "device.microphone", config: {} },
      400,
    );
    assert.match(res.error!, /No microphone bridge/);
    assert.equal(cap(await host.state(), "device.microphone").attached, false);
  } finally {
    await host.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a device capability executes through an injected bridge", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "acos-gov-dev-"));
  const bridge: DeviceBridge = {
    async capture({ device }) {
      return { summary: `captured ${device}`, detail: { device } };
    },
  };
  const host = await serve(
    directory,
    new ProviderRegistry([new DeviceProvider("microphone", bridge)]),
  );
  try {
    await host.command({ type: "openAdmin" });
    await host.command({ type: "mode", mode: "ADVANCED" });
    const attached = (
      await host.command({
        type: "attachProvider",
        capability: "device.microphone",
        config: {},
      })
    ).state;
    assert.equal(cap(attached, "device.microphone").attached, true);
    assert.equal(cap(attached, "device.microphone").available, true);
    await host.command({
      type: "capability",
      id: "device.microphone",
      enabled: true,
    });
    await host.command({ type: "closeAdmin" });
    const run = await host.command({
      type: "run",
      capability: "device.microphone",
      action: "capture",
      target: "microphone",
      input: "",
    });
    assert.equal(host.runtime.snapshot().operations[0].status, "COMPLETED");
    assert.deepEqual(run.result, {
      output: "captured microphone",
      detail: { device: "microphone" },
    });
  } finally {
    await host.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("remote execution requires an attached endpoint and runs through the transport", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "acos-gov-remote-"));
  const calls: { target: string; command: string }[] = [];
  const transport: RemoteTransport = {
    async execute({ target, command }) {
      calls.push({ target, command });
      return { output: `ran ${command}`, exitCode: 0 };
    },
  };
  const host = await serve(
    directory,
    new ProviderRegistry([new RemoteProvider(transport)]),
  );
  try {
    await host.command({ type: "openAdmin" });
    await host.command({ type: "mode", mode: "ADVANCED" });
    await host.command({
      type: "attachProvider",
      capability: "remote.execute",
      config: { target: "host-1" },
    });
    await host.command({ type: "capability", id: "remote.execute", enabled: true });
    await host.command({ type: "closeAdmin" });
    const run = await host.command({
      type: "run",
      capability: "remote.execute",
      action: "execute",
      target: "host-1",
      input: "uptime",
    });
    assert.equal(host.runtime.snapshot().operations[0].status, "COMPLETED");
    assert.deepEqual(calls, [{ target: "host-1", command: "uptime" }]);
    assert.deepEqual(run.result, { output: "ran uptime", detail: { exitCode: 0 } });
    const wrong = await host.command(
      {
        type: "run",
        capability: "remote.execute",
        action: "execute",
        target: "host-2",
        input: "uptime",
      },
      400,
    );
    assert.match(wrong.error!, /does not match/);
  } finally {
    await host.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("installing an extension is inert: no capability facts change and grants are empty", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "acos-gov-ext-"));
  const host = await serve(directory);
  try {
    await host.command({ type: "openAdmin" });
    const before = await host.state();
    const installed = await host.command({
      type: "installExtension",
      manifest: {
        id: "acme.tools",
        name: "Acme Tools",
        version: "1.0.0",
        requests: ["network.request"],
        tools: ["network.request"],
      },
    });
    const report = installed.result as {
      grants: unknown[];
      requests: { capability: string; known: boolean }[];
    };
    assert.deepEqual(report.grants, []);
    assert.deepEqual(report.requests, [
      { capability: "network.request", known: true, enabled: false, attached: false },
    ]);
    const after = await host.state();
    assert.equal(after.policyVersion, before.policyVersion);
    assert.equal(cap(after, "network.request").enabled, false);
    assert.equal(cap(after, "network.request").attached, false);
    assert.equal(after.extensions.length, 1);
    assert.equal(after.extensions[0].id, "acme.tools");
    await host.command({ type: "removeExtension", id: "acme.tools" });
    assert.equal((await host.state()).extensions.length, 0);
    await host.command({ type: "closeAdmin" });
  } finally {
    await host.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("extension commands require an administrator session and validate manifests", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "acos-gov-extadmin-"));
  const host = await serve(directory);
  try {
    const noAdmin = await host.command(
      {
        type: "installExtension",
        manifest: { id: "acme.tools", name: "Acme Tools", version: "1.0.0" },
      },
      400,
    );
    assert.match(noAdmin.error!, /administrator/i);
    await host.command({ type: "openAdmin" });
    await host.command(
      {
        type: "installExtension",
        manifest: { id: "Bad Id", name: "Acme Tools", version: "1.0.0" },
      },
      400,
    );
    assert.equal((await host.state()).extensions.length, 0);
    await host.command({ type: "closeAdmin" });
  } finally {
    await host.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("probeProviders reports the registry without granting anything", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "acos-gov-probe-"));
  const host = await serve(directory);
  try {
    const res = await host.command({ type: "probeProviders" });
    const summaries = res.result as {
      capability: string;
      attached: boolean;
      available: boolean;
    }[];
    assert.equal(summaries.length, 4);
    for (const summary of summaries) {
      assert.equal(summary.attached, false);
      assert.equal(summary.available, false);
    }
    assert.equal((await host.state()).policyVersion, 1);
  } finally {
    await host.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

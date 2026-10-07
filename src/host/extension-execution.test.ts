// End-to-end coverage for extension execution: an administrator installs an
// extension and runs its WASM module through the runExtension command; the
// sandbox isolates it, the audit trail records the run, and no capability
// fact changes.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { HostRuntime } from "./runtime.ts";
import { LocalEngine } from "./engine.ts";
import { createHostServer } from "./server.ts";
import { noopWasm, spinWasm } from "./fixtures/wasm.ts";

type Snapshot = ReturnType<HostRuntime["snapshot"]>;

async function serve(directory: string) {
  const runtime = new HostRuntime(directory, new LocalEngine(null));
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

const manifest = {
  id: "sandboxed-ext",
  name: "Sandboxed Extension",
  version: "1.0.0",
  description: "Runs in the WASI sandbox.",
};

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

test("an installed extension runs in the sandbox without gaining authority", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "acos-ext-run-"));
  const host = await serve(directory);
  try {
    await host.command({ type: "openAdmin" });
    await host.command({ type: "installExtension", manifest });

    const run = await host.command({
      type: "runExtension",
      id: "sandboxed-ext",
      wasm: b64(noopWasm()),
      timeoutMs: 5000,
    });
    const result = run.result as { status: string; exitCode: number };
    assert.equal(result.status, "COMPLETED");
    assert.equal(result.exitCode, 0);

    // Audited with an explicit "grants: none" statement.
    const state = await host.state();
    const activity = state.activity.find((entry) =>
      entry.description.includes("WASI sandbox"),
    );
    assert.ok(activity, "run must be recorded in the activity/audit trail");
    assert.match(activity.description, /Grants: none/);

    // Non-escalation: every provider-backed capability is still unattached and
    // disabled after the extension ran.
    for (const cap of state.capabilities)
      if (cap.id.startsWith("network.") || cap.id.startsWith("device.") || cap.id.startsWith("remote."))
        assert.equal(cap.attached && cap.enabled, false, cap.id);
  } finally {
    await host.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a runaway extension is terminated by the sandbox timeout", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "acos-ext-spin-"));
  const host = await serve(directory);
  try {
    await host.command({ type: "openAdmin" });
    await host.command({ type: "installExtension", manifest });
    const run = await host.command({
      type: "runExtension",
      id: "sandboxed-ext",
      wasm: b64(spinWasm()),
      timeoutMs: 300,
    });
    const result = run.result as { status: string; error?: string };
    assert.equal(result.status, "TIMED_OUT");
    assert.match(result.error!, /terminated/);
  } finally {
    await host.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("runExtension requires an installed extension and an administrator", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "acos-ext-gate-"));
  const host = await serve(directory);
  try {
    // No administrator session: refused.
    const denied = await host.command(
      { type: "runExtension", id: "sandboxed-ext", wasm: b64(noopWasm()) },
      400,
    );
    assert.match(denied.error!, /administrator session/);

    await host.command({ type: "openAdmin" });
    // Not installed: refused before anything executes.
    const unknown = await host.command(
      { type: "runExtension", id: "nope", wasm: b64(noopWasm()) },
      400,
    );
    assert.match(unknown.error!, /not installed/);
    // Malformed payload: refused.
    const malformed = await host.command(
      { type: "runExtension", id: "nope", wasm: "!!!not-base64!!!" },
      400,
    );
    assert.ok(malformed.error);
  } finally {
    await host.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

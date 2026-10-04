import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

async function reserve() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    server,
    port: address.port,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
function launch(hostPort: number, uiPort: number, data: string) {
  // Explicitly isolate test fixtures from the user's model, Home, key, and port settings.
  const env = {
    ...process.env,
    ACOS_PORT: String(hostPort),
    ACOS_DASHBOARD_PORT: String(uiPort),
    ACOS_DATA_DIR: data,
    ACOS_ENGINE_BINARY: "",
    ACOS_MODEL_PATH: "",
    ACOS_MODEL_SHA256: "",
  };
  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", "src/host/launch.ts"],
    { env, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });
  const exited = new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", resolve);
  });
  return { child, exited, output: () => output };
}
async function untilReady(run: ReturnType<typeof launch>) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (run.output().includes("ACOS is ready:")) return;
    if (run.child.exitCode !== null) throw new Error(run.output());
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Launcher readiness timed out: " + run.output());
}
async function portIsFree(port: number) {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
}
test(
  "combined launcher serves built UI and host API through custom ports, then stops both",
  { timeout: 30000 },
  async () => {
    const host = await reserve(),
      ui = await reserve();
    const dir = mkdtempSync(path.join(tmpdir(), "acos-launch-"));
    await host.close();
    await ui.close();
    const run = launch(host.port, ui.port, dir);
    try {
      await untilReady(run);
      const base = `http://127.0.0.1:${ui.port}`;
      const response = await fetch(base + "/api/health");
      assert.equal(response.status, 200);
      assert.equal(
        ((await response.json()) as { service: string }).service,
        "acos-host",
      );
      assert.equal((await fetch(base + "/api/state")).status, 401);
      assert.match(await (await fetch(base + "/companion")).text(), /ACOS/);
      run.child.kill("SIGTERM");
      assert.equal(await run.exited, 0);
      await portIsFree(host.port);
      await portIsFree(ui.port);
    } finally {
      if (run.child.exitCode === null && run.child.signalCode === null)
        run.child.kill("SIGTERM");
      await run.exited;
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
test(
  "an occupied dashboard port is rejected without starting a host or killing its owner",
  { timeout: 10000 },
  async () => {
    const host = await reserve(),
      ui = await reserve();
    const dir = mkdtempSync(path.join(tmpdir(), "acos-launch-busy-"));
    await host.close();
    const run = launch(host.port, ui.port, dir);
    try {
      assert.equal(await run.exited, 1);
      assert.match(run.output(), /in use/);
      assert.equal(ui.server.listening, true);
      await portIsFree(host.port);
    } finally {
      await ui.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

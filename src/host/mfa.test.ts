import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { totp, TotpGate } from "./mfa.ts";
test("TOTP matches RFC 6238 SHA1 vector and fences replay across restart", () => {
  const secret = Buffer.from("12345678901234567890");
  assert.equal(totp(secret, 1, 8), "94287082");
  const root = mkdtempSync(path.join(tmpdir(), "acos-mfa-"));
  const file = path.join(root, "mfa.json");
  try {
    writeFileSync(
      file,
      JSON.stringify({
        secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
        lastCounter: -1,
      }),
      { mode: 0o600 },
    );
    const gate = new TotpGate(file);
    assert.equal(gate.verify("wrong", 59_000), false);
    assert.equal(gate.verify("287082", 59_000), true);
    assert.equal(new TotpGate(file).verify("287082", 59_000), false);
    assert.equal(gate.verify(totp(secret, 10), 59_000), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("HTTP unlock requires both factors and does not consume a code on a wrong administrator key", async () => {
  const { HostRuntime } = await import("./runtime.ts");
  const { LocalEngine } = await import("./engine.ts");
  const { createHostServer } = await import("./server.ts");
  const root = mkdtempSync(path.join(tmpdir(), "acos-mfa-http-"));
  const file = path.join(root, "mfa.json");
  writeFileSync(
    file,
    JSON.stringify({
      secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
      lastCounter: -1,
    }),
    { mode: 0o600 },
  );
  const runtime = new HostRuntime(root, new LocalEngine(null));
  const server = createHostServer(
    runtime,
    "synthetic-admin-key",
    new TotpGate(file),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const login = (key: string, otp: string) =>
    fetch(`http://127.0.0.1:${address.port}/api/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key, otp }),
    });
  try {
    const otp = totp(
      Buffer.from("12345678901234567890"),
      Math.floor(Date.now() / 30_000),
    );
    assert.equal((await login("wrong", otp)).status, 401);
    assert.equal((await login("synthetic-admin-key", "")).status, 401);
    assert.equal((await login("synthetic-admin-key", otp)).status, 200);
    assert.equal((await login("synthetic-admin-key", otp)).status, 401);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await runtime.shutdown();
    rmSync(root, { recursive: true, force: true });
  }
});

import { TotpGate, totp } from "./mfa.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { AdminIdentityGate, parseIdentityChallenge } from "./identity.ts";
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pub = pair.publicKey.export({ format: "pem", type: "spki" }).toString();
const signature = (token: string) =>
  sign("sha256", Buffer.from(token), pair.privateKey).toString("base64");
test("admin proof binds nonce, host, installation and expiry and rejects replay/restart", () => {
  const gate = new AdminIdentityGate(pub, "a".repeat(64));
  const token = gate.issue("localhost:8080", 1000);
  assert.equal(parseIdentityChallenge(token).installation, "a".repeat(64));
  assert.equal(
    gate.verify(token, signature(token), "localhost:8080", 1001),
    true,
  );
  assert.equal(
    gate.verify(token, signature(token), "localhost:8080", 1002),
    false,
  );
  const other = gate.issue("localhost:8080", 1000);
  assert.equal(gate.verify(other, signature(other), "attacker", 1001), false);
  assert.equal(
    gate.verify(other, signature(other), "localhost:8080", 1001),
    false,
  );
  const expired = gate.issue("localhost:8080", 1000);
  assert.equal(
    gate.verify(expired, signature(expired), "localhost:8080", 121000),
    false,
  );
  const lost = gate.issue("localhost:8080", 1000);
  assert.equal(
    new AdminIdentityGate(pub, "a".repeat(64)).verify(
      lost,
      signature(lost),
      "localhost:8080",
      1001,
    ),
    false,
  );
  for (let n = 0; n < 7; n++) gate.issue("localhost", 1000);
  assert.throws(() => gate.issue("localhost", 1000), /Too many/);
  assert.ok(gate.issue("localhost", 122000));
});
test("HTTP login requires configured identity proof, administrator key and TOTP", async () => {
  const { HostRuntime } = await import("./runtime.ts");
  const { LocalEngine } = await import("./engine.ts");
  const { createHostServer } = await import("./server.ts");
  const directory = mkdtempSync(path.join(tmpdir(), "acos-identity-http-"));
  const runtime = new HostRuntime(directory, new LocalEngine(null));
  const gate = new AdminIdentityGate(pub, "b".repeat(64));
  const mfaFile = path.join(directory, "test-mfa.json");
  writeFileSync(
    mfaFile,
    JSON.stringify({
      secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
      lastCounter: -1,
    }),
    { mode: 0o600 },
  );
  const server = createHostServer(
    runtime,
    "fixture-admin",
    new TotpGate(mfaFile),
    gate,
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/`;
  const post = (route: string, body: unknown) =>
    fetch(url + route, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  try {
    assert.equal(
      (await post("identity-challenge", { key: "wrong" })).status,
      401,
    );
    assert.equal((await post("login", { key: "fixture-admin" })).status, 401);
    const response = await post("identity-challenge", { key: "fixture-admin" });
    assert.equal(response.status, 200);
    const { challenge } = (await response.json()) as { challenge: string };
    const body = {
      key: "fixture-admin",
      challenge,
      signature: signature(challenge),
      otp: totp(
        Buffer.from("12345678901234567890"),
        Math.floor(Date.now() / 30000),
      ),
    };
    assert.equal((await post("login", body)).status, 200);
    assert.equal((await post("login", body)).status, 401);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await runtime.shutdown();
    rmSync(directory, { recursive: true, force: true });
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { generateKeyPairSync } from "node:crypto";
import { HostRuntime } from "./runtime.ts";
import { LocalEngine } from "./engine.ts";
import { verifyPayload, signPayload } from "./trust.ts";
import { JobContainment } from "./containment.ts";

test("backup restoration keeps revoked authority, rejects tampering and cross-host copying", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "acos-recovery-"));
  const runtime = new HostRuntime(path.join(root, "a"), new LocalEngine(null));
  const other = new HostRuntime(path.join(root, "b"), new LocalEngine(null));
  try {
    assert.throws(() => runtime.exportBackup(), /administrator/);
    await runtime.openAdmin();
    runtime.setCapability("home.write", true);
    runtime.closeAdmin();
    await runtime.run(
      "home.write",
      "write",
      "companion/home",
      "Remember this recovery test",
    );
    await runtime.openAdmin();
    const backup = runtime.exportBackup();
    assert.ok(!JSON.stringify(backup).includes("Remember"));
    runtime.setCapability("home.write", false);
    assert.throws(() => runtime.restoreBackup(backup, false), /Confirm/);
    runtime.restoreBackup(backup, true);
    assert.equal(
      runtime.snapshot().capabilities.find((c) => c.id === "home.write")
        ?.enabled,
      false,
    );
    assert.equal(runtime.snapshot().paused, true);
    assert.equal(runtime.verifyStorage().ok, true);
    const changed = {
      ...backup,
      sealed: backup.sealed.slice(0, -8) + "AAAAAAAA",
    };
    assert.throws(() => runtime.restoreBackup(changed, true), /integrity/);
    await other.openAdmin();
    assert.throws(() => other.restoreBackup(backup, true), /integrity/);
    const anchor = runtime.exportAuditAnchor();
    const { publicKey, ...envelope } = anchor;
    const verified = JSON.parse(verifyPayload(envelope, publicKey));
    assert.equal(verified.purpose, "acos-audit-anchor-v1");
    assert.ok(verified.sequence > 0);
    assert.equal(verified.hash.length, 64);
    assert.throws(
      () =>
        verifyPayload(
          { ...envelope, payload: envelope.payload + " " },
          publicKey,
        ),
      /Signature/,
    );
  } finally {
    await runtime.shutdown();
    await other.shutdown();
    rmSync(root, { recursive: true, force: true });
  }
});
test("signed payloads cannot nominate their own trusted signer", () => {
  const a = generateKeyPairSync("ed25519"),
    b = generateKeyPairSync("ed25519");
  const envelope = signPayload(
    "release",
    a.privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
  );
  assert.throws(
    () =>
      verifyPayload(
        envelope,
        b.publicKey.export({ format: "pem", type: "spki" }).toString(),
      ),
    /Signature/,
  );
});
test("ordinary directories cannot masquerade as OS resource containment", () => {
  const root = mkdtempSync(path.join(tmpdir(), "acos-fake-cgroup-"));
  try {
    assert.throws(
      () => new JobContainment(root, 128 * 1024 ** 2, 32),
      /cgroup v2/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

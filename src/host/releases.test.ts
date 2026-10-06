import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { signPayload } from "./trust.ts";
import { verifyRelease, verifyArtifact } from "./releases.ts";
test("release trust refuses rollback, wrong target, expiry, mutation and corrupt artifacts", async () => {
  const pair = generateKeyPairSync("ed25519");
  const privateKey = pair.privateKey
    .export({ format: "pem", type: "pkcs8" })
    .toString();
  const publicKey = pair.publicKey
    .export({ format: "pem", type: "spki" })
    .toString();
  const raw = {
    purpose: "acos-release-v1",
    stateSchema: 1,
    version: "0.2.0",
    sequence: 2,
    platform: "linux",
    architecture: "x64",
    expiresAt: 1000,
    artifact: {
      name: "acos-test.tar.gz",
      bytes: 4,
      sha256: createHash("sha256").update("data").digest("hex"),
    },
  };
  const signed = signPayload(JSON.stringify(raw), privateKey);
  const policy = {
    sequence: 1,
    platform: "linux",
    architecture: "x64",
    now: 10,
  };
  const manifest = verifyRelease(signed, publicKey, policy);
  assert.throws(
    () => verifyRelease(signed, publicKey, { ...policy, sequence: 2 }),
    /rollback/,
  );
  assert.throws(
    () => verifyRelease(signed, publicKey, { ...policy, now: 1000 }),
    /expired/,
  );
  assert.throws(
    () => verifyRelease(signed, publicKey, { ...policy, platform: "win32" }),
    /target/,
  );
  assert.throws(
    () =>
      verifyRelease(
        { ...signed, payload: signed.payload.replace("0.2.0", "0.3.0") },
        publicKey,
        policy,
      ),
    /Signature/,
  );
  const directory = mkdtempSync(path.join(tmpdir(), "acos-release-"));
  try {
    const file = path.join(directory, "artifact");
    writeFileSync(file, "data");
    await verifyArtifact(file, manifest);
    writeFileSync(file, "evil");
    await assert.rejects(verifyArtifact(file, manifest), /integrity/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

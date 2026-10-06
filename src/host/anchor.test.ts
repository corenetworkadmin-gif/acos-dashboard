import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { signPayload } from "./trust.ts";
import { compareCheckpoint } from "./anchor.ts";
const pair = generateKeyPairSync("ed25519");
const pub = pair.publicKey.export({ format: "pem", type: "spki" }).toString();
const priv = pair.privateKey
  .export({ format: "pem", type: "pkcs8" })
  .toString();
const payload = {
  purpose: "acos-audit-anchor-v1",
  companion: "fixture",
  sequence: 5,
  hash: "a".repeat(64),
  createdAt: 100,
};
const signed = signPayload(JSON.stringify(payload), priv);
test("external checkpoints detect validly rehashed history and truncation", () => {
  const journal = {
    companion: "fixture",
    sequence: 10,
    hashAt: () => payload.hash,
  };
  assert.equal(compareCheckpoint(signed, pub, journal).laterEntries, 5);
  assert.throws(
    () => compareCheckpoint(signed, pub, { ...journal, sequence: 4 }),
    /rollback/,
  );
  assert.throws(
    () =>
      compareCheckpoint(signed, pub, {
        ...journal,
        hashAt: () => "b".repeat(64),
      }),
    /diverges/,
  );
  assert.throws(
    () => compareCheckpoint(signed, pub, { ...journal, companion: "other" }),
    /different companion/,
  );
  const other = generateKeyPairSync("ed25519")
    .publicKey.export({ format: "pem", type: "spki" })
    .toString();
  assert.throws(
    () => compareCheckpoint({ ...signed, publicKey: pub }, other, journal),
    /Signature/,
  );
  assert.throws(() =>
    compareCheckpoint(
      signPayload(JSON.stringify({ ...payload, purpose: "other" }), priv),
      pub,
      journal,
    ),
  );
});

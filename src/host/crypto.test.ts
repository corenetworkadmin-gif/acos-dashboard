import test from "node:test";
import assert from "node:assert/strict";
import {
  decryptValue,
  encryptValue,
  generateStorageKey,
  isEncrypted,
  storageFingerprint,
} from "./crypto.ts";

test("encrypt/decrypt round-trips and hides the plaintext", () => {
  const key = generateStorageKey();
  const sealed = encryptValue(key, "a private memory", "home");
  assert.ok(isEncrypted(sealed));
  assert.ok(!sealed.includes("a private memory"));
  assert.equal(decryptValue(key, sealed, "home"), "a private memory");
});

test("ciphertext is non-deterministic yet always decrypts", () => {
  const key = generateStorageKey();
  const a = encryptValue(key, "same", "home");
  const b = encryptValue(key, "same", "home");
  assert.notEqual(a, b);
  assert.equal(decryptValue(key, a, "home"), "same");
  assert.equal(decryptValue(key, b, "home"), "same");
});

test("tampering with the ciphertext is detected", () => {
  const key = generateStorageKey();
  const sealed = encryptValue(key, "important", "home");
  const parts = sealed.split(".");
  const flipped = Buffer.from(parts[3], "base64");
  flipped[0] ^= 0xff;
  const tampered = [parts[0], parts[1], parts[2], flipped.toString("base64")].join(
    ".",
  );
  assert.throws(() => decryptValue(key, tampered, "home"), /integrity/);
});

test("a different key or wrong purpose label cannot decrypt", () => {
  const key = generateStorageKey();
  const sealed = encryptValue(key, "secret", "home");
  assert.throws(() => decryptValue(generateStorageKey(), sealed, "home"), /integrity/);
  assert.throws(() => decryptValue(key, sealed, "messages"), /integrity/);
});

test("non-envelopes are rejected and fingerprints are stable and non-secret", () => {
  const key = generateStorageKey();
  assert.equal(isEncrypted("plain json"), false);
  assert.throws(() => decryptValue(key, "plain json", "home"), /envelope/);
  assert.equal(storageFingerprint(key), storageFingerprint(key));
  assert.equal(storageFingerprint(key).length, 16);
  assert.ok(!storageFingerprint(key).includes(key.toString("hex")));
});

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

// At-rest encryption for companion storage (architecture 17, 41, 53). Companion
// Home memories and conversation messages are sealed with a host key using
// AES-256-GCM, which provides confidentiality and an integrity tag. The key never
// enters AI context and is stored separately from the encrypted data.

const PREFIX = "acos1";

export function generateStorageKey(): Buffer {
  return randomBytes(32);
}

export function isEncrypted(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(`${PREFIX}.`);
}

// Seals a UTF-8 string. The additional-authenticated-data label binds a ciphertext
// to its purpose, so a sealed Home value cannot be replayed as a message.
export function encryptValue(
  key: Buffer,
  plaintext: string,
  aad = "",
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad, "utf8"));
  const sealed = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    PREFIX,
    iv.toString("base64"),
    tag.toString("base64"),
    sealed.toString("base64"),
  ].join(".");
}

export function decryptValue(key: Buffer, payload: string, aad = ""): string {
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== PREFIX)
    throw new Error("Storage value is not a recognized sealed envelope.");
  const iv = Buffer.from(parts[1], "base64");
  const tag = Buffer.from(parts[2], "base64");
  const sealed = Buffer.from(parts[3], "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  if (aad) decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(sealed), decipher.final()]).toString(
      "utf8",
    );
  } catch {
    throw new Error(
      "Storage integrity check failed: the value was tampered with or the host key is wrong.",
    );
  }
}

// A short, non-secret fingerprint of the key for diagnostics and audit. It never
// reveals the key itself.
export function storageFingerprint(key: Buffer): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
  createHash,
} from "node:crypto";
import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

export const signedEnvelopeSchema = z
  .object({
    payload: z.string().max(2_000_000),
    signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/),
  })
  .strict();
export function signPayload(payload: string, privateKey: string) {
  const key = createPrivateKey(privateKey);
  if (key.asymmetricKeyType !== "ed25519")
    throw new Error("Ed25519 signing key required.");
  return {
    payload,
    signature: sign(null, Buffer.from(payload), key).toString("base64"),
  };
}
export function verifyPayload(
  input: unknown,
  trustedPublicKey: string,
): string {
  const envelope = signedEnvelopeSchema.parse(input);
  const key = createPublicKey(trustedPublicKey);
  if (
    key.asymmetricKeyType !== "ed25519" ||
    !verify(
      null,
      Buffer.from(envelope.payload),
      key,
      Buffer.from(envelope.signature, "base64"),
    )
  )
    throw new Error("Signature verification failed.");
  return envelope.payload;
}
export function publicKeyFingerprint(publicKey: string) {
  return createHash("sha256")
    .update(createPublicKey(publicKey).export({ format: "der", type: "spki" }))
    .digest("hex");
}
export class HostIdentity {
  private key: string;
  readonly publicKey: string;
  constructor(directory: string) {
    const file = path.join(directory, "identity.key");
    if (!existsSync(file)) {
      const pair = generateKeyPairSync("ed25519");
      writeFileSync(
        file,
        pair.privateKey.export({ format: "pem", type: "pkcs8" }),
        { flag: "wx", mode: 0o600 },
      );
    }
    chmodSync(file, 0o600);
    this.key = readFileSync(file, "utf8");
    if (createPrivateKey(this.key).asymmetricKeyType !== "ed25519")
      throw new Error("Invalid host identity key.");
    this.publicKey = createPublicKey(this.key)
      .export({ format: "pem", type: "spki" })
      .toString();
  }
  sign(payload: unknown) {
    return signPayload(JSON.stringify(payload), this.key);
  }
}

import { createPublicKey, randomBytes, verify, constants } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  lstatSync,
  readFileSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { publicKeyFingerprint } from "./trust.ts";
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
const challengeSchema = z
  .object({
    purpose: z.literal("acos-admin-proof-v1"),
    nonce: z.string().regex(/^[a-f0-9]{64}$/),
    installation: fingerprint,
    keyFingerprint: fingerprint,
    host: z.string().min(1).max(255),
    expires: z.number().int().safe().positive(),
  })
  .strict();
export function parseIdentityChallenge(token: string) {
  if (!/^[A-Za-z0-9_-]{1,2000}$/.test(token))
    throw new Error("Malformed identity challenge.");
  return challengeSchema.parse(
    JSON.parse(Buffer.from(token, "base64url").toString()),
  );
}
function rsaKey(pem: string) {
  const key = createPublicKey(pem);
  if (
    key.asymmetricKeyType !== "rsa" ||
    (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048
  )
    throw new Error(
      "Admin identity requires an RSA key of at least 2048 bits.",
    );
  return key;
}
// Server verifies a locally provisioned public key. Hardware provenance must be
// established out of band; no remote attestation claim is made from a PEM key.
export class AdminIdentityGate {
  private pending = new Map<string, number>();
  private publicKey: ReturnType<typeof createPublicKey>;
  readonly fingerprint: string;
  readonly installation: string;
  constructor(publicKey: string, installation: string) {
    this.publicKey = rsaKey(publicKey);
    this.fingerprint = publicKeyFingerprint(publicKey);
    this.installation = fingerprint.parse(installation);
  }
  issue(host: string, now = Date.now()) {
    for (const [token, expires] of this.pending)
      if (expires <= now) this.pending.delete(token);
    if (this.pending.size >= 8)
      throw new Error(
        "Too many pending identity challenges; wait two minutes.",
      );
    const payload = challengeSchema.parse({
      purpose: "acos-admin-proof-v1",
      nonce: randomBytes(32).toString("hex"),
      installation: this.installation,
      keyFingerprint: this.fingerprint,
      host,
      expires: now + 120000,
    });
    const token = Buffer.from(JSON.stringify(payload)).toString("base64url");
    this.pending.set(token, payload.expires);
    return token;
  }
  verify(token: string, signature: string, host: string, now = Date.now()) {
    const expires = this.pending.get(token);
    this.pending.delete(token); // Every proof attempt consumes the challenge.
    if (
      !expires ||
      expires <= now ||
      !/^[A-Za-z0-9+/]{256,1400}={0,2}$/.test(signature)
    )
      return false;
    const payload = parseIdentityChallenge(token);
    if (payload.host !== host) return false;
    return verify(
      "sha256",
      Buffer.from(token),
      { key: this.publicKey, padding: constants.RSA_PKCS1_PADDING },
      Buffer.from(signature, "base64"),
    );
  }
}
export function loadAdminIdentity(file: string, installation: string) {
  const info = lstatSync(file);
  if (
    !info.isFile() ||
    info.mode & 0o022 ||
    (process.getuid && info.uid !== process.getuid())
  )
    throw new Error(
      "Pinned admin identity must be an owned regular file without group/other write access.",
    );
  return new AdminIdentityGate(readFileSync(file, "utf8"), installation);
}

// Runs on the operator's Linux machine, never on behalf of an HTTP login. Fixed
// device TCTI prevents environment settings from substituting a software TPM.
export function signWithTpm(input: {
  token: string;
  handle: string;
  pinnedKey: string;
  installation: string;
  host: string;
  authFile?: string;
}) {
  if (process.platform !== "linux")
    throw new Error("TPM signing helper requires Linux.");
  if (!/^0x81[0-9a-fA-F]{6}$/.test(input.handle))
    throw new Error("Use a persistent TPM handle.");
  const payload = parseIdentityChallenge(input.token);
  if (
    payload.expires <= Date.now() ||
    payload.expires > Date.now() + 120000 ||
    payload.host !== input.host ||
    payload.installation !== input.installation ||
    payload.keyFingerprint !== publicKeyFingerprint(input.pinnedKey)
  )
    throw new Error(
      "Challenge does not match the pinned installation, host, key or validity window.",
    );
  rsaKey(input.pinnedKey);
  const device = lstatSync("/dev/tpmrm0");
  if (!device.isCharacterDevice())
    throw new Error("Physical TPM resource manager unavailable.");
  if (input.authFile) {
    const info = lstatSync(input.authFile);
    if (!info.isFile() || info.mode & 0o077 || info.uid !== process.getuid?.())
      throw new Error("TPM authorization file must be owner-only.");
  }
  const directory = mkdtempSync(path.join(tmpdir(), "acos-tpm-proof-"));
  const run = (command: string, args: string[]) =>
    execFileSync(command, ["-T", "device:/dev/tpmrm0", ...args], {
      env: { PATH: "/usr/bin:/bin" },
      timeout: 10000,
      maxBuffer: 64000,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  try {
    const publicFile = path.join(directory, "public.pem");
    const properties = run("/usr/bin/tpm2_readpublic", [
      "-c",
      input.handle,
      "-f",
      "pem",
      "-o",
      publicFile,
    ]);
    if (
      publicKeyFingerprint(readFileSync(publicFile, "utf8")) !==
        payload.keyFingerprint ||
      !["fixedtpm", "fixedparent", "sensitivedataorigin", "sign"].every(
        (attribute) => new RegExp(`\\b${attribute}\\b`, "i").test(properties),
      )
    )
      throw new Error(
        "TPM public key or non-exportable signing attributes do not match.",
      );
    const message = path.join(directory, "challenge"),
      signature = path.join(directory, "signature");
    writeFileSync(message, input.token, { mode: 0o600 });
    run("/usr/bin/tpm2_sign", [
      "-c",
      input.handle,
      "-g",
      "sha256",
      "-s",
      "rsassa",
      "-f",
      "plain",
      "-o",
      signature,
      ...(input.authFile ? ["-p", "file:" + input.authFile] : []),
      message,
    ]);
    const bytes = readFileSync(signature);
    if (
      !verify(
        "sha256",
        Buffer.from(input.token),
        { key: rsaKey(input.pinnedKey), padding: constants.RSA_PKCS1_PADDING },
        bytes,
      )
    )
      throw new Error("TPM produced an invalid signature.");
    return bytes.toString("base64");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

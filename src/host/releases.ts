import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { z } from "zod";
import { verifyPayload } from "./trust.ts";

export const releaseManifestSchema = z
  .object({
    purpose: z.literal("acos-release-v1"),
    stateSchema: z.literal(1),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    sequence: z.number().int().positive(),
    platform: z.enum(["linux", "win32", "darwin"]),
    architecture: z.enum(["x64", "arm64"]),
    expiresAt: z.number().int().positive(),
    artifact: z
      .object({
        name: z.string().regex(/^acos-[a-zA-Z0-9._-]+\.tar\.gz$/),
        bytes: z
          .number()
          .int()
          .positive()
          .max(2 * 1024 ** 3),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
  })
  .strict();
export function verifyRelease(
  input: unknown,
  publicKey: string,
  policy: {
    sequence: number;
    platform: string;
    architecture: string;
    now?: number;
  },
) {
  const manifest = releaseManifestSchema.parse(
    JSON.parse(verifyPayload(input, publicKey)),
  );
  if (manifest.sequence <= policy.sequence)
    throw new Error("Release rollback or replay refused.");
  if (manifest.expiresAt <= (policy.now ?? Date.now()))
    throw new Error("Release manifest expired.");
  if (
    manifest.platform !== policy.platform ||
    manifest.architecture !== policy.architecture
  )
    throw new Error("Release target does not match this host.");
  return manifest;
}
export async function verifyArtifact(
  file: string,
  manifest: z.infer<typeof releaseManifestSchema>,
) {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(file)) {
    bytes += chunk.length;
    if (bytes > manifest.artifact.bytes)
      throw new Error("Release artifact exceeds declared size.");
    hash.update(chunk);
  }
  if (
    bytes !== manifest.artifact.bytes ||
    hash.digest("hex") !== manifest.artifact.sha256
  )
    throw new Error("Release artifact integrity verification failed.");
}

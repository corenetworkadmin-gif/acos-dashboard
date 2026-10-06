import { verifyCheckpoint } from "./anchor.ts";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  releaseManifestSchema,
  verifyArtifact,
  verifyRelease,
} from "./releases.ts";
import { signPayload } from "./trust.ts";

// Explicit file-based tooling. Never accepts signing material in process argv.
async function main() {
  const [mode, input, artifact, output] = process.argv.slice(2);
  if (mode === "sign" && input && artifact && output) {
    const manifest = releaseManifestSchema.parse(
      JSON.parse(readFileSync(input, "utf8")),
    );
    await verifyArtifact(artifact, manifest);
    const keyPath = process.env.ACOS_RELEASE_SIGNING_KEY_FILE;
    if (!keyPath)
      throw new Error(
        "Set ACOS_RELEASE_SIGNING_KEY_FILE to a private Ed25519 PEM file.",
      );
    const signed = signPayload(
      JSON.stringify(manifest),
      readFileSync(keyPath, "utf8"),
    );
    writeFileSync(output, JSON.stringify(signed, null, 2), {
      flag: "wx",
      mode: 0o600,
    });
    return;
  }
  if (mode === "verify" && input && artifact) {
    const keyPath = process.env.ACOS_RELEASE_PUBLIC_KEY_FILE;
    if (!keyPath)
      throw new Error(
        "Pin ACOS_RELEASE_PUBLIC_KEY_FILE independently of the download.",
      );
    const sequence = Number(process.env.ACOS_RELEASE_CURRENT_SEQUENCE);
    if (!Number.isSafeInteger(sequence) || sequence < 0)
      throw new Error(
        "Set ACOS_RELEASE_CURRENT_SEQUENCE to the installed release sequence.",
      );
    const manifest = verifyRelease(
      JSON.parse(readFileSync(input, "utf8")),
      readFileSync(keyPath, "utf8"),
      { sequence, platform: process.platform, architecture: process.arch },
    );
    await verifyArtifact(artifact, manifest);
    console.log(
      `Verified ${manifest.version}, sequence ${manifest.sequence}. No installation performed.`,
    );
    return;
  }
  if (mode === "audit" && input && artifact) {
    const payload = verifyCheckpoint(
      JSON.parse(readFileSync(input, "utf8")),
      readFileSync(artifact, "utf8"),
    );
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  throw new Error(
    "Usage: release-cli.ts sign MANIFEST ARTIFACT OUTPUT | verify SIGNED_MANIFEST ARTIFACT | audit CHECKPOINT PINNED_PUBLIC_KEY",
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });

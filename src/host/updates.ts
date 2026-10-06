import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { verifyRelease } from "./releases.ts";
import { UpdateStore } from "./update-store.ts";
export { UpdateStore } from "./update-store.ts";
export { verifyRelease, verifyArtifact } from "./releases.ts";
export async function downloadUpdate(url: URL, max: number) {
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("Update channel requires HTTPS without URL credentials.");
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok || !response.body)
    throw new Error(`Update download failed (${response.status}).`);
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > max) throw new Error("Update download exceeds size limit.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// Verify the channel manifest before downloading bytes. UpdateStore revalidates
// under its lock before activation; an intervening release cannot lower authority.
export async function applyUpdateChannel(
  store: UpdateStore,
  url: URL,
  health: (directory: string) => Promise<void>,
  download = downloadUpdate,
) {
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("Update channel requires HTTPS without URL credentials.");
  const signed = JSON.parse((await download(url, 32000)).toString());
  const manifest = verifyRelease(signed, store.publicKey, {
    sequence: store.state().sequence,
    platform: process.platform,
    architecture: process.arch,
  });
  if (manifest.artifact.bytes > 16 * 1024 * 1024)
    throw new Error("Desktop package exceeds 16 MiB.");
  const temporary = mkdtempSync(path.join(tmpdir(), "acos-update-download-"));
  try {
    const file = path.join(temporary, "release.tar.gz");
    writeFileSync(
      file,
      await download(
        new URL(manifest.artifact.name, url),
        manifest.artifact.bytes,
      ),
      { mode: 0o600 },
    );
    return await store.apply(signed, file, health);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

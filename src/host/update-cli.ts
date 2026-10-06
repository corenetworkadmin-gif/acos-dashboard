import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { UpdateStore } from "./update-store.ts";
import { verifyRelease } from "./releases.ts";

export async function checkRelease(directory: string) {
  const temporary = mkdtempSync(path.join(tmpdir(), "acos-update-health-"));
  const port = await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        resolve(typeof address === "object" && address ? address.port : 0),
      );
    });
  });
  const child = spawn(process.execPath, [path.join(directory, "server.mjs")], {
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      ACOS_DATA_DIR: temporary,
      ACOS_PORT: String(port),
      ACOS_WEB_ROOT: path.join(directory, "web"),
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let error = "",
    failed = false;
  child.stderr.on("data", (chunk) => {
    error = (error + chunk).slice(-2000);
  });
  child.on("error", (e) => {
    error = e.message;
    failed = true;
  });
  const closed = new Promise<void>((resolve) =>
    child.on("close", () => {
      failed = true;
      resolve();
    }),
  );
  try {
    for (let n = 0; n < 100; n++) {
      if (failed) throw new Error(`Release health check exited: ${error}`);
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
          signal: AbortSignal.timeout(200),
        });
        const page = await fetch(`http://127.0.0.1:${port}/`, {
          signal: AbortSignal.timeout(200),
        });
        if (
          response.ok &&
          ((await response.json()) as { service: string }).service ===
            "acos-host" &&
          page.ok &&
          (await page.text()).includes("ACOS") &&
          !failed
        )
          return;
      } catch {
        /* Wait for the staged process to listen. */
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("Release failed its host/UI health check.");
  } finally {
    child.kill("SIGTERM");
    const force = setTimeout(() => child.kill("SIGKILL"), 2000);
    await closed;
    clearTimeout(force);
    rmSync(temporary, { recursive: true, force: true });
  }
}
async function download(url: URL, max: number) {
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
async function main() {
  const key = process.env.ACOS_RELEASE_PUBLIC_KEY_FILE;
  if (!key)
    throw new Error(
      "Pin ACOS_RELEASE_PUBLIC_KEY_FILE before using release updates.",
    );
  const store = new UpdateStore(
    process.env.ACOS_UPDATE_ROOT ??
      path.join(homedir(), ".local/share/acos-updates"),
    readFileSync(key, "utf8"),
  );
  const [mode, input, artifact] = process.argv.slice(2);
  if (mode === "apply" && input && artifact) {
    console.log(
      await store.apply(
        JSON.parse(readFileSync(input, "utf8")),
        artifact,
        checkRelease,
      ),
    );
  } else if (mode === "update" && input) {
    const url = new URL(input);
    const signed = JSON.parse((await download(url, 32_000)).toString());
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
      console.log(await store.apply(signed, file, checkRelease));
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  } else if (mode === "rollback") {
    await store.rollback(checkRelease);
    console.log(
      "Previous application release restored; companion data and current policy preserved.",
    );
  } else if (mode === "launch") {
    const state = store.state();
    if (!state.current) throw new Error("No accepted release installed.");
    const directory = store.release(state.current);
    const child = spawn(
      process.execPath,
      [path.join(directory, "server.mjs")],
      {
        env: {
          ...process.env,
          ACOS_WEB_ROOT: path.join(directory, "web"),
          ACOS_PORT: process.env.ACOS_DASHBOARD_PORT ?? "8080",
        },
        stdio: "inherit",
      },
    );
    process.on("SIGTERM", () => child.kill("SIGTERM"));
    process.on("SIGINT", () => child.kill("SIGINT"));
    child.on("error", (error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
    child.on("close", (code) => {
      process.exitCode = code ?? 1;
    });
  } else
    throw new Error(
      "Usage: update-cli.ts apply SIGNED_MANIFEST ARTIFACT | update HTTPS_MANIFEST_URL | rollback | launch",
    );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });

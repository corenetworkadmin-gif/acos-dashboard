import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const children: ChildProcess[] = [];
let stopping = false;
let forcedExit: ReturnType<typeof setTimeout> | undefined;

function stop(code: number) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children)
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGTERM");
  forcedExit = setTimeout(() => {
    for (const child of children)
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
  }, 5000);
  forcedExit.unref();
}
function child(args: string[]) {
  const processHandle = spawn(process.execPath, args, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  children.push(processHandle);
  processHandle.on("error", (error) => {
    console.error(error.message);
    stop(1);
  });
  processHandle.on("exit", (code, signal) => {
    if (!stopping) {
      console.error(
        `An ACOS service exited (${signal ?? code}); stopping the workspace.`,
      );
      stop(1);
    }
    if (
      children.every(
        (item) => item.exitCode !== null || item.signalCode !== null,
      ) &&
      forcedExit
    )
      clearTimeout(forcedExit);
  });
}
function portValue(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1024 || value > 65535)
    throw new Error(`${name} must be a port from 1024 to 65535.`);
  return value;
}
async function freePort(port: number) {
  await new Promise<void>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", () =>
      reject(
        new Error(
          `Port ${port} is in use. Stop the existing service before starting ACOS.`,
        ),
      ),
    );
    probe.listen(port, "127.0.0.1", () =>
      probe.close((error) => (error ? reject(error) : resolve())),
    );
  });
}
async function ready(url: string, isHost: boolean) {
  const deadline = Date.now() + 20000;
  while (!stopping && Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (
        response.ok &&
        (isHost
          ? ((await response.json()) as { service?: string }).service ===
            "acos-host"
          : (await response.text()).includes("ACOS"))
      )
        return;
    } catch {
      /* Retry while our services start. */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("ACOS did not become ready. Check the service error above.");
}
async function main() {
  if (
    process.platform !== "linux" ||
    Number(process.versions.node.split(".")[0]) < 24
  )
    throw new Error(
      "Run in Linux/WSL2 with Node 24+. Windows setup: docs/windows.md.",
    );
  if (process.getuid?.() === 0) throw new Error("Do not run ACOS as root.");
  if (!existsSync(path.join(root, "dist/index.html")))
    throw new Error("Dashboard build missing. Run pnpm build first.");
  const hostPort = portValue("ACOS_PORT", 4317),
    dashboardPort = portValue("ACOS_DASHBOARD_PORT", 8080);
  if (hostPort === dashboardPort)
    throw new Error("Host and dashboard ports must differ.");
  process.env.ACOS_PORT = String(hostPort);
  await freePort(hostPort);
  await freePort(dashboardPort);
  if (stopping) return;
  child(["--experimental-strip-types", "src/host/server.ts"]);
  await ready(`http://127.0.0.1:${hostPort}/api/health`, true);
  if (stopping) return;
  child([
    "node_modules/vite/bin/vite.js",
    "preview",
    "--host",
    "127.0.0.1",
    "--port",
    String(dashboardPort),
    "--strictPort",
  ]);
  await ready(`http://127.0.0.1:${dashboardPort}/`, false);
  if (!stopping) {
    console.log(
      `\nACOS is ready: http://localhost:${dashboardPort}\nKeep this terminal open. Press Ctrl-C to stop both services.`,
    );
    console.log(
      "Unlock with the admin.key file in your ACOS data directory. The key is never printed by this launcher.",
    );
  }
}
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
main().catch((error) => {
  if (!stopping) {
    console.error(error instanceof Error ? error.message : error);
    stop(1);
  }
});

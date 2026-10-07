// A real RemoteTransport for the governed remote.execute provider, built on
// the OpenSSH client. The host does not open remote sessions any other way:
// transport executes exactly one command against exactly the attached
// endpoint, with no shell on either side of the argument boundary, a bounded
// timeout, bounded output, and abort support so the operation pipeline can
// cancel it.
//
// The transport is *shipped*, not defaulted: the host only constructs it when
// the administrator opts in (ACOS_REMOTE_TRANSPORT=ssh), so a fresh install
// keeps remote.execute unavailable, exactly as before.
import { spawn, spawnSync } from "node:child_process";
import type { ProviderProbe, RemoteTransport } from "../providers.ts";

export interface SshRemoteTransportOptions {
  // OpenSSH client binary. Default "ssh" ("ssh.exe" on Windows) via PATH.
  sshPath?: string;
  // Host-key policy for targets not yet in known_hosts. "accept-new" (default)
  // trusts the first sighting like OpenSSH does interactively; "yes" refuses
  // any unknown host and requires the endpoint to be pre-provisioned.
  strictHostKeyChecking?: "accept-new" | "yes";
  // Output cap in bytes. Default 64 KiB.
  maxBytes?: number;
  // Injectables for tests.
  probeFn?: (sshPath: string) => boolean;
  spawnFn?: typeof spawn;
}

const DEFAULT_MAX_BYTES = 64 * 1024;
const MAX_STDERR_BYTES = 8 * 1024;
const MAX_COMMAND_LENGTH = 8192;

// Endpoint format: "host" or "user@host" (letters, digits, dot, underscore,
// hyphen, tilde, at). Anything else — option-like prefixes, spaces, quotes,
// shell metacharacters — is refused before an argument is ever formed, so a
// target can never become an ssh option or a second command.
export function isValidSshTarget(target: string): boolean {
  const parts = target.split("@");
  if (parts.length > 2) return false;
  // Both the optional user and the host must be plain, non-empty, and cannot
  // begin or end in a way that would alter option parsing.
  return parts.every((part) =>
    /^[A-Za-z0-9][A-Za-z0-9._~-]{0,252}$/.test(part),
  );
}

function defaultProbe(sshPath: string): boolean {
  try {
    const result = spawnSync(sshPath, ["-V"], {
      timeout: 5_000,
      windowsHide: true,
    });
    // OpenSSH prints its version banner on stderr but always exits 0.
    return result.status === 0;
  } catch {
    return false;
  }
}

export class SshRemoteTransport implements RemoteTransport {
  private readonly sshPath: string;
  private readonly strictHostKeyChecking: "accept-new" | "yes";
  private readonly maxBytes: number;
  private readonly probeFn: (sshPath: string) => boolean;
  private readonly spawnFn: typeof spawn;

  constructor(options: SshRemoteTransportOptions = {}) {
    this.sshPath =
      options.sshPath ?? (process.platform === "win32" ? "ssh.exe" : "ssh");
    this.strictHostKeyChecking = options.strictHostKeyChecking ?? "accept-new";
    this.maxBytes = Math.max(
      1024,
      Math.min(options.maxBytes ?? DEFAULT_MAX_BYTES, 8 * 1024 * 1024),
    );
    this.probeFn = options.probeFn ?? defaultProbe;
    this.spawnFn = options.spawnFn ?? spawn;
  }

  probe(): ProviderProbe {
    if (!this.probeFn(this.sshPath))
      return {
        available: false,
        reason: `OpenSSH client "${this.sshPath}" is not available on this host.`,
      };
    return { available: true, reason: null };
  }

  async execute(context: {
    target: string;
    command: string;
    timeoutMs: number;
    signal: AbortSignal;
  }): Promise<{ output: string; exitCode: number }> {
    if (!this.probe().available)
      throw new Error(this.probe().reason ?? "Remote transport is unavailable.");
    if (!isValidSshTarget(context.target))
      throw new Error(
        "Remote target must be a plain host or user@host; refused before execution.",
      );
    const command = context.command.trim();
    if (!command)
      throw new Error("Remote command is empty; nothing was executed.");
    if (command.length > MAX_COMMAND_LENGTH)
      throw new Error(
        `Remote command exceeds the ${MAX_COMMAND_LENGTH}-character bound.`,
      );

    const args = [
      "-o",
      "BatchMode=yes",
      "-o",
      `ConnectTimeout=${Math.max(1, Math.ceil(context.timeoutMs / 1000))}`,
      "-o",
      `StrictHostKeyChecking=${this.strictHostKeyChecking}`,
      "-o",
      "LogLevel=ERROR",
      // The validated endpoint and the single command argument follow the
      // options; there is no shell interpretation on either side.
      context.target,
      command,
    ];

    return new Promise((resolve, reject) => {
      const child = this.spawnFn(this.sshPath, args, {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = Buffer.alloc(0);
      let stderr = "";
      let truncated = false;
      let timedOut = false;
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        context.signal.removeEventListener("abort", onAbort);
        fn();
      };
      const kill = () => {
        child.kill();
      };
      const onAbort = () => kill();
      const timer = setTimeout(() => {
        timedOut = true;
        kill();
      }, context.timeoutMs);
      context.signal.addEventListener("abort", onAbort, { once: true });
      child.stdout?.on("data", (chunk: Buffer) => {
        if (truncated) return;
        const remaining = this.maxBytes - stdout.length;
        if (chunk.length >= remaining) {
          stdout = Buffer.concat([stdout, chunk.subarray(0, remaining)]);
          truncated = true;
          kill();
        } else {
          stdout = Buffer.concat([stdout, chunk]);
        }
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        if (stderr.length < MAX_STDERR_BYTES) stderr += chunk.toString("utf8");
      });
      child.on("error", (error) => finish(() => reject(error)));
      child.on("close", (code) =>
        finish(() => {
          if (timedOut)
            reject(
              new Error(`Remote command exceeded its ${context.timeoutMs} ms budget.`),
            );
          else if (context.signal.aborted)
            reject(new Error("Remote command was cancelled."));
          else {
            let output = stdout.toString("utf8");
            if (truncated) output += "\n[output truncated]";
            if (code !== 0 && stderr.trim() && !output)
              output = stderr.trim().slice(0, MAX_STDERR_BYTES);
            resolve({ output, exitCode: code ?? -1 });
          }
        }),
      );
    });
  }
}

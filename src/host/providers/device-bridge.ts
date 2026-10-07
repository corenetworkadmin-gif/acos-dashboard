// A real DeviceBridge for the governed device providers. The host never
// captures audio or video itself; this component shells out to an explicitly
// configured capture tool (ffmpeg) with a bounded, abortable execution, and
// returns a bounded, secret-free summary suitable for the audit journal.
//
// The bridge is *shipped*, not defaulted: the host only constructs it when the
// administrator opts in (ACOS_DEVICE_BRIDGE=ffmpeg), so a fresh install keeps
// device.microphone / device.camera unavailable, exactly as before.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DeviceBridge, ProviderProbe } from "../providers.ts";

export type CaptureDevice = "microphone" | "camera";

export interface RunResult {
  code: number | null;
  stderr: string;
}

export interface CommandDeviceBridgeOptions {
  // Capture tool binary. Default "ffmpeg" resolved through PATH.
  tool?: string;
  platform?: NodeJS.Platform;
  // Explicit capture device names. Required on Windows (dshow has no default)
  // and macOS (avfoundation); Linux defaults to pulse "default" / v4l2
  // /dev/video0.
  microphone?: string;
  camera?: string;
  // Audio capture length in seconds (clamped to the operation timeout).
  durationSeconds?: number;
  // Injectables for tests.
  probeFn?: (tool: string) => boolean;
  runFn?: (
    tool: string,
    args: string[],
    options: { timeoutMs: number; signal: AbortSignal },
  ) => Promise<RunResult>;
}

const DEFAULT_DURATION_SECONDS = 2;
const MAX_STDERR_BYTES = 8 * 1024;

function defaultProbe(tool: string): boolean {
  try {
    const result = spawnSync(tool, ["-version"], {
      timeout: 5_000,
      windowsHide: true,
      stdio: "ignore",
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

function defaultRun(
  tool: string,
  args: string[],
  options: { timeoutMs: number; signal: AbortSignal },
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(tool, args, {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    let settled = false;
    let killed = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal.removeEventListener("abort", onAbort);
      fn();
    };
    const onAbort = () => {
      killed = true;
      child.kill();
    };
    const timer = setTimeout(() => {
      killed = true;
      child.kill();
    }, options.timeoutMs);
    options.signal.addEventListener("abort", onAbort, { once: true });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_STDERR_BYTES) stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => finish(() => reject(error)));
    child.on("close", (code) =>
      finish(() => {
        if (killed)
          reject(new Error("Capture exceeded its time budget and was terminated."));
        else resolve({ code, stderr });
      }),
    );
  });
}

export class CommandDeviceBridge implements DeviceBridge {
  private readonly tool: string;
  private readonly platform: NodeJS.Platform;
  private readonly microphone: string | undefined;
  private readonly camera: string | undefined;
  private readonly durationSeconds: number;
  private readonly probeFn: (tool: string) => boolean;
  private readonly runFn: CommandDeviceBridgeOptions["runFn"];

  constructor(options: CommandDeviceBridgeOptions = {}) {
    this.tool = options.tool ?? "ffmpeg";
    this.platform = options.platform ?? process.platform;
    this.microphone = options.microphone;
    this.camera = options.camera;
    this.durationSeconds = Math.max(
      1,
      Math.min(options.durationSeconds ?? DEFAULT_DURATION_SECONDS, 10),
    );
    this.probeFn = options.probeFn ?? defaultProbe;
    this.runFn = options.runFn;
  }

  // The capture device name for a capability, or null when none can be
  // resolved. Windows and macOS require an explicit name because their capture
  // frameworks have no reliable "default device" selector for ffmpeg.
  private inputFor(device: CaptureDevice): string | null {
    const configured = device === "microphone" ? this.microphone : this.camera;
    if (configured) return configured;
    if (this.platform === "linux")
      return device === "microphone" ? "default" : "/dev/video0";
    return null;
  }

  probe(device: CaptureDevice): ProviderProbe {
    if (!this.probeFn(this.tool))
      return {
        available: false,
        reason: `Capture tool "${this.tool}" is not available on this host.`,
      };
    if (!this.inputFor(device))
      return {
        available: false,
        reason: `No ${device} capture device is configured on this host (set ACOS_DEVICE_${device === "microphone" ? "MIC" : "CAM"}).`,
      };
    return { available: true, reason: null };
  }

  private formatArgs(device: CaptureDevice, input: string): string[] {
    if (this.platform === "win32")
      return [
        "-f",
        "dshow",
        "-i",
        `${device === "microphone" ? "audio" : "video"}=${input}`,
      ];
    if (this.platform === "darwin") return ["-f", "avfoundation", "-i", input];
    return ["-f", device === "microphone" ? "pulse" : "v4l2", "-i", input];
  }

  async capture(context: {
    device: CaptureDevice;
    timeoutMs: number;
    signal: AbortSignal;
  }): Promise<{ summary: string; detail?: Record<string, unknown> }> {
    const probe = this.probe(context.device);
    if (!probe.available)
      throw new Error(probe.reason ?? "Device bridge unavailable.");
    const input = this.inputFor(context.device);
    if (!input)
      throw new Error(`No capture device configured for ${context.device}.`);

    const directory = mkdtempSync(path.join(tmpdir(), "acos-capture-"));
    try {
      const output = path.join(
        directory,
        context.device === "microphone" ? "capture.wav" : "capture.jpg",
      );
      // The capture length must fit inside the operation's time budget.
      const seconds = Math.max(
        1,
        Math.min(this.durationSeconds, Math.floor((context.timeoutMs - 1000) / 1000)),
      );
      const args = [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        ...this.formatArgs(context.device, input),
        ...(context.device === "microphone"
          ? ["-t", String(seconds), "-ac", "1", "-ar", "16000"]
          : ["-frames:v", "1"]),
        output,
      ];
      const run = this.runFn ?? ((tool, argv, options) => defaultRun(tool, argv, options));
      const result = await run(this.tool, args, {
        timeoutMs: context.timeoutMs,
        signal: context.signal,
      });
      let bytes = 0;
      try {
        bytes = statSync(output).size;
      } catch {
        bytes = 0;
      }
      if (result.code !== 0 || bytes <= 0) {
        const detail = result.stderr
          .trim()
          .split("\n")
          .slice(-3)
          .join("; ")
          .slice(0, 500);
        throw new Error(
          `Capture failed (exit ${result.code ?? "unknown"})${detail ? `: ${detail}` : "."}`,
        );
      }
      const summary =
        context.device === "microphone"
          ? `Captured ${seconds}s of audio (${bytes} bytes).`
          : `Captured 1 frame (${bytes} bytes).`;
      return {
        summary,
        detail: {
          device: context.device,
          tool: this.tool,
          bytes,
          seconds: context.device === "microphone" ? seconds : 0,
        },
      };
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
}

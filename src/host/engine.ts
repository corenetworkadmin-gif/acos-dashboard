import { discoverHardware } from "./hardware.ts";
import { cpuProvider, planCompute } from "./resources.ts";
import type { HardwareReport, ComputePlan } from "../runtime/hardware.ts";
import { sandboxArgs } from "./sandbox.ts";
export { sandboxArgs } from "./sandbox.ts";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";

export interface EngineConfig {
  binary: string;
  model: string;
  sha256: string;
  context: number;
  maxTokens: number;
  memoryBytes: number;
  timeoutMs: number;
  maxThreads?: number;
  backend?: string;
}
export function engineConfig(): EngineConfig | null {
  const {
    ACOS_ENGINE_BINARY: binary,
    ACOS_MODEL_PATH: model,
    ACOS_MODEL_SHA256: sha256,
  } = process.env;
  if (!binary || !model || !sha256) return null;
  if (!/^[a-f0-9]{64}$/i.test(sha256))
    throw new Error("ACOS_MODEL_SHA256 must be a SHA-256 digest.");
  return {
    binary,
    model,
    sha256: sha256.toLowerCase(),
    context: 4096,
    maxTokens: 256,
    // This budget belongs to the pinned model/adapter, never to the developer's host.
    // Other models must provide their own measured budget before admission.
    memoryBytes: process.env.ACOS_MODEL_MEMORY_MB
      ? Number(process.env.ACOS_MODEL_MEMORY_MB) * 1024 ** 2
      : sha256.toLowerCase() ===
          "74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db"
        ? 2 * 1024 ** 3
        : 0,
    maxThreads: process.env.ACOS_MAX_CPU_THREADS
      ? Number(process.env.ACOS_MAX_CPU_THREADS)
      : undefined,
    backend: process.env.ACOS_COMPUTE_BACKEND ?? "auto",
    timeoutMs: 120_000,
  };
}
export class LocalEngine {
  config: EngineConfig | null;
  verified = false;
  hardware: HardwareReport | null = null;
  reservation: ComputePlan | null = null;
  lastPlan: ComputePlan | null = null;
  dataDirectory = process.cwd();
  privateDirectory: string | null = null;
  discover(probeIsolation = true) {
    const previousIsolation = this.hardware?.isolation;
    this.hardware = discoverHardware(
      this.dataDirectory,
      undefined,
      probeIsolation,
    );
    if (!probeIsolation && previousIsolation)
      this.hardware.isolation = previousIsolation;
    return this.hardware;
  }
  private allocate() {
    const config = this.config!;
    const hardware = this.discover(false);
    const plan = planCompute(
      hardware,
      [cpuProvider],
      {
        memoryBytes: config.memoryBytes,
        acceleratorMemoryBytes: 0,
        maxThreads:
          config.maxThreads ??
          Math.max(1, Math.min(32, hardware.cpu.usableThreads - 1)),
      },
      {
        backend: config.backend ?? "auto",
        allowCpu: true,
        memoryFraction: 0.75,
      },
    );
    this.lastPlan = plan;
    return plan;
  }
  private epoch = 0;
  private modelStamp = "";
  private async stamp() {
    const info = await stat(this.config!.model);
    return `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
  }
  active: ChildProcess | null = null;
  constructor(config: EngineConfig | null) {
    this.config = config;
  }
  async verify() {
    if (!this.config)
      throw new Error(
        "No local model configured. Set ACOS_ENGINE_BINARY, ACOS_MODEL_PATH, and ACOS_MODEL_SHA256 on the host.",
      );
    this.verified = false;
    const epoch = this.epoch;
    const config = this.config;
    this.discover();
    this.allocate();
    config.binary = await realpath(config.binary);
    config.model = await realpath(config.model);
    if (this.privateDirectory) {
      const privateDir = await realpath(this.privateDirectory);
      const engineDir = path.dirname(config.binary);
      if (
        privateDir === engineDir ||
        privateDir.startsWith(engineDir + path.sep) ||
        engineDir.startsWith(privateDir + path.sep)
      )
        throw new Error("Engine directory must not overlap private ACOS data.");
    }
    if (
      !(await stat(config.binary)).isFile() ||
      !(await stat(config.model)).isFile()
    )
      throw new Error("Engine and model must be regular files.");
    const stamp = await this.stamp();
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(config.model))
      hash.update(chunk);
    if (hash.digest("hex") !== config.sha256)
      throw new Error("Model integrity verification failed.");
    if (stamp !== (await this.stamp()))
      throw new Error("Model changed during integrity verification.");
    if (epoch !== this.epoch) throw new Error("Engine verification cancelled.");
    this.modelStamp = stamp;
    await this.execute("/bin/true", [], false);
    this.verified = true;
  }
  async infer(prompt: string, maxTokens?: number) {
    if (!this.verified || !this.config)
      throw new Error("Local engine is not verified.");
    const epoch = this.epoch;
    if (this.modelStamp !== (await this.stamp())) {
      this.verified = false;
      throw new Error(
        "Model changed since verification. Load and verify it again.",
      );
    }
    if (epoch !== this.epoch) throw new Error("Inference cancelled.");
    // Conservative UTF-8 bound: each byte can occupy a token. No truncation of durable Home.
    if (
      Buffer.byteLength(prompt, "utf8") + this.config.maxTokens + 128 >
      this.config.context
    )
      throw new Error(
        "Context budget exceeded. Start a new conversation or shorten the request. Durable memories are preserved.",
      );
    this.allocate();
    const args = [
      "-m",
      "/model.gguf",
      "-c",
      String(this.config.context),
      "-n",
      String(maxTokens ?? this.config.maxTokens),
      "-t",
      String(this.lastPlan?.threads ?? 1),
      "-ngl",
      "0",
      "--no-warmup",
      "--no-display-prompt",
      "--simple-io",
      "--no-conversation",
      "-p",
      prompt,
    ];
    const output = await this.execute(
      "/engine/" + path.basename(this.config.binary),
      args,
      true,
    );
    const result = output.replace(/\[end of text\]/g, "").trim();
    if (!result) throw new Error("Local model returned no output.");
    return result;
  }
  cancel() {
    this.epoch++;
    if (this.active?.pid) {
      try {
        process.kill(-this.active.pid, "SIGKILL");
      } catch {
        this.active.kill("SIGKILL");
      }
    }
  }
  private execute(
    command: string,
    args: string[],
    model: boolean,
  ): Promise<string> {
    if (this.active) throw new Error("Engine already has an active operation.");
    const config = this.config;
    const mounts =
      model && config
        ? [
            "--ro-bind",
            path.dirname(config.binary),
            "/engine",
            "--ro-bind",
            config.model,
            "/model.gguf",
            "--setenv",
            "LD_LIBRARY_PATH",
            "/engine",
            "--chdir",
            "/engine",
          ]
        : [];
    this.reservation = this.lastPlan;
    return new Promise((resolve, reject) => {
      const child = spawn(
        "/usr/bin/prlimit",
        [
          "--as=" + (this.reservation?.memoryBytes ?? config?.memoryBytes ?? 0),
          "--cpu=120",
          "--core=0",
          "--nofile=128",
          "--fsize=1048576",
          "--",
          "/usr/bin/bwrap",
          ...sandboxArgs(),
          ...mounts,
          "/usr/bin/prlimit",
          "--nproc=64",
          "--",
          command,
          ...args,
        ],
        {
          detached: true,
          env: { PATH: "/usr/bin:/bin" },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      this.active = child;
      let out = "",
        err = "",
        timedOut = false,
        overflow = false;
      const timer = setTimeout(() => {
        timedOut = true;
        this.cancel();
      }, config?.timeoutMs ?? 120_000);
      child.stdout?.on("data", (data) => {
        out += data.toString();
        if (out.length > 65536) {
          overflow = true;
          this.cancel();
        }
      });
      child.stderr?.on("data", (data) => {
        err = (err + data.toString()).slice(-4000);
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        this.active = null;
        this.reservation = null;
        reject(error);
      });
      child.on("close", (code, signal) => {
        clearTimeout(timer);
        this.active = null;
        this.reservation = null;
        if (timedOut)
          reject(
            new Error(
              "Inference timed out; process terminated and resources released.",
            ),
          );
        else if (overflow) reject(new Error("Engine output limit exceeded."));
        else if (signal) reject(new Error("Inference cancelled."));
        else if (code !== 0)
          reject(
            new Error(`Isolated engine failed (${code}): ${err.slice(-800)}`),
          );
        else resolve(out);
      });
    });
  }
}

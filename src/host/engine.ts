import {
  backendDescriptor,
  deriveProviders,
  probeBackend,
  validateBinding,
  type BackendBinding,
  type BackendId,
} from "./backends.ts";
import { renderDevice } from "./accelerator.ts";
import {
  JobContainment,
  planContainment,
  type ContainmentPlan,
} from "./containment.ts";
import { modelAdapter, resolveModel } from "./models.ts";
import { executionLimits } from "./limits.ts";
import { discoverHardware } from "./hardware.ts";
import { planCompute } from "./resources.ts";
import type { HardwareReport, ComputePlan } from "../runtime/hardware.ts";
import { sandboxArgs } from "./sandbox.ts";
export { sandboxArgs } from "./sandbox.ts";
import {
  selectIsolationAdapter,
  type IsolationAdapter,
  type IsolationHandle,
} from "./isolation.ts";
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
  addressSpaceBytes?: number;
  timeoutMs: number;
  maxThreads?: number;
  backend?: string;
  adapter?: string;
  vulkanRenderNode?: string;
  acceleratorBackend?: BackendId;
  devicePaths?: string[];
  deviceId?: string;
  engineDevice?: string;
  acceleratorMemoryBytes?: number;
}
// Length of the prefix of `text` that is safe to emit without risking a partial
// trailing occurrence of `marker` (llama.cpp appends "[end of text]").
export function markerSafeLength(
  text: string,
  marker = "[end of text]",
): number {
  let hold = Math.min(marker.length - 1, text.length);
  while (hold > 0 && !marker.startsWith(text.slice(text.length - hold))) hold--;
  return text.length - hold;
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
  if (
    process.env.ACOS_MODEL_FAMILY &&
    process.env.ACOS_MODEL_ADAPTER &&
    modelAdapter(process.env.ACOS_MODEL_FAMILY).id !==
      modelAdapter(process.env.ACOS_MODEL_ADAPTER).id
  )
    throw new Error("ACOS_MODEL_FAMILY and ACOS_MODEL_ADAPTER disagree.");
  const compatibility = resolveModel({
    id: process.env.ACOS_MODEL_FAMILY ?? process.env.ACOS_MODEL_ADAPTER,
    filename: model,
    sha256,
  });
  if (!compatibility.adapter) throw new Error(compatibility.reason);
  const adapter = modelAdapter(compatibility.adapter);
  return {
    adapter: adapter.id,
    vulkanRenderNode: process.env.ACOS_VULKAN_RENDER_NODE,
    acceleratorBackend: process.env.ACOS_ACCELERATOR_BACKEND
      ? backendDescriptor(process.env.ACOS_ACCELERATOR_BACKEND).id
      : undefined,
    devicePaths:
      process.env.ACOS_ACCELERATOR_DEVICE_PATHS?.split(",").filter(Boolean),
    deviceId: process.env.ACOS_ACCELERATOR_DEVICE_ID,
    engineDevice: process.env.ACOS_ENGINE_DEVICE,
    acceleratorMemoryBytes:
      Number(process.env.ACOS_MODEL_VRAM_MB ?? 0) * 1024 ** 2,
    binary,
    model,
    sha256: sha256.toLowerCase(),
    context: 4096,
    maxTokens: 256,
    // This budget belongs to the pinned model/adapter, never to the developer's host.
    // Other models must provide their own measured working-RAM budget before admission.
    memoryBytes:
      (process.env.ACOS_MODEL_RAM_MB ?? process.env.ACOS_MODEL_MEMORY_MB)
        ? Number(
            process.env.ACOS_MODEL_RAM_MB ?? process.env.ACOS_MODEL_MEMORY_MB,
          ) *
          1024 ** 2
        : sha256.toLowerCase() ===
            "74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db"
          ? 2 * 1024 ** 3
          : 0,
    addressSpaceBytes: process.env.ACOS_ADDRESS_SPACE_MB
      ? Number(process.env.ACOS_ADDRESS_SPACE_MB) * 1024 ** 2
      : undefined,
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
  private accelerator: BackendBinding | null = null;
  private probing: BackendBinding | null = null;
  private initialAdmission = false;
  backendReason: string | null = null;
  containmentPlan: ContainmentPlan | null = null;
  private allocate(): ComputePlan {
    const config = this.config!;
    const hardware = this.discover(false);
    const plan = planCompute(
      hardware,
      deriveProviders(
        hardware,
        !this.initialAdmission && this.accelerator ? [this.accelerator] : [],
      ),
      {
        memoryBytes: config.memoryBytes,
        acceleratorMemoryBytes: config.acceleratorMemoryBytes ?? 0,
        maxThreads:
          config.maxThreads ??
          Math.max(1, Math.min(32, hardware.cpu.usableThreads - 1)),
      },
      {
        backend: this.initialAdmission ? "cpu" : (config.backend ?? "auto"),
        allowCpu: true,
        memoryFraction: 0.75,
      },
    );
    if (plan.fallback && this.backendReason)
      plan.reason = this.backendReason + " CPU fallback selected.";
    executionLimits(config, plan.threads);
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
  // The confinement primitive. Selected once from the host platform; the engine
  // never hard-codes bwrap/prlimit or Windows specifics.
  readonly isolation: IsolationAdapter = selectIsolationAdapter();
  private containment: JobContainment | null = null;
  private containmentFailure: Error | null = null;
  private activeHandle: IsolationHandle | null = null;
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
    modelAdapter(config.adapter);
    this.discover();
    this.accelerator = null;
    this.backendReason = null;
    this.initialAdmission = true;
    try {
      this.allocate();
    } finally {
      this.initialAdmission = false;
    }
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
    const requested =
      config.acceleratorBackend ??
      (config.backend && config.backend !== "auto" && config.backend !== "cpu"
        ? backendDescriptor(config.backend).id
        : config.vulkanRenderNode
          ? "vulkan"
          : null);
    if (requested && config.backend !== "cpu") {
      try {
        const devicePaths =
          config.devicePaths ??
          (config.vulkanRenderNode ? [config.vulkanRenderNode] : []);
        const renderNode = devicePaths.find((node) =>
          /^\/dev\/dri\/renderD\d+$/.test(node),
        );
        const deviceId =
          config.deviceId ?? (renderNode ? renderDevice(renderNode) : "");
        const binding: BackendBinding = {
          backend: requested,
          deviceId,
          devicePaths,
          engineDevice: config.engineDevice,
        };
        validateBinding(binding);
        this.probing = binding;
        const listing = await this.execute(
          "/engine/" + path.basename(config.binary),
          ["--list-devices"],
          true,
        );
        if (epoch !== this.epoch)
          throw new Error("Engine verification cancelled.");
        this.accelerator = probeBackend(
          this.hardware!,
          binding,
          listing,
          config.acceleratorMemoryBytes ?? 0,
        );
      } catch (error) {
        if (epoch !== this.epoch || this.containmentFailure) throw error;
        this.backendReason =
          error instanceof Error ? error.message : "Accelerator probe failed.";
        this.accelerator = null;
      } finally {
        this.probing = null;
      }
    }
    this.allocate();
    await this.execute("/bin/true", [], false);
    this.verified = true;
  }
  // Shared admission + validation for buffered and streaming inference. The stream
  // callback, when present, receives raw stdout chunks as the model emits them; the
  // same process limits, cancellation epoch and output cap apply to both paths.
  private async runInference(
    prompt: string,
    maxTokens: number | undefined,
    onChunk?: (text: string) => void,
  ) {
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
      "-tb",
      String(this.lastPlan?.threads ?? 1),
      ...backendDescriptor(this.lastPlan?.backend ?? "cpu").offloadArgs(
        this.lastPlan?.backend === "cpu"
          ? undefined
          : this.accelerator?.engineDevice,
      ),
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
      onChunk,
    );
    return output.replace(/\[end of text\]/g, "").trim();
  }
  async infer(prompt: string, maxTokens?: number) {
    const result = await this.runInference(prompt, maxTokens);
    if (!result) throw new Error("Local model returned no output.");
    return result;
  }
  // Streaming inference: yields sanitized text deltas as the isolated process emits
  // them. Cancellation, timeout and output caps are identical to buffered inference.
  async *inferStream(
    prompt: string,
    maxTokens?: number,
  ): AsyncGenerator<string, string, void> {
    const MARKER = "[end of text]";
    const queue: string[] = [];
    let notify: (() => void) | null = null;
    let finished = false;
    let failure: Error | null = null;
    let emitted = 0;
    let buffered = "";
    const wake = () => {
      const fn = notify;
      notify = null;
      fn?.();
    };
    const push = (text: string) => {
      if (text.length > emitted) {
        queue.push(text);
        wake();
      }
    };
    const pending = this.runInference(prompt, maxTokens, (chunk) => {
      buffered += chunk;
      const cleaned = buffered.replace(/\[end of text\]/g, "");
      // Hold back a possible partial trailing marker so a split "[end of text]"
      // is never emitted to the client.
      push(cleaned.slice(0, markerSafeLength(cleaned, MARKER)));
    })
      .then((value) => {
        buffered = value;
      })
      .catch((error: unknown) => {
        failure =
          error instanceof Error ? error : new Error("Inference failed");
      })
      .finally(() => {
        finished = true;
        wake();
      });
    while (true) {
      if (queue.length) {
        const snapshot = queue.shift()!;
        if (snapshot.length > emitted) {
          const delta = snapshot.slice(emitted);
          emitted = snapshot.length;
          yield delta;
        }
        continue;
      }
      if (finished) break;
      await new Promise<void>((resolve) => {
        notify = resolve;
      });
    }
    await pending;
    if (failure) throw failure;
    const finalText = buffered.replace(/\[end of text\]/g, "");
    if (finalText.length > emitted) {
      const delta = finalText.slice(emitted);
      emitted = finalText.length;
      yield delta;
    }
    if (!finalText) throw new Error("Local model returned no output.");
    return finalText;
  }
  cancel() {
    this.epoch++;
    try {
      this.containment?.kill();
    } catch (error) {
      this.containmentFailure = error as Error;
      this.verified = false;
    }
    if (this.active?.pid) {
      // The adapter owns the confinement primitive and knows how to reap it:
      // process-group kill on Linux, Job Object teardown on Windows.
      this.isolation.terminate(
        this.activeHandle ?? {
          platform: this.isolation.platform,
          mechanism: this.isolation.mechanism,
        },
        this.active.pid,
      );
    }
  }
  private execute(
    command: string,
    args: string[],
    model: boolean,
    onChunk?: (text: string) => void,
  ): Promise<string> {
    if (this.containmentFailure) throw this.containmentFailure;
    if (this.active) throw new Error("Engine already has an active operation.");
    const config = this.config;
    if (!config || !this.lastPlan)
      throw new Error("Resources have not been admitted.");
    // The confinement primitive is chosen by the adapter, not here. On Linux this
    // is prlimit + bwrap; on Windows it is the AppContainer/Job Object helper.
    const binding = model
      ? (this.probing ??
        (this.lastPlan.backend === "cpu" ? null : this.accelerator))
      : null;
    if (binding) validateBinding(binding);
    const renderNode = binding?.devicePaths.find((node) =>
      /^\/dev\/dri\/renderD\d+$/.test(node),
    );
    if (binding && renderNode && renderDevice(renderNode) !== binding.deviceId)
      throw new Error("Accelerator device changed after verification.");
    const wrapped = this.isolation.wrap({
      command: [command, ...args],
      readOnlyPaths:
        model && config
          ? [
              { source: path.dirname(config.binary), target: "/engine" },
              { source: config.model, target: "/model.gguf" },
            ]
          : [],
      writablePaths: [],
      renderNode,
      devicePaths: binding?.devicePaths.filter((node) => node !== renderNode),
      env:
        model && config
          ? {
              LD_LIBRARY_PATH: "/engine",
              ...(binding ? backendDescriptor(binding.backend).env : {}),
            }
          : {},
      workdir: model && config ? "/engine" : undefined,
      limits: {
        memoryBytes: config.memoryBytes,
        addressSpaceBytes: config.addressSpaceBytes,
        timeoutMs: config.timeoutMs,
        threads: this.lastPlan.threads,
        logicalThreads: this.hardware?.cpu.logicalThreads,
      },
    });
    const cgroupRoot = process.env.ACOS_CGROUP_ROOT;
    this.containmentPlan = planContainment({
      platform: this.isolation.platform,
      threads: this.lastPlan.threads,
      cgroupRoot,
      requireCgroup: process.env.ACOS_REQUIRE_CGROUP === "1",
      windowsHelperAvailable: this.hardware?.isolation.available,
    });
    this.containment = cgroupRoot
      ? new JobContainment(
          cgroupRoot,
          config.memoryBytes,
          this.lastPlan.threads + 16,
        )
      : null;
    const argv = this.containment?.wrap(wrapped.argv) ?? wrapped.argv;
    this.reservation = this.lastPlan;
    return new Promise((resolve, reject) => {
      const child = spawn(argv[0], argv.slice(1), {
        detached: true,
        env: wrapped.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      this.active = child;
      this.activeHandle = wrapped.handle;
      let out = "",
        err = "",
        timedOut = false,
        overflow = false;
      const timer = setTimeout(() => {
        timedOut = true;
        this.cancel();
      }, config?.timeoutMs ?? 120_000);
      child.stdout?.on("data", (data) => {
        const text = data.toString();
        out += text;
        // Streaming consumers receive raw deltas; the cap still bounds total output.
        if (onChunk && !overflow) onChunk(text);
        if (out.length > 65536) {
          overflow = true;
          this.cancel();
        }
      });
      child.stderr?.on("data", (data) => {
        err = (err + data.toString()).slice(-4000);
      });
      let spawnError: Error | null = null;
      child.on("error", (error) => {
        spawnError = error;
      });
      child.on("close", async (code, signal) => {
        try {
          await this.containment?.close();
        } catch (error) {
          spawnError = error as Error;
          this.containmentFailure = spawnError;
          this.verified = false;
        }
        this.containment = null;
        if (spawnError) {
          const error = spawnError;
          clearTimeout(timer);
          this.active = null;
          this.activeHandle = null;
          this.reservation = null;
          reject(error);
          return;
        }
        clearTimeout(timer);
        this.active = null;
        this.activeHandle = null;
        this.reservation = null;
        if (timedOut)
          reject(
            new Error(
              "Inference timed out; process terminated and resources released.",
            ),
          );
        else if (overflow) reject(new Error("Engine output limit exceeded."));
        else if (signal)
          reject(
            new Error(
              signal === "SIGXCPU"
                ? "Engine exceeded its aggregate CPU-time budget."
                : "Inference cancelled or terminated by a host resource limit.",
            ),
          );
        else if (code !== 0)
          reject(
            new Error(`Isolated engine failed (${code}): ${err.slice(-800)}`),
          );
        else resolve(out);
      });
    });
  }
}

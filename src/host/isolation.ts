// Platform isolation adapters (architecture: isolation is a separate layer from
// hardware discovery and from AI-engine support).
//
// The engine treats the model process as untrusted. Hardware discovery, resource
// admission and the operation pipeline are platform-independent; only the
// confinement primitive differs. This module is the single place that knows how
// to confine a launched process, so the engine never hard-codes platform
// specifics.
//
//   Linux  : Bubblewrap (namespaces, cleared env, no network) + prlimit (rlimits).
//   macOS  : Seatbelt (sandbox-exec) deny-by-default profile + ulimit rlimits.
//   Windows: AppContainer (capability-free SID) + Job Object (memory/CPU/process
//            limits) + WFP network denial + restricted low-integrity token,
//            driven by a small native helper (`acos-isolate.exe`). The helper is
//            authored but not compiled in the Linux development sandbox; the
//            adapter's pure logic (limit mapping, environment, job spec) is unit
//            tested and the OS enforcement is verified by
//            `src/windows/verify-windows.ps1` on real Windows 11 hardware.

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { release } from "node:os";
import path from "node:path";
import { executionLimits } from "./limits.ts";
import { sandboxArgs } from "./sandbox.ts";

export interface IsolationLimits {
  // Working-memory budget for admission (not a virtual address-space limit).
  memoryBytes: number;
  addressSpaceBytes?: number;
  timeoutMs: number;
  threads: number;
  // Host logical cores, when known, so a CPU-share cap can be derived.
  logicalThreads?: number;
}

export interface ReadOnlyMount {
  source: string;
  target: string;
}

export interface WrapInput {
  // The program and arguments to run under confinement (not including the
  // confinement wrapper itself).
  command: string[];
  // Host paths exposed read-only inside the sandbox, with their in-sandbox target.
  readOnlyPaths: ReadOnlyMount[];
  // Host paths exposed writable inside the sandbox (scratch only).
  writablePaths: string[];
  // Extra environment variables the confined program needs (e.g. LD_LIBRARY_PATH).
  env: Record<string, string>;
  // Working directory inside the sandbox.
  workdir?: string;
  limits: IsolationLimits;
}

export interface IsolationHandle {
  platform: "linux" | "win32" | "darwin";
  mechanism: string;
  // Windows: the named Job Object the helper created and owns. Terminating the
  // helper closes the job, and JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE reaps every
  // descendant.
  jobName?: string;
}

export interface WrappedCommand {
  argv: string[];
  env: Record<string, string>;
  handle: IsolationHandle;
}

export interface IsolationProbe {
  available: boolean;
  reason: string | null;
  mechanism: string;
}

export interface IsolationAdapter {
  readonly platform: "linux" | "win32" | "darwin";
  readonly mechanism: string;
  // Whether the mechanism is usable on this host right now.
  probe(): IsolationProbe;
  // Build the argv + environment that runs `command` under confinement.
  wrap(input: WrapInput): WrappedCommand;
  // Terminate everything the adapter launched for the given handle.
  terminate(handle: IsolationHandle, pid?: number): void;
}

// --- Linux ------------------------------------------------------------------

export class LinuxIsolationAdapter implements IsolationAdapter {
  readonly platform = "linux" as const;
  readonly mechanism = "Bubblewrap namespaces + prlimit rlimits";

  probe(): IsolationProbe {
    try {
      // The same checks discovery performs, but run directly so the adapter is
      // self-contained when used outside the discovery pipeline.
      if (
        spawnSync("/usr/bin/prlimit", ["--version"], { timeout: 5000 })
          .status !== 0
      )
        throw new Error("prlimit unavailable");
      if (
        spawnSync("/usr/bin/bwrap", [...sandboxArgs(), "/bin/true"], {
          timeout: 5000,
        }).status !== 0
      )
        throw new Error("bubblewrap unavailable");
      return { available: true, reason: null, mechanism: this.mechanism };
    } catch {
      return {
        available: false,
        reason:
          "Required Linux namespaces, Bubblewrap, or prlimit unavailable. Inference is disabled.",
        mechanism: this.mechanism,
      };
    }
  }

  wrap(input: WrapInput): WrappedCommand {
    const limits = executionLimits(input.limits, input.limits.threads);
    const mounts: string[] = [];
    for (const mount of input.readOnlyPaths)
      mounts.push("--ro-bind", mount.source, mount.target);
    for (const target of input.writablePaths) mounts.push("--bind", target, target);
    for (const [key, value] of Object.entries(input.env))
      mounts.push("--setenv", key, value);
    if (input.workdir) mounts.push("--chdir", input.workdir);
    const argv = [
      "/usr/bin/prlimit",
      "--as=" + limits.addressSpaceBytes,
      "--cpu=" + limits.cpuSeconds,
      "--stack=" + limits.stackBytes,
      "--core=0",
      "--nofile=128",
      "--fsize=1048576",
      "--",
      "/usr/bin/bwrap",
      ...sandboxArgs(),
      ...mounts,
      // Bounds glibc arena proliferation; total heap is bounded by --as above.
      "--setenv",
      "MALLOC_ARENA_MAX",
      "2",
      ...input.command,
    ];
    return {
      argv,
      env: { PATH: "/usr/bin:/bin" },
      handle: { platform: "linux", mechanism: this.mechanism },
    };
  }

  terminate(_handle: IsolationHandle, pid?: number): void {
    if (!pid) return;
    try {
      // Negative pid targets the process group created by the detached spawn.
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* Already gone. */
      }
    }
  }
}

// --- Windows ----------------------------------------------------------------

// Pure mapping from the platform-neutral budget to the Windows Job Object limit
// fields. Kept separate from process creation so it is unit-testable off-Windows.
export interface WindowsJobLimits {
  // JOB_OBJECT_LIMIT_PROCESS_MEMORY: per-process committed-memory cap.
  processMemoryBytes: number;
  // JOB_OBJECT_LIMIT_JOB_MEMORY: aggregate committed-memory cap for the job.
  jobMemoryBytes: number;
  // JOBOBJECT_CPU_RATE_CONTROL_INFORMATION CpuRate, in hundredths of a percent
  // of total processing capacity (1..10000).
  cpuRateHundredths: number;
  // JOB_OBJECT_LIMIT_ACTIVE_PROCESS: the engine is a single process.
  activeProcessLimit: number;
  // Host-side wall-clock deadline; the helper terminates the job when it expires.
  wallClockMs: number;
}

export function windowsJobLimits(limits: IsolationLimits): WindowsJobLimits {
  const memory = limits.memoryBytes;
  const addressSpace =
    limits.addressSpaceBytes ??
    Math.max(2 * memory, memory + 256 * 1024 ** 2);
  const share =
    limits.logicalThreads && limits.logicalThreads > 0
      ? limits.threads / limits.logicalThreads
      : 1;
  const cpuRateHundredths = Math.max(
    1,
    Math.min(10_000, Math.ceil(share * 10_000)),
  );
  return {
    processMemoryBytes: memory,
    jobMemoryBytes: addressSpace,
    cpuRateHundredths,
    activeProcessLimit: 1,
    wallClockMs: limits.timeoutMs,
  };
}

// The JSON contract between the TypeScript adapter and the native helper. The
// helper is the only component that touches Windows security APIs.
export interface WindowsJobSpec {
  version: 1;
  jobName: string;
  command: string[];
  readOnlyPaths: ReadOnlyMount[];
  writablePaths: string[];
  workdir: string | null;
  env: Record<string, string>;
  limits: WindowsJobLimits;
  // AppContainer profile is capability-free, so it has no network capabilities.
  appContainer: "capability-free";
  // Additional WFP rule scoped to the AppContainer SID as defence in depth.
  network: "deny";
  // Restricted token at low integrity; no SeDebugPrivilege; isolated desktop.
  integrity: "low";
}

export class WindowsIsolationAdapter implements IsolationAdapter {
  readonly platform = "win32" as const;
  readonly mechanism =
    "AppContainer + Job Object + WFP + restricted low-integrity token";

  private readonly helper: string;

  constructor(helper?: string) {
    this.helper =
      helper ??
      process.env.ACOS_ISOLATE_HELPER ??
      path.join(process.env.LOCALAPPDATA ?? "", "ACOS", "acos-isolate.exe");
  }

  probe(): IsolationProbe {
    if (process.platform !== "win32")
      return {
        available: false,
        reason: "Native Windows isolation is only available on Windows.",
        mechanism: this.mechanism,
      };
    const build = Number(release().split(".")[2] ?? 0);
    if (Number.isFinite(build) && build > 0 && build < 22000)
      return {
        available: false,
        reason: "ACOS native isolation requires Windows 11 (build 22000+).",
        mechanism: this.mechanism,
      };
    if (!existsSync(this.helper))
      return {
        available: false,
        reason:
          "The ACOS native isolation helper (acos-isolate.exe) is not installed.",
        mechanism: this.mechanism,
      };
    return { available: true, reason: null, mechanism: this.mechanism };
  }

  wrap(input: WrapInput): WrappedCommand {
    const jobName = "ACOS-Engine-" + randomUUID();
    const spec: WindowsJobSpec = {
      version: 1,
      jobName,
      command: input.command,
      readOnlyPaths: input.readOnlyPaths,
      writablePaths: input.writablePaths,
      workdir: input.workdir ?? null,
      env: input.env,
      limits: windowsJobLimits(input.limits),
      appContainer: "capability-free",
      network: "deny",
      integrity: "low",
    };
    return {
      argv: [this.helper, "--job-spec", JSON.stringify(spec)],
      // The helper constructs the child environment block explicitly; the host
      // environment is never inherited.
      env: {},
      handle: { platform: "win32", mechanism: this.mechanism, jobName },
    };
  }

  terminate(handle: IsolationHandle, pid?: number): void {
    // Killing the helper closes the Job Object handle; with
    // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE the whole job (engine + descendants)
    // dies with it. The helper also calls TerminateJobObject on its own exit.
    if (!pid) return;
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* Already gone. */
    }
  }
}

// --- macOS ------------------------------------------------------------------

// Seatbelt profile quoting: sandbox-exec profiles are S-expressions, so string
// literals are double-quoted with backslash escaping.
function seatbeltQuote(value: string): string {
  return '"' + value.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

export class DarwinIsolationAdapter implements IsolationAdapter {
  readonly platform = "darwin" as const;
  readonly mechanism = "Seatbelt (sandbox-exec) profile + ulimit rlimits";

  probe(): IsolationProbe {
    if (process.platform !== "darwin")
      return {
        available: false,
        reason: "macOS isolation is only available on macOS.",
        mechanism: this.mechanism,
      };
    if (!existsSync("/usr/bin/sandbox-exec"))
      return {
        available: false,
        reason:
          "sandbox-exec is unavailable. Inference is disabled rather than run unconfined.",
        mechanism: this.mechanism,
      };
    return { available: true, reason: null, mechanism: this.mechanism };
  }

  // A deny-by-default Seatbelt profile: the confined engine may read the system
  // libraries and its own engine/model paths, execute only itself, and write only
  // to declared scratch. Network is denied outright. This is the same posture as
  // the Linux (no network, read-only engine/model) and Windows (capability-free
  // AppContainer, WFP deny) adapters.
  profile(input: WrapInput): string {
    const reads = [
      '(subpath "/usr/lib")',
      '(subpath "/System")',
      '(subpath "/usr/share")',
      ...input.readOnlyPaths.map((m) => `(subpath ${seatbeltQuote(m.source)})`),
    ].join(" ");
    const writes = input.writablePaths
      .map((p) => `(subpath ${seatbeltQuote(p)})`)
      .join(" ");
    const lines = [
      "(version 1)",
      "(deny default)",
      `(allow process-exec (literal ${seatbeltQuote(input.command[0])}))`,
      "(allow process-fork)",
      "(allow sysctl-read)",
      "(allow mach-lookup)",
      `(allow file-read* ${reads})`,
    ];
    if (writes) lines.push(`(allow file-write* ${writes})`);
    lines.push("(deny network*)");
    return lines.join("\n");
  }

  wrap(input: WrapInput): WrappedCommand {
    const limits = executionLimits(input.limits, input.limits.threads);
    const profile = this.profile(input);
    // macOS ships no prlimit; bash's ulimit applies the same rlimits before the
    // engine is exec'd. CPU time and file-size/open-file caps are enforced by the
    // kernel; the address-space cap is best-effort on Darwin.
    const script = [
      `ulimit -t ${limits.cpuSeconds}`,
      "ulimit -n 128",
      "ulimit -f 1048576",
      `ulimit -v ${Math.ceil(limits.addressSpaceBytes / 1024)} 2>/dev/null || true`,
      'exec "$@"',
    ].join("; ");
    const argv = [
      "/bin/bash",
      "-c",
      script,
      "acos-isolate",
      "/usr/bin/sandbox-exec",
      "-p",
      profile,
      ...input.command,
    ];
    return {
      argv,
      env: { PATH: "/usr/bin:/bin" },
      handle: { platform: "darwin", mechanism: this.mechanism },
    };
  }

  terminate(_handle: IsolationHandle, pid?: number): void {
    if (!pid) return;
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* Already gone. */
      }
    }
  }
}

// --- Selection --------------------------------------------------------------

export function selectIsolationAdapter(
  platform: NodeJS.Platform = process.platform,
): IsolationAdapter {
  if (platform === "win32") return new WindowsIsolationAdapter();
  if (platform === "darwin") return new DarwinIsolationAdapter();
  return new LinuxIsolationAdapter();
}

// Discovery-facing probe. Linux reuses the injectable runner so hardware
// discovery stays testable; other platforms delegate to the platform adapter.
export function probeIsolation(source: {
  platform: string;
  run(command: string, args: string[]): string;
}): { available: boolean; reason: string | null } {
  if (source.platform === "linux") {
    try {
      source.run("/usr/bin/prlimit", ["--version"]);
      source.run("/usr/bin/bwrap", [...sandboxArgs(), "/bin/true"]);
      return { available: true, reason: null };
    } catch {
      return {
        available: false,
        reason:
          "Required Linux namespaces, Bubblewrap, or prlimit unavailable. Inference is disabled.",
      };
    }
  }
  const probe = selectIsolationAdapter(
    source.platform as NodeJS.Platform,
  ).probe();
  return { available: probe.available, reason: probe.reason };
}

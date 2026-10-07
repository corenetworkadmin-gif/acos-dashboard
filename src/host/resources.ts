import type { ComputePlan, HardwareReport } from "../runtime/hardware.ts";

export interface ComputeProvider {
  backend: string;
  architectures: string[];
  // Accelerator IDs must come from a provider probe, never from a vendor-name guess.
  devices: string[];
}
export interface Workload {
  memoryBytes: number;
  acceleratorMemoryBytes: number;
  maxThreads: number;
}
export interface ComputePolicy {
  backend: string;
  preferredDevice?: string;
  allowCpu: boolean;
  memoryFraction: number;
}
export const cpuProvider: ComputeProvider = {
  backend: "cpu",
  architectures: ["x64", "arm64"],
  devices: ["cpu"],
};
export function planCompute(
  hardware: HardwareReport,
  providers: ComputeProvider[],
  workload: Workload,
  policy: ComputePolicy,
): ComputePlan {
  if (!hardware.isolation.available)
    throw new Error(hardware.isolation.reason ?? "Isolation unavailable.");
  if (!Number.isSafeInteger(workload.memoryBytes) || workload.memoryBytes <= 0)
    throw new Error(
      "The selected model must declare a positive memory budget (ACOS_MODEL_RAM_MB).",
    );
  if (
    !Number.isFinite(policy.memoryFraction) ||
    policy.memoryFraction <= 0 ||
    policy.memoryFraction > 0.9
  )
    throw new Error(
      "Memory policy must leave host headroom (fraction greater than 0 and at most 0.9).",
    );
  if (
    workload.memoryBytes >
    Math.floor(hardware.memory.availableBytes * policy.memoryFraction)
  )
    throw new Error(
      "Insufficient available system memory for this model and host headroom. Choose a smaller model or free resources.",
    );
  if (!Number.isSafeInteger(workload.maxThreads) || workload.maxThreads < 1)
    throw new Error("CPU thread policy must be a positive integer.");
  if (
    !Number.isSafeInteger(workload.acceleratorMemoryBytes) ||
    workload.acceleratorMemoryBytes < 0
  )
    throw new Error("Invalid accelerator memory requirement.");
  const candidates = providers
    .filter(
      (p) =>
        p.architectures.includes(hardware.architecture) &&
        (policy.backend === "auto" || p.backend === policy.backend),
    )
    .flatMap((p) =>
      p.devices.flatMap((id) => {
        if (id === "cpu")
          return policy.allowCpu ? [{ backend: p.backend, id, free: 0 }] : [];
        const device = hardware.accelerators.find((d) => d.id === id);
        if (
          !device ||
          device.availableMemoryBytes === null ||
          device.availableMemoryBytes < workload.acceleratorMemoryBytes
        )
          return [];
        return [{ backend: p.backend, id, free: device.availableMemoryBytes }];
      }),
    )
    .sort(
      (a, b) =>
        Number(a.id === "cpu") - Number(b.id === "cpu") ||
        Number(b.id === policy.preferredDevice) -
          Number(a.id === policy.preferredDevice) ||
        b.free - a.free ||
        a.id.localeCompare(b.id),
    );
  let selected = candidates[0];
  if (!selected && policy.allowCpu) {
    const cpu = providers.find(
      (provider) =>
        provider.backend === "cpu" &&
        provider.architectures.includes(hardware.architecture) &&
        provider.devices.includes("cpu"),
    );
    if (cpu) selected = { backend: "cpu", id: "cpu", free: 0 };
  }
  const fallback =
    !!selected && selected.backend === "cpu" && policy.backend !== "cpu";
  const reason = fallback
    ? `No admitted ${policy.backend === "auto" ? "accelerator" : policy.backend} provider; using CPU within the same host memory and isolation limits.`
    : null;
  if (!selected)
    throw new Error(
      `No compatible ${policy.backend} compute provider is available for ${hardware.architecture} and this workload.`,
    );
  return {
    fallback,
    reason,
    backend: selected.backend,
    deviceId: selected.id,
    threads: Math.max(
      1,
      Math.min(hardware.cpu.usableThreads, workload.maxThreads),
    ),
    memoryBytes: workload.memoryBytes,
    acceleratorMemoryBytes:
      selected.id === "cpu" ? 0 : workload.acceleratorMemoryBytes,
  };
}

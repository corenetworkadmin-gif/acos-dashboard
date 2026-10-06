import { readFileSync, realpathSync, statSync } from "node:fs";
import type { HardwareReport } from "../runtime/hardware.ts";
import type { ComputeProvider } from "./resources.ts";
export const backendIds = ["cpu", "vulkan", "cuda", "rocm", "metal"] as const;
export type BackendId = (typeof backendIds)[number];
export interface BackendDescriptor {
  id: BackendId;
  platforms: readonly string[];
  architectures: readonly string[];
  engineDevice: RegExp;
  deviceNode: RegExp;
  // Empty executionPlatforms means discovery/description only: never grant access.
  executionPlatforms: readonly string[];
  env: Readonly<Record<string, string>>;
  offloadArgs(device?: string): string[];
}
const descriptor = (
  id: BackendId,
  platforms: string[],
  executionPlatforms: string[],
  engineDevice: RegExp,
  deviceNode: RegExp,
  env: Record<string, string> = {},
): BackendDescriptor => ({
  id,
  platforms,
  executionPlatforms,
  architectures: ["x64", "arm64"],
  engineDevice,
  deviceNode,
  env,
  offloadArgs: (device) =>
    id === "cpu"
      ? ["-ngl", "0", "--device", "none"]
      : ["-ngl", "999", "--device", device ?? "none"],
});
export const backendRegistry: readonly BackendDescriptor[] = [
  descriptor(
    "cpu",
    ["linux", "win32", "darwin"],
    ["linux", "win32", "darwin"],
    /^CPU$/,
    /$^/,
  ),
  descriptor(
    "vulkan",
    ["linux", "win32"],
    ["linux"],
    /^Vulkan\d+$/,
    /^\/dev\/dri\/renderD\d+$/,
  ),
  descriptor(
    "cuda",
    ["linux", "win32"],
    ["linux"],
    /^CUDA\d+$/,
    /^\/dev\/nvidia(?:\d+|ctl|-uvm|-uvm-tools)$/,
  ),
  descriptor(
    "rocm",
    ["linux"],
    ["linux"],
    /^(?:ROCm|HIP)\d+$/,
    /^\/dev\/(?:kfd|dri\/renderD\d+)$/,
  ),
  // Metal requires a verified IOKit/Seatbelt boundary before execution is enabled.
  descriptor("metal", ["darwin"], [], /^Metal\d*$/, /$^/),
];
export function backendDescriptor(id: string): BackendDescriptor {
  const found = backendRegistry.find((item) => item.id === id);
  if (!found) throw new Error(`Unknown compute backend: ${id}`);
  return found;
}
export interface BackendBinding {
  backend: BackendId;
  deviceId: string;
  devicePaths: string[];
  engineDevice?: string;
}
export function validateDevicePath(value: string) {
  if (
    !backendRegistry.some(
      (item) => item.id !== "cpu" && item.deviceNode.test(value),
    ) ||
    realpathSync(value) !== value ||
    !statSync(value).isCharacterDevice()
  )
    throw new Error(
      "Only explicit accelerator character device nodes may be exposed.",
    );
}
export function validateBinding(binding: BackendBinding) {
  const backend = backendDescriptor(binding.backend);
  if (!backend.executionPlatforms.includes(process.platform))
    throw new Error(
      `${backend.id} execution isolation is unavailable on ${process.platform}.`,
    );
  if (binding.devicePaths.length === 0 || binding.devicePaths.length > 8)
    throw new Error("Accelerator requires a bounded explicit device-node set.");
  for (const node of binding.devicePaths) {
    if (!backend.deviceNode.test(node))
      throw new Error("Device node does not belong to the selected backend.");
    validateDevicePath(node);
  }
  if (binding.backend === "cuda") {
    if (
      !/^pci:[a-f0-9]{4}:[a-f0-9]{2}:[a-f0-9]{2}\.[a-f0-9]$/i.test(
        binding.deviceId,
      )
    )
      throw new Error("CUDA requires a discovered PCI identity.");
    const info = readFileSync(
      `/proc/driver/nvidia/gpus/${binding.deviceId.slice(4)}/information`,
      "utf8",
    );
    const minor = info.match(/^Device Minor:\s*(\d+)\s*$/m)?.[1];
    if (!minor || !binding.devicePaths.includes(`/dev/nvidia${minor}`))
      throw new Error("CUDA node does not match the discovered PCI device.");
  }
  if (binding.backend === "vulkan" && binding.devicePaths.length !== 1)
    throw new Error("Vulkan requires exactly one render node.");
  if (
    binding.backend === "cuda" &&
    (!binding.devicePaths.includes("/dev/nvidiactl") ||
      binding.devicePaths.filter((node) => /^\/dev\/nvidia\d+$/.test(node))
        .length !== 1)
  )
    throw new Error("CUDA requires one GPU node and its control node.");
  if (
    binding.backend === "rocm" &&
    (!binding.devicePaths.includes("/dev/kfd") ||
      binding.devicePaths.filter((node) => /\/renderD\d+$/.test(node))
        .length !== 1)
  )
    throw new Error("ROCm requires kfd and one render node.");
}
export function probeBackend(
  hardware: HardwareReport,
  binding: BackendBinding,
  listing: string,
  memoryBytes: number,
): BackendBinding {
  const backend = backendDescriptor(binding.backend);
  const device = hardware.accelerators.find(
    (item) => item.id === binding.deviceId,
  );
  const names = [...listing.matchAll(/^\s*([A-Za-z]+\d*):/gm)]
    .map((match) => match[1])
    .filter((name) => backend.engineDevice.test(name));
  if (
    !backend.executionPlatforms.includes(hardware.platform) ||
    !backend.architectures.includes(hardware.architecture) ||
    !device ||
    names.length !== 1 ||
    (binding.engineDevice && binding.engineDevice !== names[0]) ||
    !Number.isSafeInteger(memoryBytes) ||
    memoryBytes <= 0 ||
    device.availableMemoryBytes === null ||
    device.availableMemoryBytes < memoryBytes
  )
    throw new Error(
      `${backend.id} engine probe, compatibility or VRAM admission failed.`,
    );
  if (binding.backend === "cuda" && device.vendor !== "0x10de")
    throw new Error("CUDA requires NVIDIA discovery evidence.");
  if (binding.backend === "rocm" && device.vendor !== "0x1002")
    throw new Error("ROCm requires AMD discovery evidence.");
  return { ...binding, engineDevice: names[0] };
}
export function deriveProviders(
  hardware: HardwareReport,
  verified: BackendBinding[],
): ComputeProvider[] {
  return [
    { backend: "cpu", architectures: ["x64", "arm64"], devices: ["cpu"] },
    ...verified
      .filter(
        (binding) =>
          binding.engineDevice &&
          backendDescriptor(binding.backend).executionPlatforms.includes(
            hardware.platform,
          ) &&
          hardware.accelerators.some(
            (device) => device.id === binding.deviceId,
          ),
      )
      .map((binding) => ({
        backend: binding.backend,
        architectures: [...backendDescriptor(binding.backend).architectures],
        devices: [binding.deviceId],
      })),
  ];
}

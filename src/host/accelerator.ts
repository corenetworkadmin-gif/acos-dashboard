import { realpathSync, statSync } from "node:fs";
import path from "node:path";
import type { HardwareReport } from "../runtime/hardware.ts";
export function renderDevice(node: string) {
  if (
    !/^\/dev\/dri\/renderD\d+$/.test(node) ||
    realpathSync(node) !== node ||
    !statSync(node).isCharacterDevice()
  )
    throw new Error("Vulkan requires an explicit DRM render character device.");
  const pci = path.basename(
    realpathSync(`/sys/class/drm/${path.basename(node)}/device`),
  );
  if (!/^[a-f0-9]{4}:[a-f0-9]{2}:[a-f0-9]{2}\.[a-f0-9]$/i.test(pci))
    throw new Error("Cannot map render device to discovered PCI hardware.");
  return "pci:" + pci.toLowerCase();
}
export function admitVulkan(
  hardware: HardwareReport,
  pci: string,
  listing: string,
  memoryBytes: number,
) {
  const devices = [...listing.matchAll(/^\s*(Vulkan\d+):/gm)].map(
    (match) => match[1],
  );
  const device = hardware.accelerators.find((item) => item.id === pci);
  if (
    devices.length !== 1 ||
    !device ||
    !Number.isSafeInteger(memoryBytes) ||
    memoryBytes <= 0 ||
    device.availableMemoryBytes === null ||
    device.availableMemoryBytes < memoryBytes
  )
    throw new Error("Vulkan probe or measured VRAM admission failed.");
  return { id: pci, engineDevice: devices[0] };
}

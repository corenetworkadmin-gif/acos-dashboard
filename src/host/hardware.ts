import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, readlinkSync, statfsSync } from "node:fs";
import {
  availableParallelism,
  cpus,
  freemem,
  release,
  totalmem,
} from "node:os";
import path from "node:path";
import type { Accelerator, HardwareReport } from "../runtime/hardware.ts";
import { probeIsolation as probeHostIsolation } from "./isolation.ts";

// Dependency injection is only for discovery fixtures; production uses the installed host.
export interface DiscoverySource {
  platform: string;
  architecture: string;
  kernel: string;
  cpus: ReturnType<typeof cpus>;
  parallelism: number;
  total: number;
  available: number;
  read(file: string): string | null;
  list(directory: string): string[];
  link(file: string): string | null;
  storage(directory: string): HardwareReport["storage"];
  run(command: string, args: string[]): string;
}
const read = (file: string) => {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
};
const liveSource = (): DiscoverySource => ({
  platform: process.platform,
  architecture: process.arch,
  kernel: release(),
  cpus: cpus(),
  parallelism: availableParallelism(),
  total: totalmem(),
  available: Math.min(freemem(), process.availableMemory()),
  read,
  list(directory) {
    try {
      return readdirSync(directory);
    } catch {
      return [];
    }
  },
  link(file) {
    try {
      return readlinkSync(file);
    } catch {
      return null;
    }
  },
  storage(directory) {
    try {
      const s = statfsSync(directory);
      return {
        totalBytes: s.blocks * s.bsize,
        availableBytes: s.bavail * s.bsize,
      };
    } catch {
      return null;
    }
  },
  run(command, args) {
    return execFileSync(command, args, {
      encoding: "utf8",
      timeout: 5000,
      maxBuffer: 1024 * 1024,
      env: { PATH: "/usr/bin:/bin" },
    });
  },
});
const positive = (value: string | null) => {
  const n = Number(value?.trim());
  return Number.isFinite(n) && n > 0 ? n : null;
};

// Include ancestor cgroup v2 limits, not only the machine's physical RAM/CPU count.
function cgroupDirectories(source: DiscoverySource) {
  const relative = source.read("/proc/self/cgroup")?.match(/^0::(.*)$/m)?.[1];
  const root = "/sys/fs/cgroup";
  if (!relative) return [root];
  let current = path.posix.join(root, relative);
  const result = [root];
  while (current.startsWith(root + "/")) {
    result.push(current);
    current = path.posix.dirname(current);
  }
  return result;
}
export function discoverHardware(
  directory: string,
  source = liveSource(),
  probeIsolation = true,
): HardwareReport {
  const limitations: string[] = [];
  let total = source.total,
    available = source.available,
    threads = source.parallelism;
  const memAvailable = positive(
    source.read("/proc/meminfo")?.match(/^MemAvailable:\s+(\d+) kB$/m)?.[1] ??
      null,
  );
  if (memAvailable) available = Math.min(memAvailable * 1024, source.available);
  for (const group of cgroupDirectories(source)) {
    const max = positive(source.read(group + "/memory.max"));
    const currentText = source.read(group + "/memory.current");
    const used = currentText === null ? NaN : Number(currentText.trim());
    if (max) {
      total = Math.min(total, max);
      // An unreadable usage counter cannot authorize an allocation.
      available = Math.min(
        available,
        Number.isFinite(used) ? Math.max(0, max - used) : 0,
      );
    }
    const quota = source
      .read(group + "/cpu.max")
      ?.trim()
      .split(/\s+/);
    if (quota && positive(quota[0]) && positive(quota[1]))
      threads = Math.min(
        threads,
        Math.max(1, Math.floor(Number(quota[0]) / Number(quota[1]))),
      );
  }
  const cpuInfo = source.read("/proc/cpuinfo") ?? "";
  const featureSets = [
    ...cpuInfo.matchAll(/^(?:flags|Features)\s*:\s*(.*)$/gm),
  ].map((m) => m[1].split(/\s+/));
  const features = featureSets.length
    ? featureSets[0].filter((flag) =>
        featureSets.every((set) => set.includes(flag)),
      )
    : [];
  const accelerators: Accelerator[] = [];
  for (const id of source.list("/sys/bus/pci/devices")) {
    const base = "/sys/bus/pci/devices/" + id;
    const deviceClass = source.read(base + "/class")?.trim();
    if (!deviceClass || !/^0x(?:03|12)/.test(deviceClass)) continue;
    const vendor = source.read(base + "/vendor")?.trim() ?? "unknown";
    const device = source.read(base + "/device")?.trim() ?? "unknown";
    const memoryBytes = positive(source.read(base + "/mem_info_vram_total"));
    const usedText = source.read(base + "/mem_info_vram_used");
    const used = usedText === null ? NaN : Number(usedText);
    accelerators.push({
      id: "pci:" + id,
      name: `${vendor}:${device}`,
      vendor,
      type: deviceClass.startsWith("0x03") ? "gpu" : "accelerator",
      driver:
        source
          .link(base + "/driver")
          ?.split("/")
          .pop() ?? null,
      memoryBytes,
      availableMemoryBytes:
        memoryBytes && Number.isFinite(used)
          ? Math.max(0, memoryBytes - used)
          : null,
      computeCapability: null,
    });
  }
  // Optional installed driver telemetry. Absence never triggers a driver/toolkit install.
  let nvidia = false;
  for (const command of [
    "/usr/bin/nvidia-smi",
    "/usr/lib/wsl/lib/nvidia-smi",
  ]) {
    try {
      const rows = source.run(command, [
        "--query-gpu=pci.bus_id,name,memory.total,memory.free,compute_cap",
        "--format=csv,noheader,nounits",
      ]);
      for (const row of rows.trim().split("\n")) {
        const [bus, name, totalMiB, freeMiB, compute] = row
          .split(",")
          .map((v) => v.trim());
        if (!bus || !name || !/^\w{4,8}:\w{2}:\w{2}\.\w$/.test(bus)) continue;
        const id = "pci:" + bus.toLowerCase().replace(/^00000000:/, "0000:");
        const existing = accelerators.findIndex((a) => a.id === id);
        const memory = positive(totalMiB),
          free = Number(freeMiB);
        const entry: Accelerator = {
          id,
          name,
          vendor: "0x10de",
          type: "gpu",
          driver: "nvidia",
          memoryBytes: memory === null ? null : memory * 1024 ** 2,
          availableMemoryBytes:
            Number.isFinite(free) && free >= 0 ? free * 1024 ** 2 : null,
          computeCapability: /^\d+\.\d+$/.test(compute) ? compute : null,
        };
        if (existing >= 0) accelerators[existing] = entry;
        else accelerators.push(entry);
      }
      nvidia = true;
      break;
    } catch {
      /* Missing or incompatible driver telemetry is an unknown, not zero VRAM. */
    }
  }
  if (!nvidia)
    limitations.push(
      "NVIDIA driver telemetry unavailable; PCI inventory remains usable where exposed.",
    );
  limitations.push(
    "Discovery is limited to devices exposed by the host OS/VM. Unknown memory or compute support is not assumed available.",
  );
  let isolation: HardwareReport["isolation"] = {
    available: false,
    reason: "Isolation has not been probed.",
  };
  // Isolation is its own layer: the platform adapter decides whether confinement
  // is enforceable, independently of CPU/RAM/accelerator discovery.
  if (probeIsolation) isolation = probeHostIsolation(source);
  return {
    discoveredAt: new Date().toISOString(),
    platform: source.platform,
    architecture: source.architecture,
    environment: /microsoft/i.test(source.kernel)
      ? "WSL (guest-visible resources)"
      : "Host or virtual machine (OS-visible resources)",
    cpu: {
      model: source.cpus[0]?.model ?? "unknown",
      logicalThreads: source.cpus.length,
      usableThreads: Math.max(1, Math.floor(threads)),
      features: [...new Set(features)].sort(),
    },
    memory: {
      totalBytes: total,
      availableBytes: Math.max(0, Math.min(total, available)),
    },
    storage: source.storage(directory),
    accelerators,
    isolation,
    limitations,
  };
}

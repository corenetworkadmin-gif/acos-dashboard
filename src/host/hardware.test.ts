import test from "node:test";
import assert from "node:assert/strict";
import { discoverHardware, type DiscoverySource } from "./hardware.ts";
import { cpuProvider, planCompute } from "./resources.ts";
const GiB = 1024 ** 3;
function source(
  files: Record<string, string> = {},
  overrides: Partial<DiscoverySource> = {},
): DiscoverySource {
  return {
    platform: "linux",
    architecture: "x64",
    kernel: "test-kernel",
    cpus: Array.from({ length: 8 }, () => ({
      model: "TEST DATA CPU",
      speed: 0,
      times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
    })),
    parallelism: 6,
    total: 16 * GiB,
    available: 12 * GiB,
    read: (file) => files[file] ?? null,
    list: () => [],
    link: () => null,
    storage: () => ({ totalBytes: 100 * GiB, availableBytes: 20 * GiB }),
    run(command) {
      if (command.includes("nvidia")) throw new Error("absent");
      return "";
    },
    ...overrides,
  };
}
const policy = { backend: "auto", allowCpu: true, memoryFraction: 0.75 };
const workload = {
  memoryBytes: GiB,
  acceleratorMemoryBytes: 0,
  maxThreads: 32,
};
test("CPU-only host derives affinity, features, RAM and destination storage without any GPU requirement", () => {
  let checkedPath = "";
  const h = discoverHardware(
    "/different-volume/home",
    source(
      { "/proc/cpuinfo": "flags : sse avx\nflags : sse\n" },
      {
        storage: (directory) => {
          checkedPath = directory;
          return { totalBytes: 50 * GiB, availableBytes: 9 * GiB };
        },
      },
    ),
  );
  assert.equal(checkedPath, "/different-volume/home");
  assert.deepEqual(h.cpu.features, ["sse"]);
  assert.equal(h.cpu.usableThreads, 6);
  assert.equal(h.accelerators.length, 0);
  assert.equal(h.storage?.availableBytes, 9 * GiB);
  assert.equal(planCompute(h, [cpuProvider], workload, policy).threads, 6);
});
test("ancestor cgroup limits bound memory and CPU; unreadable usage fails admission", () => {
  const files = {
    "/proc/self/cgroup": "0::/tenant/acos",
    "/sys/fs/cgroup/tenant/memory.max": String(4 * GiB),
    "/sys/fs/cgroup/tenant/memory.current": String(3 * GiB),
    "/sys/fs/cgroup/tenant/cpu.max": "150000 100000",
  };
  const h = discoverHardware("/data", source(files));
  assert.equal(h.memory.totalBytes, 4 * GiB);
  assert.equal(h.memory.availableBytes, GiB);
  assert.equal(h.cpu.usableThreads, 1);
  assert.throws(
    () => planCompute(h, [cpuProvider], workload, policy),
    /Insufficient/,
  );
  delete (files as Record<string, string>)[
    "/sys/fs/cgroup/tenant/memory.current"
  ];
  assert.equal(
    discoverHardware("/data", source(files)).memory.availableBytes,
    0,
  );
});
test("ARM64, constrained RAM, one thread and missing isolation degrade independently", () => {
  const h = discoverHardware(
    "/data",
    source(
      {},
      {
        architecture: "arm64",
        parallelism: 1,
        total: 3 * GiB,
        available: 2 * GiB,
      },
    ),
  );
  assert.equal(planCompute(h, [cpuProvider], workload, policy).threads, 1);
  const unavailable = discoverHardware(
    "/data",
    source(
      {},
      {
        run() {
          throw new Error("namespace denied");
        },
        storage: () => null,
      },
    ),
  );
  assert.equal(unavailable.storage, null);
  assert.throws(
    () => planCompute(unavailable, [cpuProvider], workload, policy),
    /Inference is disabled/,
  );
  assert.throws(
    () =>
      planCompute(
        { ...h, architecture: "unsupported-test-arch" },
        [cpuProvider],
        workload,
        policy,
      ),
    /No compatible/,
  );
});
test("PCI enumeration handles integrated, discrete and other accelerators with unknown data", () => {
  const root = "/sys/bus/pci/devices/";
  const h = discoverHardware(
    "/data",
    source(
      {
        [root + "0000:00:02.0/class"]: "0x030000",
        [root + "0000:01:00.0/class"]: "0x030200",
        [root + "0000:02:00.0/class"]: "0x120000",
        [root + "0000:01:00.0/mem_info_vram_total"]: String(8 * GiB),
        [root + "0000:01:00.0/mem_info_vram_used"]: String(2 * GiB),
      },
      { list: () => ["0000:00:02.0", "0000:01:00.0", "0000:02:00.0"] },
    ),
  );
  assert.equal(h.accelerators.length, 3);
  assert.equal(h.accelerators[0].memoryBytes, null);
  assert.equal(h.accelerators[1].availableMemoryBytes, 6 * GiB);
  assert.equal(h.accelerators[2].type, "accelerator");
  assert.equal(planCompute(h, [cpuProvider], workload, policy).deviceId, "cpu");
  assert.equal(
    planCompute(h, [cpuProvider], workload, { ...policy, backend: "cuda" })
      .backend,
    "cpu",
  );
});
test("optional NVIDIA telemetry merges PCI identities and handles unknown memory", () => {
  const h = discoverHardware(
    "/data",
    source(
      { "/sys/bus/pci/devices/0000:01:00.0/class": "0x030000" },
      {
        list: () => ["0000:01:00.0"],
        run: (command) =>
          command.includes("nvidia")
            ? "00000000:01:00.0, TEST GPU A, 8192, 4096, 8.6\n00000000:02:00.0, TEST GPU B, [N/A], [N/A], [N/A]"
            : "",
      },
    ),
  );
  assert.equal(h.accelerators.length, 2);
  assert.equal(h.accelerators[0].availableMemoryBytes, 4 * GiB);
  assert.equal(h.accelerators[0].computeCapability, "8.6");
  assert.equal(h.accelerators[1].memoryBytes, null);
});
test("provider contract selects by compatibility, workload, availability and preference, with no primary device", () => {
  const h = discoverHardware("/data", source());
  h.accelerators = ["a", "b", "unknown"].map((id, i) => ({
    id,
    name: "TEST DATA",
    vendor: "test",
    type: "gpu",
    driver: "fixture",
    memoryBytes: 8 * GiB,
    availableMemoryBytes: i === 2 ? null : (i + 1) * 3 * GiB,
    computeCapability: null,
  }));
  // Synthetic providers test the contract; no GPU execution is registered by the production engine.
  const providers = [
    cpuProvider,
    {
      backend: "test-gpu",
      architectures: ["x64"],
      devices: ["a", "b", "unknown"],
    },
  ];
  const gpuWork = { ...workload, acceleratorMemoryBytes: 2 * GiB };
  assert.equal(planCompute(h, providers, gpuWork, policy).deviceId, "b");
  assert.equal(
    planCompute(h, providers, gpuWork, { ...policy, preferredDevice: "a" })
      .deviceId,
    "a",
  );
  h.accelerators[0].availableMemoryBytes = GiB;
  assert.equal(
    planCompute(h, providers, gpuWork, { ...policy, preferredDevice: "a" })
      .deviceId,
    "b",
  );
  h.accelerators[1].availableMemoryBytes = 0;
  assert.equal(planCompute(h, providers, gpuWork, policy).backend, "cpu");
  assert.equal(
    planCompute(h, providers, gpuWork, policy).acceleratorMemoryBytes,
    0,
  );
  assert.equal(
    planCompute(h, providers, workload, { ...policy, backend: "cpu" }).deviceId,
    "cpu",
  );
  assert.throws(
    () => planCompute(h, providers, { ...workload, memoryBytes: 0 }, policy),
    /declare/,
  );
});

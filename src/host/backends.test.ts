import test from "node:test";
import assert from "node:assert/strict";
import {
  backendRegistry,
  backendDescriptor,
  probeBackend,
  deriveProviders,
  validateBinding,
  validateDevicePath,
} from "./backends.ts";
import { discoverHardware } from "./hardware.ts";
import { planCompute } from "./resources.ts";
const MiB = 1024 ** 2;
function hardware() {
  const h = discoverHardware(process.cwd(), undefined, false);
  h.platform = "linux";
  h.architecture = "x64";
  h.isolation.available = true;
  h.memory.availableBytes = 8192 * MiB;
  h.accelerators = [
    {
      id: "pci:0000:01:00.0",
      name: "synthetic GPU",
      type: "gpu",
      vendor: "0x10de",
      driver: "test",
      memoryBytes: 4096 * MiB,
      availableMemoryBytes: 2048 * MiB,
      computeCapability: "8.0",
    },
  ];
  return h;
}
test("registry exposes bounded backend contracts and unverified hardware grants no provider", () => {
  assert.deepEqual(
    backendRegistry.map((b) => b.id),
    ["cpu", "vulkan", "cuda", "rocm", "metal"],
  );
  assert.deepEqual(backendDescriptor("cpu").offloadArgs(), [
    "-ngl",
    "0",
    "--device",
    "none",
  ]);
  assert.deepEqual(backendDescriptor("cuda").offloadArgs("CUDA0"), [
    "-ngl",
    "999",
    "--device",
    "CUDA0",
  ]);
  assert.throws(() => backendDescriptor("unknown"), /Unknown/);
  assert.deepEqual(
    deriveProviders(hardware(), []).map((p) => p.backend),
    ["cpu"],
  );
  assert.throws(() => validateDevicePath("/dev/null"), /explicit accelerator/);
  assert.throws(
    () =>
      validateBinding({ backend: "metal", deviceId: "metal", devicePaths: [] }),
    /unavailable/,
  );
});
test("isolated device listing and measured VRAM gate accelerator admission", () => {
  const h = hardware();
  const binding = {
    backend: "cuda" as const,
    deviceId: h.accelerators[0].id,
    devicePaths: ["/dev/nvidia0", "/dev/nvidiactl"],
  };
  const admitted = probeBackend(
    h,
    binding,
    "Available devices:\n  CUDA0: synthetic (4096 MiB)",
    MiB,
  );
  const providers = deriveProviders(h, [admitted]);
  const workload = {
    memoryBytes: 1024 * MiB,
    acceleratorMemoryBytes: 1024 * MiB,
    maxThreads: 32,
  };
  const policy = { backend: "cuda", allowCpu: true, memoryFraction: 0.75 };
  assert.equal(planCompute(h, providers, workload, policy).backend, "cuda");
  for (const listing of ["", "Vulkan0: wrong", "CUDA0: first\nCUDA1: second"])
    assert.throws(() => probeBackend(h, binding, listing, MiB), /probe/);
  assert.throws(
    () => probeBackend(h, binding, "CUDA0: gpu", 8192 * MiB),
    /VRAM/,
  );
  assert.throws(
    () =>
      probeBackend(h, { ...binding, engineDevice: "CUDA1" }, "CUDA0: gpu", MiB),
    /probe/,
  );
  h.accelerators[0].availableMemoryBytes = 0;
  const fallback = planCompute(h, providers, workload, policy);
  assert.equal(fallback.backend, "cpu");
  assert.equal(fallback.fallback, true);
  assert.equal(fallback.acceleratorMemoryBytes, 0);
  assert.match(fallback.reason!, /cuda/);
  assert.throws(
    () => planCompute(h, providers, workload, { ...policy, allowCpu: false }),
    /No compatible/,
  );
  h.memory.availableBytes = 1;
  assert.throws(
    () => planCompute(h, providers, workload, policy),
    /Insufficient/,
  );
});

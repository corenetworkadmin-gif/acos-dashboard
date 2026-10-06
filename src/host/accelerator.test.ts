import test from "node:test";
import assert from "node:assert/strict";
import { admitVulkan, renderDevice } from "./accelerator.ts";
import { discoverHardware } from "./hardware.ts";
test("Vulkan admission requires a uniquely probed engine device and actual free VRAM telemetry", () => {
  const hardware = discoverHardware(process.cwd(), undefined, false);
  hardware.accelerators = [
    {
      id: "pci:0000:01:00.0",
      name: "synthetic",
      vendor: "test",
      type: "gpu",
      driver: "test",
      memoryBytes: 2048,
      availableMemoryBytes: 1024,
      computeCapability: null,
    },
  ];
  assert.equal(
    admitVulkan(hardware, "pci:0000:01:00.0", "  Vulkan0: test", 512)
      .engineDevice,
    "Vulkan0",
  );
  assert.throws(
    () => admitVulkan(hardware, "pci:0000:01:00.0", "CPU: test", 512),
    /probe/,
  );
  assert.throws(
    () => admitVulkan(hardware, "pci:0000:01:00.0", "Vulkan0: test", 2048),
    /VRAM/,
  );
  hardware.accelerators[0].availableMemoryBytes = null;
  assert.throws(
    () => admitVulkan(hardware, "pci:0000:01:00.0", "Vulkan0: test", 512),
    /VRAM/,
  );
  assert.throws(() => renderDevice("/dev/null"), /DRM/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { CommandDeviceBridge } from "./providers/device-bridge.ts";
import { DeviceProvider } from "./providers.ts";

test("device bridge probe reports a missing capture tool", () => {
  const bridge = new CommandDeviceBridge({
    probeFn: () => false,
    microphone: "Mic",
  });
  assert.deepEqual(bridge.probe("microphone"), {
    available: false,
    reason: 'Capture tool "ffmpeg" is not available on this host.',
  });
});

test("device bridge requires an explicit device name on Windows and macOS", () => {
  const windows = new CommandDeviceBridge({ platform: "win32", probeFn: () => true });
  assert.match(
    windows.probe("microphone").reason!,
    /No microphone capture device is configured/,
  );
  assert.deepEqual(
    new CommandDeviceBridge({
      platform: "win32",
      probeFn: () => true,
      microphone: "Microphone (Realtek)",
    }).probe("microphone"),
    { available: true, reason: null },
  );
  const mac = new CommandDeviceBridge({ platform: "darwin", probeFn: () => true });
  assert.match(mac.probe("camera").reason!, /No camera capture device/);
});

test("device bridge resolves Linux defaults without extra configuration", () => {
  const bridge = new CommandDeviceBridge({ platform: "linux", probeFn: () => true });
  assert.deepEqual(bridge.probe("microphone"), { available: true, reason: null });
  assert.deepEqual(bridge.probe("camera"), { available: true, reason: null });
});

test("device capture runs through the tool with dshow args and cleans up", async () => {
  let capturedArgs: string[] = [];
  let outputPath = "";
  const bridge = new CommandDeviceBridge({
    platform: "win32",
    probeFn: () => true,
    microphone: "Microphone (Realtek)",
    runFn: (_tool, args) => {
      capturedArgs = args;
      outputPath = args[args.length - 1];
      writeFileSync(outputPath, Buffer.alloc(1234, 7));
      return Promise.resolve({ code: 0, stderr: "" });
    },
  });
  const result = await bridge.capture({
    device: "microphone",
    timeoutMs: 5000,
    signal: new AbortController().signal,
  });
  assert.equal(result.summary, "Captured 2s of audio (1234 bytes).");
  assert.deepEqual(result.detail, {
    device: "microphone",
    tool: "ffmpeg",
    bytes: 1234,
    seconds: 2,
  });
  assert.ok(capturedArgs.includes("dshow"));
  assert.ok(capturedArgs.includes("audio=Microphone (Realtek)"));
  assert.ok(capturedArgs.includes("-t"));
  assert.equal(existsSync(outputPath), false, "temp capture file must be removed");
});

test("camera capture requests a single frame", async () => {
  let capturedArgs: string[] = [];
  const bridge = new CommandDeviceBridge({
    platform: "win32",
    probeFn: () => true,
    camera: "Integrated Webcam",
    runFn: (_tool, args) => {
      capturedArgs = args;
      writeFileSync(args[args.length - 1], Buffer.alloc(88, 1));
      return Promise.resolve({ code: 0, stderr: "" });
    },
  });
  const result = await bridge.capture({
    device: "camera",
    timeoutMs: 5000,
    signal: new AbortController().signal,
  });
  assert.equal(result.summary, "Captured 1 frame (88 bytes).");
  assert.ok(capturedArgs.includes("video=Integrated Webcam"));
  assert.ok(capturedArgs.includes("-frames:v"));
});

test("device capture surfaces a bounded failure and refuses when unavailable", async () => {
  const failing = new CommandDeviceBridge({
    platform: "win32",
    probeFn: () => true,
    microphone: "Missing Device",
    runFn: () =>
      Promise.resolve({
        code: 1,
        stderr: "dummy input line one\naudio device not found\ntrailing line\n",
      }),
  });
  await assert.rejects(
    failing.capture({
      device: "microphone",
      timeoutMs: 5000,
      signal: new AbortController().signal,
    }),
    /Capture failed \(exit 1\): .*audio device not found/,
  );

  const unavailable = new CommandDeviceBridge({ probeFn: () => false });
  await assert.rejects(
    unavailable.capture({
      device: "microphone",
      timeoutMs: 1000,
      signal: new AbortController().signal,
    }),
    /not available/,
  );
});

test("device provider delegates availability to the bridge probe", () => {
  const denying = new DeviceProvider("microphone", {
    probe: () => ({ available: false, reason: "Tool missing." }),
    capture: async () => ({ summary: "unused" }),
  });
  assert.deepEqual(denying.probe(), { available: false, reason: "Tool missing." });
  assert.throws(() => denying.attach(), /Tool missing/);

  // Bridges without a probe (injected doubles, minimal components) stay
  // available whenever they exist.
  const legacy = new DeviceProvider("camera", {
    capture: async () => ({ summary: "captured camera" }),
  });
  assert.equal(legacy.probe().available, true);
});

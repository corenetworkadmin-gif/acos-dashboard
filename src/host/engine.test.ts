import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { LocalEngine, markerSafeLength } from "./engine.ts";
function fixture(script: string, timeoutMs = 2000) {
  const dir = mkdtempSync(path.join(tmpdir(), "acos-engine-test-"));
  const binary = path.join(dir, "engine");
  const model = path.join(dir, "fixture.gguf");
  writeFileSync(binary, "#!/bin/sh\n" + script, { mode: 0o700 });
  writeFileSync(model, "synthetic-model");
  const engine = new LocalEngine({
    binary,
    model,
    sha256: createHash("sha256").update("synthetic-model").digest("hex"),
    context: 4096,
    maxTokens: 64,
    memoryBytes: 128 * 1024 ** 2,
    timeoutMs,
  });
  return {
    engine,
    model,
    close() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
test("real isolated provider cannot write model; context and post-verification mutations fail closed", async () => {
  const f = fixture(
    'if (echo changed >> /model.gguf) 2>/dev/null; then exit 1; fi\nprintf "Read-only model verified"',
  );
  try {
    await f.engine.verify();
    assert.equal(await f.engine.infer("hi"), "Read-only model verified");
    await assert.rejects(f.engine.infer("界".repeat(2000)), /Context budget/);
    writeFileSync(f.model, "modified model");
    await assert.rejects(f.engine.infer("hi"), /changed since verification/);
    await assert.rejects(f.engine.verify(), /integrity verification failed/);
  } finally {
    f.close();
  }
});
test("real sandbox process timeout and cancellation leave no active provider", async () => {
  const f = fixture("sleep 10\necho late", 150);
  try {
    await f.engine.verify();
    await assert.rejects(f.engine.infer("hi"), /timed out/);
    assert.equal(f.engine.active, null);
    f.engine.config!.timeoutMs = 2000;
    const result = f.engine.infer("hi");
    const rejected = assert.rejects(result, /cancelled/);
    await new Promise((resolve) => setTimeout(resolve, 50));
    f.engine.cancel();
    await rejected;
    assert.equal(f.engine.active, null);
  } finally {
    f.close();
  }
});

test("fresh memory admission rejects pressure before spawning and releases real reservations", async () => {
  const f = fixture('sleep 0.05\nprintf "done"');
  try {
    await f.engine.verify();
    const hardware = structuredClone(f.engine.hardware!);
    f.engine.discover = () => hardware;
    hardware.memory.availableBytes = f.engine.config!.memoryBytes * 4;
    const result = f.engine.infer("hi");
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(
      f.engine.reservation?.memoryBytes,
      f.engine.config!.memoryBytes,
    );
    await result;
    assert.equal(f.engine.reservation, null);
    hardware.memory.availableBytes = 1;
    await assert.rejects(f.engine.infer("hi"), /Insufficient available/);
    assert.equal(f.engine.active, null);
    assert.equal(f.engine.reservation, null);
  } finally {
    f.close();
  }
});

test("markerSafeLength holds back partial trailing end-of-text markers", () => {
  assert.equal(markerSafeLength("hello"), 5);
  assert.equal(markerSafeLength("hello["), 5);
  assert.equal(markerSafeLength("hello[e"), 5);
  assert.equal(markerSafeLength("hello[end"), 5);
  assert.equal(markerSafeLength("hello[end of tex"), 5);
  assert.equal(markerSafeLength("hello[end of text"), 5);
  assert.equal(markerSafeLength("[end"), 0);
  assert.equal(markerSafeLength("[en"), 0);
  assert.equal(markerSafeLength("["), 0);
  assert.equal(markerSafeLength(""), 0);
});

test("streaming inference yields deltas and strips the end-of-text marker", async () => {
  const f = fixture(
    'printf "Hel"; sleep 0.05; printf "lo "; sleep 0.05; printf "world[end of text]"',
  );
  try {
    await f.engine.verify();
    const chunks: string[] = [];
    const stream = f.engine.inferStream("hi");
    let result = "";
    while (true) {
      const next = await stream.next();
      if (next.done) {
        result = next.value;
        break;
      }
      chunks.push(next.value);
    }
    assert.equal(chunks.join(""), "Hello world");
    assert.equal(result, "Hello world");
    assert.ok(chunks.length >= 2);
    assert.ok(!chunks.join("").includes("[end of text]"));
  } finally {
    f.close();
  }
});

test("missing accelerator falls back to confined CPU with no GPU offload", async () => {
  const f = fixture('printf "%s\\n" "$@"');
  try {
    f.engine.config!.backend = "cuda";
    f.engine.config!.acceleratorBackend = "cuda";
    f.engine.config!.acceleratorMemoryBytes = 1024 ** 3;
    await f.engine.verify();
    const result = await f.engine.infer("hi");
    assert.match(result, /-ngl\n0\n--device\nnone/);
    assert.equal(f.engine.lastPlan?.fallback, true);
    assert.equal(f.engine.lastPlan?.acceleratorMemoryBytes, 0);
    assert.match(f.engine.lastPlan?.reason ?? "", /CPU fallback/);
    assert.equal(f.engine.reservation, null);
  } finally {
    f.close();
  }
});

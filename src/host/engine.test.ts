import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { LocalEngine } from "./engine.ts";
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
    memoryBytes: 4294967296,
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

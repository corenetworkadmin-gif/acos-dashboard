import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_EXTENSION_WASM_BYTES,
  runExtensionWasm,
} from "./extension-sandbox.ts";
import { noopWasm, spinWasm, writeWasm } from "./fixtures/wasm.ts";

test("sandbox runs a minimal module to completion with no output", async () => {
  const result = await runExtensionWasm(noopWasm(), { timeoutMs: 5000 });
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stdoutTruncated, false);
  assert.ok(result.durationMs >= 0);
});

test("sandbox captures bounded stdout from a WASI module", async () => {
  const result = await runExtensionWasm(writeWasm("Hello ACOS\n"), {
    timeoutMs: 5000,
  });
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "Hello ACOS\n");
  assert.equal(result.stdoutTruncated, false);
});

test("sandbox clamps stdout at the configured bound inside the module", async () => {
  const result = await runExtensionWasm(writeWasm("A".repeat(1000)), {
    timeoutMs: 5000,
    maxStdoutBytes: 256,
  });
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.stdout.length, 256);
  assert.equal(result.stdoutTruncated, true);
});

test("sandbox terminates a runaway module at the wall-clock timeout", async () => {
  const started = Date.now();
  const result = await runExtensionWasm(spinWasm(), { timeoutMs: 300 });
  const elapsed = Date.now() - started;
  assert.equal(result.status, "TIMED_OUT");
  assert.equal(result.exitCode, null);
  assert.match(result.error!, /terminated/);
  // The worker must actually be killed: no lingering runaway.
  assert.ok(elapsed >= 300 && elapsed < 10_000, `elapsed ${elapsed}ms`);
});

test("sandbox fails closed on malformed, empty and oversized modules", async () => {
  const malformed = await runExtensionWasm(
    new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0xff]),
    { timeoutMs: 1000 },
  );
  assert.equal(malformed.status, "FAILED");
  assert.ok(malformed.error);

  const empty = await runExtensionWasm(new Uint8Array(0));
  assert.equal(empty.status, "FAILED");
  assert.match(empty.error!, /empty/);

  const oversized = await runExtensionWasm(
    new Uint8Array(MAX_EXTENSION_WASM_BYTES + 1),
  );
  assert.equal(oversized.status, "FAILED");
  assert.match(oversized.error!, /bound/);
});

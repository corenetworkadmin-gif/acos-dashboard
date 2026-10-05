import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { executionLimits } from "./limits.ts";
import { LocalEngine } from "./engine.ts";
const GiB = 1024 ** 3;
test("CPU allowance scales with workers while virtual memory has separate stack/arena headroom", () => {
  for (const threads of [1, 8, 15, 32]) {
    const limits = executionLimits(
      { memoryBytes: 2 * GiB, timeoutMs: 120000 },
      threads,
    );
    assert.ok(limits.cpuSeconds > 120 * threads);
    assert.ok(limits.addressSpaceBytes > 2 * GiB + threads * limits.stackBytes);
  }
  assert.throws(
    () =>
      executionLimits(
        { memoryBytes: 2 * GiB, addressSpaceBytes: 2 * GiB, timeoutMs: 120000 },
        32,
      ),
    /too small/,
  );
  assert.throws(
    () => executionLimits({ memoryBytes: GiB, timeoutMs: NaN }, 1),
    /timeout/,
  );
});
test("actual isolated 32-worker allocator stress uses scaled limits without an imposed UID-wide process cap", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "acos-thread-stress-"));
  const binary = path.join(dir, "thread-stress");
  const model = path.join(dir, "synthetic.gguf");
  try {
    execFileSync("cc", [
      "-O2",
      "-pthread",
      "src/host/fixtures/thread-stress.c",
      "-o",
      binary,
    ]);
    writeFileSync(model, "synthetic fixture");
    const config = {
      binary,
      model,
      sha256: createHash("sha256").update("synthetic fixture").digest("hex"),
      context: 4096,
      maxTokens: 64,
      memoryBytes: GiB,
      timeoutMs: 5000,
      maxThreads: 32,
    };
    const engine = new LocalEngine(config);
    await engine.verify();
    // Explicit oversubscription fixture, not a claim that this runner has 32 cores.
    const hardware = structuredClone(engine.hardware!);
    hardware.cpu.usableThreads = 32;
    engine.discover = () => hardware;
    const report = JSON.parse(await engine.infer("Synthetic stress request"));
    assert.equal(report.threads, 32);
    assert.equal(report.arenaMax, "2");
    const limits = executionLimits(config, 32);
    assert.equal(report.addressSpaceBytes, limits.addressSpaceBytes);
    assert.equal(report.cpuSeconds, limits.cpuSeconds);
    assert.equal(report.stackBytes, limits.stackBytes);
    const inheritedNproc = execFileSync(
      "/usr/bin/prlimit",
      [
        "--pid",
        String(process.pid),
        "--nproc",
        "--output",
        "SOFT",
        "--noheadings",
        "--raw",
      ],
      { encoding: "utf8" },
    ).trim();
    if (inheritedNproc === "unlimited")
      assert.ok(report.nproc > Number.MAX_SAFE_INTEGER);
    else assert.equal(report.nproc, Number(inheritedNproc));
    assert.equal(engine.reservation, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

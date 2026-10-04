// Optional real-model validation. Explicitly oversubscribes workers to test thread overhead.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { LocalEngine, engineConfig } from "./engine.ts";
import { executionLimits } from "./limits.ts";
const config = engineConfig();
if (!config)
  throw new Error(
    "Configure ACOS_ENGINE_BINARY, ACOS_MODEL_PATH and ACOS_MODEL_SHA256 before test:engine.",
  );
function sample(pid: number): {
  threads: number;
  virtualKiB: number;
  rssKiB: number;
} {
  try {
    const status = readFileSync(`/proc/${pid}/status`, "utf8");
    let best = {
      threads: readdirSync(`/proc/${pid}/task`).length,
      virtualKiB: Number(status.match(/^VmPeak:\s+(\d+)/m)?.[1] ?? 0),
      rssKiB: Number(status.match(/^VmHWM:\s+(\d+)/m)?.[1] ?? 0),
    };
    for (const child of readFileSync(
      `/proc/${pid}/task/${pid}/children`,
      "utf8",
    )
      .trim()
      .split(/\s+/)
      .filter(Boolean)) {
      const next = sample(Number(child));
      best = {
        threads: Math.max(best.threads, next.threads),
        virtualKiB: Math.max(best.virtualKiB, next.virtualKiB),
        rssKiB: Math.max(best.rssKiB, next.rssKiB),
      };
    }
    return best;
  } catch {
    return { threads: 0, virtualKiB: 0, rssKiB: 0 };
  }
}
for (const threads of [1, 8, 15, 32]) {
  const engine: LocalEngine = new LocalEngine({ ...config, maxThreads: threads });
  await engine.verify();
  const hardware = structuredClone(engine.hardware!);
  const visibleThreads = hardware.cpu.usableThreads;
  hardware.cpu.usableThreads = threads; // Test-only override; RAM/isolation remain actual detected values.
  engine.discover = () => hardware;
  let peak = { threads: 0, virtualKiB: 0, rssKiB: 0 };
  const timer = setInterval(() => {
    if (!engine.active?.pid) return;
    const next = sample(engine.active.pid);
    peak = {
      threads: Math.max(peak.threads, next.threads),
      virtualKiB: Math.max(peak.virtualKiB, next.virtualKiB),
      rssKiB: Math.max(peak.rssKiB, next.rssKiB),
    };
  }, 10);
  const started = Date.now();
  try {
    const response = await engine.infer(
      "<|im_start|>user\nSay hello in a short sentence.<|im_end|>\n<|im_start|>assistant\n",
      32,
    );
    assert.ok(response.trim());
    assert.ok(
      peak.threads >= threads,
      `Only observed ${peak.threads} of ${threads} workers`,
    );
    assert.equal(engine.reservation, null);
    console.log(
      JSON.stringify({
        requestedThreads: threads,
        visibleThreads,
        oversubscribed: threads > visibleThreads,
        elapsedMs: Date.now() - started,
        ...peak,
        limits: executionLimits(engine.config!, threads),
        response,
      }),
    );
  } finally {
    clearInterval(timer);
    engine.cancel();
  }
}

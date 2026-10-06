import test from "node:test";
import assert from "node:assert/strict";
import {
  DarwinIsolationAdapter,
  LinuxIsolationAdapter,
  WindowsIsolationAdapter,
  probeIsolation,
  selectIsolationAdapter,
  windowsJobLimits,
  type WindowsJobSpec,
} from "./isolation.ts";
import { executionLimits } from "./limits.ts";
import { sandboxArgs } from "./sandbox.ts";

const GiB = 1024 ** 3;

test("Linux adapter wraps a command in prlimit + bubblewrap with the admitted limits", () => {
  const adapter = new LinuxIsolationAdapter();
  const limits = {
    memoryBytes: 2 * GiB,
    timeoutMs: 120_000,
    threads: 4,
  };
  const wrapped = adapter.wrap({
    command: ["/engine/llama-completion", "-m", "/model.gguf"],
    readOnlyPaths: [
      { source: "/opt/engine", target: "/engine" },
      { source: "/models/q.gguf", target: "/model.gguf" },
    ],
    writablePaths: [],
    env: { LD_LIBRARY_PATH: "/engine" },
    workdir: "/engine",
    limits,
  });
  const expected = executionLimits(limits, 4);
  assert.equal(wrapped.argv[0], "/usr/bin/prlimit");
  assert.ok(wrapped.argv.includes("--as=" + expected.addressSpaceBytes));
  assert.ok(wrapped.argv.includes("--cpu=" + expected.cpuSeconds));
  assert.ok(wrapped.argv.includes("--stack=" + expected.stackBytes));
  assert.ok(wrapped.argv.includes("--core=0"));
  // Bubblewrap runs the sandbox, and the sandbox args are present verbatim.
  const bwrapAt = wrapped.argv.indexOf("/usr/bin/bwrap");
  assert.ok(bwrapAt > 0);
  assert.deepEqual(
    wrapped.argv.slice(bwrapAt + 1, bwrapAt + 1 + sandboxArgs().length),
    sandboxArgs(),
  );
  // Read-only mounts, the extra env and the working directory are preserved.
  assert.ok(
    wrapped.argv.join("\u0000").includes("/opt/engine\u0000/engine"),
    "engine dir is bound read-only",
  );
  assert.ok(
    wrapped.argv.join("\u0000").includes("/models/q.gguf\u0000/model.gguf"),
    "model is bound read-only",
  );
  assert.ok(
    wrapped.argv
      .join("\u0000")
      .includes("--setenv\u0000LD_LIBRARY_PATH\u0000/engine"),
  );
  assert.ok(wrapped.argv.join("\u0000").includes("--chdir\u0000/engine"));
  // The confined command is the tail of the argv.
  assert.deepEqual(wrapped.argv.slice(-3), [
    "/engine/llama-completion",
    "-m",
    "/model.gguf",
  ]);
  // A cleared environment: only PATH reaches the sandbox.
  assert.deepEqual(wrapped.env, { PATH: "/usr/bin:/bin" });
  assert.equal(wrapped.handle.platform, "linux");
});

test("Linux adapter omits mounts for a non-model command", () => {
  const adapter = new LinuxIsolationAdapter();
  const wrapped = adapter.wrap({
    command: ["/bin/true"],
    readOnlyPaths: [],
    writablePaths: [],
    env: {},
    limits: { memoryBytes: GiB, timeoutMs: 60_000, threads: 1 },
  });
  assert.ok(!wrapped.argv.includes("/model.gguf"));
  assert.ok(!wrapped.argv.includes("/engine"));
  assert.equal(wrapped.argv.at(-1), "/bin/true");
});

test("Windows job limits map the platform-neutral budget to Job Object fields", () => {
  const limits = windowsJobLimits({
    memoryBytes: 2 * GiB,
    timeoutMs: 120_000,
    threads: 4,
    logicalThreads: 8,
  });
  assert.equal(limits.processMemoryBytes, 2 * GiB);
  assert.equal(limits.jobMemoryBytes, 4 * GiB);
  assert.equal(limits.activeProcessLimit, 1);
  assert.equal(limits.wallClockMs, 120_000);
  // 4 workers on 8 logical cores => 50% of total capacity => 5000 hundredths.
  assert.equal(limits.cpuRateHundredths, 5000);
});

test("Windows job limits clamp the CPU share and honour an explicit address space", () => {
  const capped = windowsJobLimits({
    memoryBytes: GiB,
    timeoutMs: 1000,
    threads: 64,
    logicalThreads: 8,
  });
  assert.equal(capped.cpuRateHundredths, 10_000);
  const explicit = windowsJobLimits({
    memoryBytes: GiB,
    addressSpaceBytes: 9 * GiB,
    timeoutMs: 1000,
    threads: 1,
  });
  assert.equal(explicit.jobMemoryBytes, 9 * GiB);
});

test("Windows adapter emits a helper argv carrying a complete job spec", () => {
  const adapter = new WindowsIsolationAdapter("C:\\ACOS\\acos-isolate.exe");
  const wrapped = adapter.wrap({
    command: ["C:\\engine\\llama.exe", "-m", "C:\\model.gguf"],
    readOnlyPaths: [{ source: "C:\\engine", target: "C:\\engine" }],
    writablePaths: ["C:\\scratch"],
    env: { LD_LIBRARY_PATH: "C:\\engine" },
    workdir: "C:\\engine",
    limits: { memoryBytes: 2 * GiB, timeoutMs: 120_000, threads: 2 },
  });
  assert.equal(wrapped.argv[0], "C:\\ACOS\\acos-isolate.exe");
  assert.equal(wrapped.argv[1], "--job-spec");
  const spec = JSON.parse(wrapped.argv[2]) as WindowsJobSpec;
  assert.equal(spec.version, 1);
  assert.equal(spec.appContainer, "capability-free");
  assert.equal(spec.network, "deny");
  assert.equal(spec.integrity, "low");
  assert.deepEqual(spec.command, [
    "C:\\engine\\llama.exe",
    "-m",
    "C:\\model.gguf",
  ]);
  assert.equal(spec.limits.activeProcessLimit, 1);
  assert.ok(spec.jobName.startsWith("ACOS-Engine-"));
  assert.equal(wrapped.handle.jobName, spec.jobName);
  // The host environment is never inherited.
  assert.deepEqual(wrapped.env, {});
});

test("adapter selection follows the platform and probes fail closed off-platform", () => {
  assert.equal(selectIsolationAdapter("linux").platform, "linux");
  assert.equal(selectIsolationAdapter("win32").platform, "win32");
  assert.equal(selectIsolationAdapter("darwin").platform, "darwin");
  // Off Windows the native adapter reports itself unavailable rather than lying.
  const probe = new WindowsIsolationAdapter().probe();
  assert.equal(probe.available, false);
  assert.match(probe.reason ?? "", /only available on Windows/);
  // The macOS adapter likewise refuses to claim availability off macOS.
  const mac = new DarwinIsolationAdapter().probe();
  assert.equal(mac.available, false);
  assert.match(mac.reason ?? "", /only available on macOS/);
});

test("macOS adapter builds a deny-by-default Seatbelt profile and ulimit wrapper", () => {
  const adapter = new DarwinIsolationAdapter();
  const limits = { memoryBytes: 2 * GiB, timeoutMs: 120_000, threads: 4 };
  const wrapped = adapter.wrap({
    command: ["/engine/llama-completion", "-m", "/model.gguf"],
    readOnlyPaths: [
      { source: "/opt/engine", target: "/engine" },
      { source: "/models/q.gguf", target: "/model.gguf" },
    ],
    writablePaths: ["/tmp/scratch"],
    env: { LD_LIBRARY_PATH: "/engine" },
    workdir: "/engine",
    limits,
  });
  const expected = executionLimits(limits, 4);
  // The wrapper is bash applying rlimits, then sandbox-exec with a profile.
  assert.equal(wrapped.argv[0], "/bin/bash");
  assert.equal(wrapped.argv[1], "-c");
  assert.match(wrapped.argv[2], new RegExp("ulimit -t " + expected.cpuSeconds));
  assert.ok(wrapped.argv.includes("/usr/bin/sandbox-exec"));
  const profileAt = wrapped.argv.indexOf("-p") + 1;
  const profile = wrapped.argv[profileAt];
  // Deny by default, no network, engine/model readable, only scratch writable.
  assert.match(profile, /\(deny default\)/);
  assert.match(profile, /\(deny network\*\)/);
  assert.match(profile, /\(subpath "\/opt\/engine"\)/);
  assert.match(profile, /\(subpath "\/models\/q\.gguf"\)/);
  assert.match(profile, /\(allow file-write\* \(subpath "\/tmp\/scratch"\)\)/);
  assert.match(
    profile,
    /\(allow process-exec \(literal "\/engine\/llama-completion"\)\)/,
  );
  // The confined command is the tail of the argv, unchanged.
  assert.deepEqual(wrapped.argv.slice(-3), [
    "/engine/llama-completion",
    "-m",
    "/model.gguf",
  ]);
  assert.deepEqual(wrapped.env, { PATH: "/usr/bin:/bin" });
  assert.equal(wrapped.handle.platform, "darwin");
});

test("macOS profile omits the write rule when there is no scratch path", () => {
  const adapter = new DarwinIsolationAdapter();
  const wrapped = adapter.wrap({
    command: ["/bin/true"],
    readOnlyPaths: [],
    writablePaths: [],
    env: {},
    limits: { memoryBytes: GiB, timeoutMs: 60_000, threads: 1 },
  });
  const profile = wrapped.argv[wrapped.argv.indexOf("-p") + 1];
  assert.ok(!profile.includes("file-write*"));
  assert.equal(wrapped.argv.at(-1), "/bin/true");
});

test("discovery probe reuses the injectable runner on Linux and delegates elsewhere", () => {
  const ok = probeIsolation({ platform: "linux", run: () => "" });
  assert.equal(ok.available, true);
  const denied = probeIsolation({
    platform: "linux",
    run: () => {
      throw new Error("namespace denied");
    },
  });
  assert.equal(denied.available, false);
  assert.match(denied.reason ?? "", /Bubblewrap/);
  // Non-Linux delegates to the platform adapter (unavailable off Windows here).
  const win = probeIsolation({ platform: "win32", run: () => "" });
  assert.equal(win.available, false);
});

test("device passthrough refuses unrelated nodes and unsupported native platforms", () => {
  const input = {
    command: ["/bin/true"],
    readOnlyPaths: [],
    writablePaths: [],
    env: {},
    devicePaths: ["/dev/null"],
    limits: { memoryBytes: GiB, timeoutMs: 1000, threads: 1 },
  };
  assert.throws(() => new LinuxIsolationAdapter().wrap(input), /accelerator/);
  assert.throws(
    () => new WindowsIsolationAdapter().wrap(input),
    /not implemented/,
  );
  assert.throws(() => new DarwinIsolationAdapter().wrap(input), /passthrough/i);
  const wrapped = new WindowsIsolationAdapter().wrap({
    ...input,
    devicePaths: [],
  });
  assert.deepEqual(JSON.parse(wrapped.argv[2]).devicePaths, []);
});

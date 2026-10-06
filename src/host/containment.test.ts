import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { JobContainment, planContainment } from "./containment.ts";
test("containment reports rlimit limitations and refuses strict or invalid delegation", () => {
  for (const threads of [1, 8, 15, 32]) {
    const plan = planContainment({ platform: "linux", threads });
    assert.equal(plan.mode, "rlimits");
    assert.equal(plan.physicalMemory, false);
    assert.equal(plan.taskLimit, null);
  }
  assert.throws(
    () =>
      planContainment({ platform: "linux", threads: 32, requireCgroup: true }),
    /ACOS_CGROUP_ROOT/,
  );
  assert.throws(
    () => planContainment({ platform: "linux", threads: NaN }),
    /budget/,
  );
  const root = mkdtempSync(path.join(tmpdir(), "acos-fake-cgroup-"));
  try {
    assert.throws(
      () =>
        planContainment({ platform: "linux", threads: 32, cgroupRoot: root }),
      /delegated cgroup/,
    );
    assert.throws(() => new JobContainment(root, 1024, 48), /delegated cgroup/);
  } finally {
    rmSync(root, { recursive: true });
  }
});
test("Windows containment requires helper admission and reports process versus thread limits", () => {
  assert.throws(
    () => planContainment({ platform: "win32", threads: 32 }),
    /unavailable/,
  );
  const plan = planContainment({
    platform: "win32",
    threads: 32,
    windowsHelperAvailable: true,
  });
  assert.equal(plan.mode, "windows-job");
  assert.equal(plan.taskLimit, 1);
  assert.match(plan.reason, /not a kernel thread quota/);
});

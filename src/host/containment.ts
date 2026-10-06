import {
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmdirSync,
  statfsSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

// An administrator must delegate an empty cgroup v2 subtree to the ACOS account.
// Never move the host into a job, or alter the parent's resource policy.
export class JobContainment {
  readonly directory: string;
  constructor(root: string, memoryBytes: number, tasks: number) {
    if (process.platform !== "linux")
      throw new Error("cgroup containment requires Linux.");
    if (
      !Number.isSafeInteger(memoryBytes) ||
      memoryBytes < 1 ||
      !Number.isSafeInteger(tasks) ||
      tasks < 1
    )
      throw new Error("Invalid cgroup resource budget.");
    const base = realpathSync(root);
    if (
      statfsSync(base).type !== 0x63677270 ||
      statSync(base).uid !== process.getuid?.()
    )
      throw new Error(
        "ACOS_CGROUP_ROOT must be an owned, delegated cgroup v2 directory.",
      );
    const controllers = readFileSync(
      path.join(base, "cgroup.subtree_control"),
      "utf8",
    ).split(/\s+/);
    if (!controllers.includes("memory") || !controllers.includes("pids"))
      throw new Error(
        "Delegate memory and pids controllers before starting ACOS.",
      );
    // Reap only ACOS jobs whose owning host PID no longer exists. EPERM means
    // alive/unknown, never permission to kill. A reused PID delays cleanup safely.
    for (const entry of readdirSync(base)) {
      const match = /^acos-(\d+)-[a-f0-9-]{36}$/.exec(entry);
      if (!match) continue;
      try {
        process.kill(Number(match[1]), 0);
        continue;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") continue;
      }
      const orphan = path.join(base, entry);
      writeFileSync(path.join(orphan, "cgroup.kill"), "1");
      try {
        rmdirSync(orphan);
      } catch {
        /* Kernel may still be reaping; retry on next admission. */
      }
    }
    this.directory = path.join(base, `acos-${process.pid}-${randomUUID()}`);
    mkdirSync(this.directory);
    try {
      writeFileSync(
        path.join(this.directory, "memory.max"),
        String(memoryBytes),
      );
      writeFileSync(path.join(this.directory, "memory.swap.max"), "0");
      writeFileSync(path.join(this.directory, "memory.oom.group"), "1");
      writeFileSync(path.join(this.directory, "pids.max"), String(tasks));
    } catch (error) {
      rmdirSync(this.directory);
      throw error;
    }
  }
  wrap(argv: string[]): string[] {
    // Only this fixed host launcher runs before admission. The provider starts
    // after the kernel accepts membership; all its descendants inherit it.
    return [
      "/bin/sh",
      "-c",
      'printf "%s" "$$" > "$1/cgroup.procs" || exit 125; shift; exec "$@"',
      "acos-job",
      this.directory,
      ...argv,
    ];
  }
  kill() {
    writeFileSync(path.join(this.directory, "cgroup.kill"), "1");
  }
  async close() {
    this.kill();
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        rmdirSync(this.directory);
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EBUSY") throw error;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    throw new Error(
      "Kernel has not released the job cgroup; containment remains in place.",
    );
  }
}

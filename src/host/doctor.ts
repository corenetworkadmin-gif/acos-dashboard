import { execFileSync } from "node:child_process";
import { totalmem } from "node:os";
import { sandboxArgs } from "./engine.ts";

try {
  if (process.platform !== "linux")
    throw new Error(
      "The host requires Linux. On Windows 11, run inside Ubuntu 24.04 on WSL2.",
    );
  if (process.arch !== "x64")
    throw new Error("The pinned reference engine supports Intel/AMD x64 only.");
  if (Number(process.versions.node.split(".")[0]) < 24)
    throw new Error("Node.js 24 or later is required.");
  if (process.getuid?.() === 0)
    throw new Error("Use an unprivileged account, not root.");
  execFileSync("/usr/bin/prlimit", ["--version"], { stdio: "pipe" });
  execFileSync("/usr/bin/bwrap", [...sandboxArgs(), "/bin/true"], {
    stdio: "pipe",
    timeout: 10000,
  });
  console.log(
    "PASS: Node, x64 Linux, resource-limit tools, and required isolation namespaces.",
  );
  console.log(
    `Available VM/host memory: ${(totalmem() / 1024 ** 3).toFixed(1)} GB. Model loading performs the final memory and tokenizer check.`,
  );
} catch (error) {
  console.error(
    "ACOS preflight failed:",
    error instanceof Error ? error.message : String(error),
  );
  console.error(
    "For WSL2, run wsl --update in Windows and install Ubuntu packages bubblewrap and util-linux. Keep host security settings enabled; do not bypass a failed sandbox check.",
  );
  process.exitCode = 1;
}

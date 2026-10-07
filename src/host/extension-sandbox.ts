// WASI sandbox for extension execution (architecture: installing or enabling an
// extension never grants authority; extension *code* likewise runs isolated).
//
// An installed extension's WASM module executes under wasi_snapshot_preview1
// inside a dedicated worker thread with:
//
//   * no filesystem preopens (the module can only reach the two capture file
//     descriptors the sandbox hands it, both inside a private temp directory),
//   * an empty environment and fixed arguments (no host secrets, no cwd),
//   * bounded stdout/stderr enforced inside the sandbox via a wrapping
//     fd_write, so a runaway module cannot fill the disk,
//   * a hard wall-clock timeout enforced from outside: the worker is
//     terminated, which stops even an infinite loop the module never exits,
//   * a heap resource limit on the worker itself.
//
// The runtime executes only modules belonging to an installed extension, from
// an administrator command, and re-checks detectEscalation afterwards: the
// sandbox cannot attach a provider or enable a capability, so the structural
// non-escalation guarantee covers execution as well as installation.
import { Worker } from "node:worker_threads";
import {
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export const MAX_EXTENSION_WASM_BYTES = 8 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_STDOUT_BYTES = 64 * 1024;

export interface ExtensionRunOptions {
  timeoutMs?: number;
  maxStdoutBytes?: number;
}

export type ExtensionRunStatus = "COMPLETED" | "TIMED_OUT" | "FAILED";

export interface ExtensionRunResult {
  status: ExtensionRunStatus;
  exitCode: number | null;
  // Bounded, decoded stdout (at most maxStdoutBytes).
  stdout: string;
  stdoutTruncated: boolean;
  durationMs: number;
  // Present when status is FAILED.
  error?: string;
}

// The sandbox worker body. It runs as CommonJS inside the worker regardless of
// the package module type; it never touches the filesystem beyond the three
// file descriptors passed in workerData.
const WORKER_SOURCE = `
const { WASI } = require("node:wasi");
const { workerData, parentPort } = require("node:worker_threads");
const fs = require("node:fs");

let instanceRef = null;
try {
  const wasi = new WASI({
    version: "preview1",
    args: ["acos-extension"],
    env: {},
    preopens: {},
    returnOnExit: true,
    stdin: workerData.stdinFd,
    stdout: workerData.stdoutFd,
    stderr: workerData.stderrFd,
  });
  const imports = wasi.getImportObject();
  const original = imports.wasi_snapshot_preview1;
  let remaining = workerData.maxStdoutBytes;
  let exceeded = false;
  // Wrap fd_write so fd 1/2 writes are counted and clamped inside the sandbox
  // before they ever reach the file; other fds delegate to the WASI defaults.
  imports.wasi_snapshot_preview1 = Object.assign({}, original, {
    fd_write: function (fd, iovs, iovsLen, nwritten) {
      if (fd === 1 || fd === 2) {
        try {
          const memory = instanceRef.exports.memory;
          const mem = new Uint8Array(memory.buffer);
          const view = new DataView(memory.buffer);
          const chunks = [];
          let total = 0;
          for (let i = 0; i < iovsLen; i++) {
            const ptr = view.getUint32(iovs + i * 8, true);
            const len = view.getUint32(iovs + i * 8 + 4, true);
            chunks.push(Buffer.from(mem.subarray(ptr, ptr + len)));
            total += len;
          }
          let bytes = total > 0 ? Buffer.concat(chunks) : Buffer.alloc(0);
          if (bytes.length > remaining) {
            bytes = bytes.subarray(0, Math.max(0, remaining));
            exceeded = true;
          }
          remaining -= bytes.length;
          if (bytes.length > 0)
            fs.writeSync(fd === 1 ? workerData.stdoutFd : workerData.stderrFd, bytes);
          view.setUint32(nwritten, bytes.length, true);
          return 0;
        } catch (error) {
          return 8;
        }
      }
      return original.fd_write(fd, iovs, iovsLen, nwritten);
    },
  });
  const module = new WebAssembly.Module(workerData.wasm);
  instanceRef = new WebAssembly.Instance(module, imports);
  let exitCode = 0;
  if (typeof instanceRef.exports._start === "function") {
    const code = wasi.start(instanceRef);
    exitCode = typeof code === "number" ? code : 0;
  } else if (typeof instanceRef.exports._initialize === "function") {
    wasi.initialize(instanceRef);
  } else {
    throw new Error("Module exports neither _start nor _initialize.");
  }
  parentPort.postMessage({ ok: true, exitCode: exitCode, exceeded: exceeded });
} catch (error) {
  parentPort.postMessage({
    ok: false,
    error: String((error && error.message) || error),
  });
}
`;

export async function runExtensionWasm(
  wasm: Uint8Array,
  options: ExtensionRunOptions = {},
): Promise<ExtensionRunResult> {
  const started = Date.now();
  const timeoutMs = Math.max(100, Math.min(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 30_000));
  const maxStdoutBytes = Math.max(
    256,
    Math.min(options.maxStdoutBytes ?? DEFAULT_MAX_STDOUT_BYTES, 1024 * 1024),
  );
  const failed = (error: string): ExtensionRunResult => ({
    status: "FAILED",
    exitCode: null,
    stdout: "",
    stdoutTruncated: false,
    durationMs: Date.now() - started,
    error,
  });

  if (wasm.byteLength === 0) return failed("Extension module is empty.");
  if (wasm.byteLength > MAX_EXTENSION_WASM_BYTES)
    return failed(
      `Extension module exceeds the ${MAX_EXTENSION_WASM_BYTES}-byte bound.`,
    );

  const directory = mkdtempSync(path.join(tmpdir(), "acos-ext-"));
  const stdinPath = path.join(directory, "stdin");
  const stdoutPath = path.join(directory, "stdout");
  const stderrPath = path.join(directory, "stderr");
  let stdinFd: number | null = null;
  let stdoutFd: number | null = null;
  let stderrFd: number | null = null;
  try {
    writeFileSync(stdinPath, "");
    stdinFd = openSync(stdinPath, "r");
    stdoutFd = openSync(stdoutPath, "w+");
    stderrFd = openSync(stderrPath, "w+");

    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: {
        wasm: Buffer.from(wasm),
        stdinFd,
        stdoutFd,
        stderrFd,
        maxStdoutBytes,
      },
      resourceLimits: { maxOldGenerationSizeMb: 128 },
      stdout: true,
      stderr: true,
    });
    // Drain the worker's real stdio: the module's output never reaches it, but
    // runtime diagnostics must not block the pipe.
    worker.stdout.resume();
    worker.stderr.resume();

    const outcome = await new Promise<{
      message?: { ok?: boolean; exitCode?: number; exceeded?: boolean; error?: string };
      error?: Error;
      timedOut?: boolean;
    }>((resolve) => {
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        resolve({ timedOut: true });
      }, timeoutMs);
      const settle = (value: Parameters<typeof resolve>[0]) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(value);
      };
      worker.once("message", (message) => settle({ message }));
      worker.once("error", (error) => settle({ error }));
      worker.once("exit", (code) =>
        settle({
          error: new Error(`Sandbox stopped (exit ${code}) before reporting.`),
        }),
      );
    });
    await worker.terminate();

    // Bound the captured stdout even if the in-sandbox clamp was bypassed.
    let stdout = "";
    let truncated = false;
    try {
      const buffer = readFileSync(stdoutPath);
      if (buffer.byteLength > maxStdoutBytes) {
        stdout = buffer.subarray(0, maxStdoutBytes).toString("utf8");
        truncated = true;
      } else {
        stdout = buffer.toString("utf8");
      }
      if (statSync(stderrPath).size > maxStdoutBytes) truncated = true;
    } catch {
      // No output produced.
    }

    const durationMs = Date.now() - started;
    if (outcome.timedOut)
      return {
        status: "TIMED_OUT",
        exitCode: null,
        stdout,
        stdoutTruncated: truncated,
        durationMs,
        error: `Extension exceeded its ${timeoutMs} ms budget and was terminated.`,
      };
    if (outcome.error)
      return {
        status: "FAILED",
        exitCode: null,
        stdout,
        stdoutTruncated: truncated,
        durationMs,
        error: outcome.error.message,
      };
    if (!outcome.message || outcome.message.ok !== true)
      return {
        status: "FAILED",
        exitCode: null,
        stdout,
        stdoutTruncated: truncated,
        durationMs,
        error: outcome.message?.error ?? "Sandbox produced no result.",
      };
    return {
      status: "COMPLETED",
      exitCode: outcome.message.exitCode ?? 0,
      stdout,
      stdoutTruncated: truncated || outcome.message.exceeded === true,
      durationMs,
    };
  } finally {
    for (const fd of [stdinFd, stdoutFd, stderrFd])
      if (fd !== null) {
        try {
          closeSync(fd);
        } catch {
          // Already closed.
        }
      }
    rmSync(directory, { recursive: true, force: true });
  }
}

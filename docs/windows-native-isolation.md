# Native Windows isolation adapter

ACOS separates **hardware discovery** from **AI engine support** and from
**process isolation**. The confinement primitive is chosen by a single
`IsolationAdapter` (`src/host/isolation.ts`); the engine never hard-codes
platform specifics. This document describes the Windows 11 adapter and how to
verify it on real hardware.

> **Status (honest).** The adapter, the native helper source and the verification
> harness are **implemented and unit-tested**. The TypeScript adapter's pure logic
> (limit mapping, environment construction, job-spec JSON) is exercised by the
> host test suite on Linux. The native helper (`acos-isolate.exe`) is **authored
> but not compiled** in this Linux development sandbox, and OS enforcement has
> **not** been observed on real Windows 11 hardware. Until `verify-windows.ps1`
> passes on a target machine, treat native isolation as **unverified**. The
> supported Windows path today remains WSL2, which reuses the Linux adapter
> unchanged.

## What the isolation layer guarantees

The engine process is treated as untrusted. Every platform adapter provides the
same contract:

1. **No host filesystem access** beyond an explicit, read-only engine/model
   directory and a private writable scratch directory.
2. **No network access** of any kind (the reference engine is offline).
3. **A cleared environment** so host secrets and credentials never reach the
   process.
4. **Bounded memory and CPU** with a wall-clock deadline, enforced by the OS and
   not merely requested of the process.
5. **Reliable termination** so cancellation, timeouts, administrator interlock
   and emergency isolation can always reclaim resources.
6. **No privilege escalation**: the engine cannot gain rights the host did not
   grant, and cannot observe or manipulate the administrator UI.

## Mechanisms per platform

| Requirement | Linux (implemented, tested) | macOS (implemented, unit-tested) | Windows 11 (implemented, unverified) |
| --- | --- | --- | --- |
| Filesystem confinement | Bubblewrap `--ro-bind` engine/model, tmpfs scratch | Seatbelt `sandbox-exec` deny-default profile | AppContainer SID, capability-free; ACL grants read to model dir, write to scratch |
| Network denial | `--unshare-net` | `(deny network*)` | AppContainer without `internetClient`/`privateNetworkClientServer`; WFP filter scoped to the AppContainer SID |
| Cleared environment | `--clearenv` + explicit `--setenv` | explicit `env` (`PATH` only) | `CreateProcessAsUserW` with an explicitly built environment block |
| Memory/CPU limits | `prlimit` `--as`/`--cpu`/`--stack` | `ulimit -t/-n/-f/-v` (address space best-effort) | Job Object `PROCESS_MEMORY`/`JOB_MEMORY`/`ACTIVE_PROCESS=1` + `JOBOBJECT_CPU_RATE_CONTROL_INFORMATION` |
| Wall-clock deadline | host timer + `--cpu` | host timer + `ulimit -t` | host-side timer; helper calls `TerminateJobObject` |
| Reliable termination | kill process group | kill process group | `TerminateJobObject` + `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` |
| Privilege containment | `--cap-drop ALL`, `--unshare-user` | deny-default profile | restricted token (low integrity, no `SeDebugPrivilege`) |

## Adapter interface (as implemented)

```ts
interface IsolationAdapter {
  readonly platform: "linux" | "win32" | "darwin";
  readonly mechanism: string;
  probe(): { available: boolean; reason: string | null; mechanism: string };
  wrap(input: {
    command: string[];
    readOnlyPaths: { source: string; target: string }[];
    writablePaths: string[];
    env: Record<string, string>;
    workdir?: string;
    limits: {
      memoryBytes: number;
      addressSpaceBytes?: number;
      timeoutMs: number;
      threads: number;
      logicalThreads?: number;
    };
  }): { argv: string[]; env: Record<string, string>; handle: IsolationHandle };
  terminate(handle: IsolationHandle, pid?: number): void;
}
```

The Linux adapter returns `prlimit … -- bwrap …` argv. The macOS adapter returns
`bash -c 'ulimit …; exec "$@"' … /usr/bin/sandbox-exec -p <profile> …`. The
Windows adapter returns `acos-isolate.exe --job-spec <json>`; the helper is the
only component that touches Windows security APIs. Because all three implement
the same interface, **hardware discovery, resource admission and the operation
pipeline are unchanged** — only the confinement primitive differs.

### The Windows job-spec contract

`WindowsIsolationAdapter.wrap()` serialises a `WindowsJobSpec` (version 1) to the
helper: `jobName`, `command`, `readOnlyPaths`, `writablePaths`, `workdir`, `env`,
`limits` (mapped by `windowsJobLimits()`), `appContainer: "capability-free"`,
`network: "deny"`, `integrity: "low"`. `windowsJobLimits()` is pure and
unit-tested: it maps the platform-neutral budget to `processMemoryBytes`,
`jobMemoryBytes`, a clamped `cpuRateHundredths` (1..10000), `activeProcessLimit
= 1`, and `wallClockMs`.

## Native helper (`src/windows/native/acos-isolate.cpp`)

A single-file C++17 helper. It parses `--job-spec`, then:

1. Creates a Job Object with `KILL_ON_JOB_CLOSE`, process/job memory caps, an
   active-process limit of 1, and a hard CPU rate cap.
2. Creates a capability-free AppContainer profile and grants ACLs for the
   declared paths.
3. Installs a WFP filter denying network for the AppContainer SID.
4. Builds a restricted low-integrity token (`CreateRestrictedToken`,
   `DISABLE_MAX_PRIVILEGE`).
5. Launches the engine with `CreateProcessAsUserW`
   (`CREATE_SUSPENDED | CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT`), assigns
   it to the job, resumes it, waits for the wall-clock deadline, then calls
   `TerminateJobObject`.

Build (on Windows, with the MSVC toolchain):

```powershell
cl /std:c++17 /EHsc /O2 acos-isolate.cpp `
   /link Advapi32.lib Userenv.lib Kernel32.lib Fwpuclnt.lib Ws2_32.lib
```

`Install-ACOS.ps1 -Runtime native` builds this automatically when `cl.exe` is on
PATH and installs the result to `%LOCALAPPDATA%\ACOS\acos-isolate.exe`. See
`src/windows/native/README.md`.

## Verification harness (`src/windows/verify-windows.ps1`)

A six-point OS-enforcement harness. Run it after installing:

```powershell
powershell -ExecutionPolicy Bypass -File src/windows/verify-windows.ps1 -Runtime native
```

It asserts, on the target machine:

1. The engine cannot read `%USERPROFILE%`.
2. The engine cannot open a socket.
3. A memory allocation beyond the job limit fails without destabilizing the host.
4. Killing the job reaps every descendant process.
5. The engine cannot read the administrator key.
6. The wall-clock deadline reclaims the job.

Exit code is non-zero if any check fails. `-Runtime wsl2` runs the equivalent
checks inside the Ubuntu-24.04 distribution.

## Why WSL2 remains the default today

WSL2 already provides a complete, tested Linux isolation stack with a mature
engine toolchain. The native adapter is implemented but its enforcement is
unproven until `verify-windows.ps1` passes on real hardware — including
AppContainer ACLs, WFP rules and Job Object accounting. Until that validation
exists, ACOS documents WSL2 as the supported Windows path and treats native
isolation as **available but unverified**. This is deliberate: the architecture
requires demonstrated enforcement, not an asserted one.

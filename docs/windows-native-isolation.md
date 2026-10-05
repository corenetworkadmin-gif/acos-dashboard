# Native Windows isolation adapter (design)

ACOS separates **hardware discovery** from **AI engine support** and from
**process isolation**. On Linux the isolation layer is Bubblewrap (`bwrap`) plus
`prlimit`; on Windows 11 the current supported path runs the engine inside
Ubuntu-24.04 on WSL2, which reuses the Linux adapter unchanged. This document
specifies the design for a **native** Windows isolation adapter so the same
guarantees can be provided without WSL2. It is a design, not an implemented
adapter: it is not exercised in the Linux development sandbox and must be
validated on real Windows 11 hardware before it is claimed as working.

## What the isolation layer must guarantee

The engine process is treated as untrusted. Whatever the platform, the adapter
must provide the same contract the Linux adapter provides today:

1. **No host filesystem access** beyond an explicit, read-only model directory
   and a private writable scratch directory.
2. **No network access** of any kind (the reference engine is offline).
3. **A cleared environment** so host secrets and credentials never reach the
   process.
4. **Bounded memory and CPU** with a wall-clock deadline, enforced by the OS and
   not merely requested of the process.
5. **Reliable termination** so cancellation, timeouts, administrator interlock
   and emergency isolation can always reclaim resources.
6. **No privilege escalation**: the engine cannot gain rights the host did not
   grant, and cannot observe or manipulate the administrator UI.

## Proposed Windows mechanisms

| Requirement | Windows mechanism |
| --- | --- |
| Filesystem confinement | **AppContainer** SID with a capability-free profile; grant read access only to the model directory and full access only to a per-job scratch folder. |
| Network denial | AppContainer without the `internetClient`/`privateNetworkClientServer` capabilities; additionally block via Windows Filtering Platform rules scoped to the job's AppContainer SID. |
| Cleared environment | `CreateProcessAsUser` with an explicitly constructed environment block (no inheritance). |
| Memory/CPU limits | **Job Object** with `JOB_OBJECT_LIMIT_PROCESS_MEMORY`, `JOB_OBJECT_LIMIT_JOB_MEMORY`, `JOB_OBJECT_LIMIT_ACTIVE_PROCESS = 1`, and CPU rate control via `JOBOBJECT_CPU_RATE_CONTROL_INFORMATION`. |
| Wall-clock deadline | Host-side timer that terminates the job; mirrors the Linux `prlimit` deadline. |
| Reliable termination | `TerminateJobObject` guarantees every descendant dies with the job, equivalent to a PID-namespace kill. |
| Privilege containment | Restricted token (`CreateRestrictedToken`) with low integrity level, no `SeDebugPrivilege`, and UI isolation so the process cannot touch the administrator window station/desktop. |

## Adapter interface

The adapter is a thin, platform-specific implementation of the interface the
engine already depends on. The engine asks the adapter to build the launch
command and limits; it never hard-codes platform specifics.

```ts
interface IsolationAdapter {
  // Platform this adapter serves.
  readonly platform: "linux" | "win32";
  // Whether the mechanism is available on this host right now.
  probe(): { available: boolean; reason: string | null };
  // Build the argv + environment that runs `command` under confinement.
  wrap(input: {
    command: string[];
    readOnlyPaths: string[];
    writablePaths: string[];
    limits: { memoryBytes: number; cpuSeconds: number; timeoutMs: number };
  }): { argv: string[]; env: Record<string, string> };
  // Terminate everything the adapter launched.
  terminate(handle: unknown): void;
}
```

The Linux adapter returns `bwrap` argv plus a `prlimit` wrapper. The Windows
adapter creates a Job Object and an AppContainer token, then launches the engine
with `CreateProcessAsUser`, returning a job handle that `terminate` closes with
`TerminateJobObject`. Because both implement the same interface, **hardware
discovery, resource admission and the operation pipeline are unchanged**: only
the confinement primitive differs.

## Why WSL2 remains the default today

WSL2 already provides a complete, tested Linux isolation stack (namespaces,
cgroups, Bubblewrap) with a mature engine toolchain. Shipping the native adapter
means re-implementing and re-validating every guarantee above on real hardware,
including AppContainer ACLs, WFP rules and Job Object accounting. Until that
validation exists, ACOS documents WSL2 as the supported Windows path and treats
the native adapter as future work. This is deliberate: the architecture requires
demonstrated enforcement, not an asserted one.

## Verification checklist for the native adapter (when implemented)

- Engine cannot read `%USERPROFILE%`, `%APPDATA%`, or any path outside the model
  and scratch directories.
- Engine cannot open a socket (attempts fail immediately).
- A memory allocation beyond the job limit fails without destabilizing the host.
- Killing the job removes every descendant process.
- The engine cannot read the administrator key or observe the admin window.
- Cancellation, timeout, interlock and emergency isolation all reclaim the job.

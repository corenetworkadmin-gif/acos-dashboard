# Governed providers and authority

> **Status (honest).** Implemented and unit/integration-tested in this repository
> (`src/host/providers.ts`, `src/host/extensions.ts`, wired through
> `src/host/runtime.ts`, `src/host/tools.ts`, `src/host/server.ts`). The network
> provider is real; its allowlist, scheme, credential and private-address
> refusals are enforced in tests, and its transport path is exercised by a live
> fetch against a local allowlisted server. This build also ships a real
> ffmpeg device bridge and a real OpenSSH remote transport, both strictly
> opt-in through host configuration (default-deny: a fresh install has neither).
> Extension manifests support signed installation and execution now runs in a
> WASI sandbox. Device capture on real hardware and a remote execution against
> a live endpoint are **not** verified here. This document makes no claim of
> "complete", "production-ready" or "secure".

ACOS does not treat a capability as a property of the model. Every capability is
supplied by an **explicitly attached provider** and is executed through the same
versioned operation pipeline — validation, policy authorization, admission,
execution, completion, and audit — as the rest of the host. Providers hold no
authority of their own; they are a second, provider-specific constraint on a
target that the runtime has already authorized.

## The four design rules

1. **Default-deny.** A provider starts unattached and unavailable. Nothing is
   attached by inference from a device name, a GPU, a hostname, or restored
   companion data. `defaultProviders()` returns the network provider plus
   microphone, camera and remote providers with no bridge/transport, so all four
   capabilities are denied on a fresh install.
2. **Attachment is an administrator action.** The companion/model can never
   attach a provider. It may only *request* a capability the administrator has
   already attached **and** enabled. Attaching changes a host fact (the provider
   becomes present); it grants no policy authority.
3. **Enabling is a separate grant.** `attachProvider` and `setCapability` are
   distinct commands. A capability is authorized only when it is attached,
   available, enabled, and within the current mode ceiling — the same
   `capabilityReason` gate used everywhere else.
4. **Results are bounded and secret-free** so they can be recorded in the audit
   journal.

## The `Provider` interface

```ts
interface Provider {
  readonly capability: string;      // e.g. "network.request"
  readonly name: string;
  readonly description: string;
  probe(): { available: boolean; reason: string | null };
  attach(config: unknown): void;    // throws if unavailable or invalid
  detach(): void;
  attached(): boolean;
  target(): string;                 // human-readable attached target
  authorizeTarget(target: string): string | null; // denial reason or null
  execute(context: ProviderContext): Promise<ProviderResult>;
}
```

`ProviderRegistry` holds the providers and exposes `get`, `isAttached`,
`isAvailable`, `target`, `attach`, `detach`, `authorizeTarget`, `execute` and
`summaries`. The runtime derives each provider-backed capability's `provider`,
`attached`, `available`, `target` and `availabilityReason` from the registry —
never from stored state — so a forged or restored record cannot attach anything.

## Network provider — `network.request`

Target-constrained outbound HTTP(S). The administrator attaches an **exact-host
allowlist** (no wildcards); the provider refuses:

- non-`http`/`https` schemes,
- URLs with embedded credentials,
- hosts not in the allowlist,
- loopback / link-local / private / unique-local addresses (unless the
  administrator explicitly opts in with `allowPrivate` for a lab deployment),
- responses larger than the configured cap (default 256 KiB, max 8 MiB).

At execution time the provider re-resolves the hostname and refuses the request
if it resolves to a private address — a **DNS-rebinding** defence that the
name-based allowlist check alone would miss. Requests use `redirect: "manual"`
so a redirect cannot escape the allowlist, and a bounded timeout aborts the
request.

## Device providers — `device.microphone` / `device.camera`

The host never captures audio or video itself. A `DeviceBridge` is an explicit,
separately-installed component. Without one, `probe()` reports unavailable and
`attach()` throws, so the capability cannot be enabled. With a bridge, the
provider captures through it and only for its own device (`authorizeTarget`
requires the target to match the device).

This build **ships one real bridge**: `CommandDeviceBridge`
(`src/host/providers/device-bridge.ts`), which drives an installed ffmpeg with
a bounded, abortable capture (audio: `-t` seconds of 16 kHz mono WAV; camera: a
single frame), keeps the output in a private temp directory that is always
removed, and returns only a bounded, secret-free summary. It is *opt-in*: the
host constructs it only when `ACOS_DEVICE_BRIDGE=ffmpeg` is set (with optional
`ACOS_FFMPEG_PATH`, `ACOS_DEVICE_MIC`, `ACOS_DEVICE_CAM`), so a fresh install
still has no bridge at all. Its `probe()` reports honestly whether the capture
tool exists and a device is configured — on Windows and macOS an explicit
device name is required; Linux defaults to `pulse` `default` / `v4l2`
`/dev/video0`. Capture on real hardware is not verified in this repository's
test environment (no capture tool or device is present there); the command
construction, success, failure and cleanup paths are covered by
`src/host/device-bridge.test.ts` with an injected runner.

## Remote provider — `remote.execute`

Remote execution is an independently-authorized capability with its own
`RemoteTransport` component. Without a transport the capability stays
unavailable. With one, the administrator attaches a specific endpoint and
`authorizeTarget` requires the requested target to match it exactly.

This build **ships one real transport**: `SshRemoteTransport`
(`src/host/providers/remote-transport.ts`), built on the OpenSSH client. It is
*opt-in*: the host constructs it only when `ACOS_REMOTE_TRANSPORT=ssh` is set.
It validates the endpoint as a plain `user@host` (option-like, spaced, or
metacharacter targets are refused *before* any process is spawned), passes
`BatchMode=yes` with a bounded `ConnectTimeout`, never involves a shell,
clamps output to 64 KiB, and kills the process on timeout or cancellation. A
real connection to a live endpoint is **not** exercised in this repository's
tests (no endpoint is available there); argument construction, output capping,
timeouts, refusals and the honest presence probe are covered in
`src/host/remote-transport.test.ts`, including a real probe of this host's
OpenSSH client.

## Extension lifecycle — `src/host/extensions.ts`

An extension is **data**: a strict manifest describing what it would *like* to
use. Installing is inert:

- `install()` validates the manifest, records it, and returns an explicit
  `ExtensionInstallReport` whose `grants` list is always empty.
- Requested capability ids are recorded as facts (`known`, `enabled`,
  `attached`) at install time. Unknown requests are marked `known: false` and
  grant nothing.
- `detectEscalation(before, after)` is a structural proof that no capability was
  enabled and no provider was attached by the install. The runtime calls it and
  treats any escalation as a fatal integrity error.

Enabling a requested capability remains a separate administrator action through
the ordinary policy path, and still requires an attached provider.

### Isolated execution — `runExtension` + `src/host/extension-sandbox.ts`

Installing is inert, and *running* an extension grants nothing either. The
`runExtension` command (administrator-only) executes the installed extension's
WASM module under `wasi_snapshot_preview1` inside a dedicated worker thread:

- no filesystem preopens, an empty environment, fixed arguments — the module
  can only reach two capture file descriptors inside a private temp directory;
- stdout/stderr are clamped *inside* the sandbox by a wrapping `fd_write`, so
  output is bounded (default 64 KiB) before it reaches the disk;
- a hard wall-clock timeout (default 5 s, max 30 s) terminates the worker from
  outside — a module that never returns is stopped (`TIMED_OUT`);
- a 128 MiB heap resource limit applies to the worker itself;
- the module payload is bounded (8 MiB) and must belong to an already-installed
  extension.

The runtime compares capability facts before and after execution and treats any
change as a fatal integrity error (the same `detectEscalation` proof used for
installation), then audits the run with an explicit `Grants: none` statement.
Covered by `src/host/extension-sandbox.test.ts` and
`src/host/extension-execution.test.ts` (no-op run, stdout capture, output
clamp, runaway termination, admin gate, install gate, non-escalation).

## Commands

| Command | Authority | Effect |
| --- | --- | --- |
| `attachProvider` | admin, idle | Attaches a provider with a config; grants no policy authority |
| `detachProvider` | admin, idle | Detaches a provider and disables any capability that depended on it |
| `probeProviders` | admin session | Returns registry summaries; changes nothing |
| `installExtension` | admin | Records a manifest; grants nothing; returns the report |
| `removeExtension` | admin | Removes an installed extension |
| `runExtension` | admin | Runs an installed extension in the WASI sandbox; grants nothing; audited |

## Verification scope

- **Tested here:** default-deny for all four capabilities; attach ≠ enable;
  detach revokes the dependent grant; the network allowlist, scheme, credential
  and private-address refusals enforced *during admission*; a successful
  provider-backed execution flowing `REQUESTED → … → COMPLETED` and returning the
  provider result; **a live outbound fetch through the real transport path**
  against a local allowlisted HTTP server (size cap and redirect handling
  included), with the same path failing closed without the `allowPrivate`
  opt-in; device and remote execution through injected bridge/transport
  doubles; the real ffmpeg bridge and OpenSSH transport components (argument
  construction, bounds, timeouts, probes) through injected runners;
  extension install leaving every capability fact unchanged; extension
  execution in the WASI sandbox (completion, stdout clamp, timeout kill,
  admin/install gates, non-escalation); unknown capabilities and unknown
  providers failing closed. See `src/host/providers.test.ts`,
  `src/host/network-provider.live.integration.test.ts`,
  `src/host/extensions.test.ts`, `src/host/governed-providers.test.ts`,
  `src/host/device-bridge.test.ts`, `src/host/remote-transport.test.ts`,
  `src/host/extension-sandbox.test.ts` and
  `src/host/extension-execution.test.ts`.
- **Not verified here:** a live outbound fetch against a *public* allowlisted
  host (only the local-server transport path runs live), a capture on real
  microphone/camera hardware (no capture tool or device in this environment),
  a real remote execution against a live SSH endpoint, and cross-platform
  behaviour of the WASI sandbox beyond this host. These remain future work and
  are listed in [remaining work](REMAINING-WORK.md).

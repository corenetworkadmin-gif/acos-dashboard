# Governed providers and authority

> **Status (honest).** Implemented and unit/integration-tested in this repository
> (`src/host/providers.ts`, `src/host/extensions.ts`, wired through
> `src/host/runtime.ts`, `src/host/tools.ts`, `src/host/server.ts`). The network
> provider is real; its allowlist, scheme, credential and private-address
> refusals are enforced in tests. Device and remote providers ship as contracts
> with **no bridge/transport**, so they remain unavailable until a component is
> explicitly supplied — that is the intended default, not a missing feature.
> This document makes no claim of "complete", "production-ready" or "secure".

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

## Remote provider — `remote.execute`

Remote execution is an independently-authorized capability with its own
`RemoteTransport` component. Without a transport the capability stays
unavailable. With one, the administrator attaches a specific endpoint and
`authorizeTarget` requires the requested target to match it exactly.

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

## Commands

| Command | Authority | Effect |
| --- | --- | --- |
| `attachProvider` | admin, idle | Attaches a provider with a config; grants no policy authority |
| `detachProvider` | admin, idle | Detaches a provider and disables any capability that depended on it |
| `probeProviders` | admin session | Returns registry summaries; changes nothing |
| `installExtension` | admin | Records a manifest; grants nothing; returns the report |
| `removeExtension` | admin | Removes an installed extension |

## Verification scope

- **Tested here:** default-deny for all four capabilities; attach ≠ enable;
  detach revokes the dependent grant; the network allowlist, scheme, credential
  and private-address refusals enforced *during admission*; a successful
  provider-backed execution flowing `REQUESTED → … → COMPLETED` and returning the
  provider result; device and remote execution through injected bridge/transport
  doubles; extension install leaving every capability fact unchanged; unknown
  capabilities and unknown providers failing closed. See
  `src/host/providers.test.ts`, `src/host/extensions.test.ts` and
  `src/host/governed-providers.test.ts`.
- **Not verified here:** a live outbound fetch against a real allowlisted host
  (the network provider's *transport* path is real but is exercised through
  refusal and a deterministic double), a real microphone/camera bridge, a real
  remote transport, and signed/isolated (WASI-or-equivalent) extension
  execution. These remain future work and are listed in
  [remaining work](REMAINING-WORK.md).

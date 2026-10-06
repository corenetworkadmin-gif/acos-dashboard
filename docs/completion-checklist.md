# ACOS completion checklist — delivered status

Owner target: finish the program, 5 October 2026 (UTC). See `FINISH-THE-PROJECT.md`.

This document replaces the handoff's *aspirational* checklist with an **evidence-based** status
for every release gate and every architecture section (1–89). Status is set only where code and
observed tests exist. Nothing here is a claim of "complete", "production-ready" or "secure".

## Owner decision — 2026-10-06

The owner explicitly selected **desktop app** as the delivery scope and confirmed P1 and P3
delivered. P2, P4 and P5 remain open. Standalone-OS delivery is outside this scope. This
decision does not attest to Windows/macOS verification or approve the WSL2 runtime choice.

## Status legend

| Status | Meaning |
| --- | --- |
| **Verified** | Implemented and covered by passing automated tests **in this Linux sandbox** (evidence cited). |
| **Implemented (unverified-here)** | Implemented in source; correctness depends on a target platform (Windows/GPU/macOS) this sandbox cannot exercise. |
| **Partial** | A real subset works and is tested; named gaps remain. |
| **Design-only** | A written design exists; no working implementation. |
| **Decided** | Explicit owner decision recorded with its date. |
| **Blocked** | Requires an external resource or a decision (runtime choice, certificates, GitHub auth). |
| **Deferred (roadmap)** | Explicitly outside the desktop-app product scope; would require the owner's scope decision. |

## Baseline evidence (this sandbox)

- Toolchain: Node **24.14.1**, pnpm **10.34.5**, bubblewrap, `prlimit`, gcc, Python 3.
- `pnpm typecheck` — clean.
- `pnpm test` — **136 / 136 pass, 0 fail**.
- `pnpm test:launch` — **2 / 2 pass** (built UI + API proxy + shutdown).
- `pnpm lint` — **0 errors**, 6 pre-existing Fast Refresh warnings.
- `pnpm build` — succeeds.
- `bash -n` on every `src/host/*.sh` — clean.

## Release gates

| Gate | Status | Evidence / blocker |
| --- | --- | --- |
| Integrate packaged source with current GitHub work, preserving user changes | **Verified** | Delivered via PR #2, squash-merged to `main` (commit `302002d`). Upstream `main` history preserved (branch rebased onto `894677d`). |
| Resolve standalone-OS vs desktop-app scope conflict with the owner | **Decided** | Owner explicitly selected **desktop app** on 2026-10-06. Standalone-OS delivery is outside the agreed scope. |
| Working Windows 11 installer + desktop lifecycle, guided first run, no manual developer setup | **Implemented (unverified-here)** | `src/windows/Install-ACOS.ps1` (Win11 build check, WSL2 + Ubuntu-24.04, repo clone, shortcuts, `Start-ACOS.cmd`), `Uninstall-ACOS.ps1`. Authored for Windows; cannot be executed in a Linux sandbox. |
| Verify native Windows runtime authority/isolation, or owner-approved managed guest runtime | **Blocked / Partial** | Native isolation adapter + helper source + six-point verifier are **implemented and unit-tested** (`isolation.ts`, `isolation.test.ts`, `docs/windows-native-isolation.md`); the native helper is authored-not-compiled here and unverified on real Windows 11 hardware. The shipped path is a managed WSL2 guest runtime; owner agreement required. |
| Verify install, launch, model setup, offline streaming chat, durable Home, cancellation, restart, upgrade/rollback, uninstall/data handling | **Partial** | Linux: installer + launch + upgrade + uninstall/data verified by `packaging.test.ts` (5 tests) and `launch.integration.ts` (2). Streaming/cancel/Home/restart verified by `runtime.test.ts`. Windows/macOS unverified-here. |
| Hardware discovery + compatible engine/model/resource selection; test CPU-only, accelerators, memory pressure, architectures | **Partial** | `hardware.ts` + `hardware.test.ts` (6) cover synthetic CPU-only/ARM64/multi-accelerator/unknown telemetry/cgroup/provider policy. Linux Vulkan execution is implemented but real-GPU verification is outstanding (`accelerator.ts`, `engine.ts`). |
| Reserve + enforce per-job resources; reconcile after cancellation/crash | **Partial** | `resources.ts`, `limits.ts`, `engine.test.ts`, `limits.test.ts` cover reservation, CPU-time accounting, address-space budget, 32-worker stress, release. Optional delegated cgroup v2 memory/pids containment is implemented (`containment.ts`); kernel enforcement validation is outstanding here. Unconfigured hosts retain the prior rlimit behavior. |
| Required providers + generalized tool calls with operation-bound authorization, target restrictions, final revalidation | **Partial** | Tool-call mediation is **Verified** (`tools.ts`, `tools.test.ts`, adversarial). Governed providers are **implemented** (`providers.ts`, `providers.test.ts`, `governed-providers.test.ts`): default-deny, attach≠enable, provider target constraint, final revalidation. Device/remote ship as contracts (no bridge/transport) and stay unavailable by default; the network transport path is exercised via refusals + a double, not a live fetch. |
| Capability ON allows, OFF denies, restart preserves policy, unattached enablement rejects through real API + UI | **Verified** | `capabilities.test.ts` (3) + `runtime.test.ts` + `SettingsPanel`/`CapabilityRegistry`. |
| Scheduler/event-triggered work, durable operations, idempotency, recovery through the same pipeline | **Verified** | `scheduler.ts`, `scheduler.test.ts` (6), `runtime.test.ts` recovery/idempotency. |
| Protected storage/credentials, independent admin control, emergency isolation, protected audit access | **Verified** | `crypto.ts`, `crypto.test.ts` (5), `runtime.test.ts` interlock/isolation/audit. |
| Authenticated updates, backup/restore, migration continuity, source retirement without restoring revoked authority | **Partial** | Signed update activation/rollback, encrypted companion recovery and destination-bound migration with source retirement are implemented and tested (`update-store.test.ts`, `recovery.test.ts`, `migration.test.ts`). Production trust and hardware anti-rollback remain open. |
| Isolated provider/extension lifecycle + provenance/integrity verification | **Partial** | Extension lifecycle **implemented** (`extensions.ts`, `extensions.test.ts`): strict manifests, inert install (`grants: []`), `detectEscalation` non-escalation proof. Pinned-key signed manifests are supported. WASI-or-equivalent isolated execution remains open. |
| Pass required adversarial tests + independent assessment; record findings | **Partial** | `adversarial.test.ts` (20 attack tests across 6 classes) passes. Independent third-party assessment is **not** performed. |
| Deliver + validate other platforms/builds in approved scope | **Partial** | Linux buildable + installer verified here. Windows/macOS authored, unverified-here. |
| Publish source + CI, obtain a passing actual GitHub Actions run, merge, publish release artifacts/checksums/signatures | **Partial** | **Published + merged + CI green.** PR #2 → `main` (commit `302002d`). Passing Actions runs: `37333831694` (main, dispatch), `37333406769` (main, push), `37333506397` (branch). Release artifacts/checksums/signatures still pending (no signing certificates). |
| Update user/install/testing docs, screenshots, repo description, support | **Partial** | Docs updated (`install-linux.md`, `windows.md`, `windows-native-isolation.md`, `testing.md`, `implementation-status.md`, this file, `FINAL-REPORT.md`, `REMAINING-WORK.md`). Screenshot and support guidance added (`screenshots/settings.png`, `../SUPPORT.md`); remote repository-description writes are blocked. |
| Demonstrate installed product to owner + answer hardware-independence audit question | **Partial** | Hardware-independence answer written in `FINAL-REPORT.md`; live demo launched and real CPU conversation plus recovery UI verified. |
| Close every applicable architecture row with evidence; list every blocked/missing item before claiming completion | **Verified** | This matrix + `REMAINING-WORK.md` list every open item honestly. |

## Architecture traceability: sections 1–89

Source: `reference/ACOS-Architecture-v0.8.md`. Status reflects code + tests observed in this
sandbox. "N/A (definitional)" rows are narrative/definitional and carry no runtime obligation.

| # | Section | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Executive Definition | N/A (definitional) | `README.md`; architecture reference. |
| 2 | Fundamental Boundary | Verified | Single-host daemon, single companion identity enforced in `runtime.ts`; `runtime.test.ts`. |
| 3 | Core Principles | Verified | Fail-closed policy in `runtime.ts`/`model.ts`; `runtime.test.ts` default-deny. |
| 4 | One Host / One Companion | Verified | One `CompanionHome`, one identity; `runtime.test.ts`. |
| 5 | Universal Operation Model | Verified | `Operation` type + lifecycle in `runtime.ts`; `runtime.test.ts`. |
| 6 | Universal Operation Identity | Verified | Operation IDs + canonical digests; `scheduler.ts` `idempotencyDigest`; `runtime.test.ts`. |
| 7 | Operation Lifecycle | Verified | REQUESTED→…→COMPLETED/DENIED/CANCELLED/FAILED/TIMEOUT; `runtime.test.ts`. |
| 8 | Canonical Operation Description | Verified | Canonical operation struct in `runtime.ts`; audit entries. |
| 9 | Execution Mediator | Verified | `performOperation()` mediates all work; `runtime.test.ts`. |
| 10 | Capability Registry | Verified | `capabilityDefinitions()` in `model.ts`; `capabilities.test.ts`. |
| 11 | Provider / Implementation Registry | Partial | Governed `ProviderRegistry` (`providers.ts`) with probe/attach/detach/execute + summaries; capabilities derive attach/availability from the registry. Device/remote `available:false` until a component is supplied. |
| 12 | Resource Reservation and Ownership | Verified | `resources.ts` reservation + `ComputePlan`; `engine.test.ts`. |
| 13 | Resource Reconciliation | Verified | Release on cancel/crash; adversarial resource-reconciliation tests. |
| 14 | Administrator Control Interlock | Verified | `openAdmin()` drain/cancel; `runtime.test.ts` + adversarial interlock. |
| 15 | Interlock Failure Handling | Verified | Fail-closed on interlock; `runtime.test.ts`. |
| 16 | Administrator Authentication | Verified | Host admin key + expiring HttpOnly session; `capabilities.test.ts`, `runtime.test.ts` HTTP auth/CSRF. |
| 17 | Credential and Key Management | Partial | `storage.key` 0600 + AES-256-GCM (`crypto.ts`); TOTP and optional Linux Secret Service implemented; hardware keystore remains open. |
| 18 | Absolute Financial Isolation | Verified | No financial capability exists; adversarial financial-isolation class (5 tests) + relocation regex rejection. |
| 19 | Device and Hardware Abstraction | Partial | `hardware.ts` discovery + `hardware.test.ts`; device providers unavailable. |
| 20 | Compute Engine Abstraction | Verified | Engine interface in `engine.ts`; replaceable engine; `engine.test.ts`. |
| 21 | Operating Modes | Verified | Safe/Intermediate/Advanced ceilings; `runtime.test.ts`. |
| 22 | Policy Engine | Verified | Fail-closed allowlist + target/action match; `runtime.test.ts`. |
| 23 | Target-Constrained Authorization | Verified | Target match in `beginOperation()`; `runtime.test.ts`. |
| 24 | Approval Binding | Verified | Operation-bound approvals; adversarial approval-replay class. |
| 25 | Final Authorization Revalidation | Verified | `finalCheck()` before commit; adversarial + `runtime.test.ts`. |
| 26 | Events and Notifications | Verified | Event bus + `emitEvent`; `scheduler.test.ts`. |
| 27 | Scheduling and Autonomous Operation | Verified | `scheduler.ts` + `SchedulerPanel.tsx`; `scheduler.test.ts` (6). |
| 28 | Networking | Partial | `network.request` capability defined but provider unavailable (fail closed). |
| 29 | Remote Execution | Partial | `remote.execute` capability defined but unavailable (fail closed). |
| 30 | Internal ACOS Operation Protocol | Verified | `<tool_call>` protocol in `tools.ts`; `tools.test.ts`; routed through pipeline. |
| 31 | Internal Service Boundaries | Verified | Server/host/UI separation; `server.ts`, `launch.ts`. |
| 32 | Extension Architecture | Partial | `extensions.ts`: strict manifest schema, inert install, non-escalation proof. Signed provenance + isolated execution remain. |
| 33 | Extension Discovery and Loading | Partial | Manifest validation + registry implemented; no signed discovery source or sandboxed loader. |
| 34 | Capability Registration | Verified | Registry in `model.ts`; `capabilities.test.ts`. |
| 35 | Operation Cancellation and Cleanup | Verified | `cancel()` + cleanup; `engine.test.ts`, `runtime.test.ts`. |
| 36 | Durable Operation State | Verified | SQLite durable ops; `scheduler.ts`; `runtime.test.ts`. |
| 37 | Idempotency and Duplicate Execution Protection | Verified | Digest + caller key; `runtime.test.ts`, `scheduler.test.ts`. |
| 38 | Persistence Boundary | Verified | `node:sqlite` boundary; `runtime.test.ts`. |
| 39 | Anti-Propagation Architecture | Verified | No replication capability; adversarial anti-propagation class (3 tests). |
| 40 | Recovery Journal | Verified | `scheduler.ts` `reconcileJournal()`; `runtime.test.ts` restart recovery. |
| 41 | Recovery and Snapshot Security | Partial | Journal + encrypted storage; no external signature anchoring. |
| 42 | Migration | Partial | `importCompanion()` + `inspectImport()`; signed destination-bound migration and persisted source retirement also implemented; trusted-host assumptions remain. |
| 43 | Transactional Updates | Partial | Signed channel, staged activation and rollback preserve external state; production signing and independent assessment remain open. |
| 44 | Health and Diagnostics | Verified | `doctor.ts`, `check:host`, engine health check; `engine.test.ts`. |
| 45 | Configuration Versioning | Verified | Explicit policy version in operations; `runtime.test.ts`. |
| 46 | Security State Model | Verified | Emergency/paused/adminOpen/engine state in `runtime.ts`; `runtime.test.ts`. |
| 47 | Audit System | Verified | Hash-linked append journal; `runtime.test.ts` audit integrity. |
| 48 | Audit Correlation | Verified | Correlation IDs across operations; `runtime.test.ts`. |
| 49 | Audit Access | Verified | Protected audit read; `runtime.test.ts`. |
| 50 | Resource and Credential Revocation | Verified | Revocation on isolation/stop; `runtime.test.ts`. |
| 51 | Defense in Depth | Verified | bwrap namespaces + `prlimit` + policy + audit; `runtime.test.ts` real isolation. |
| 52 | Supply-Chain Security | Partial | Pinned deps + verified model digest; no signed release artifacts. |
| 53 | Privacy | Verified | Local-only inference; no network capability attached; `hardware.test.ts`. |
| 54 | Trusted Computing Base | Partial | Documented in `docs/`; no formal TCB reduction proof. |
| 55 | Security-Critical Authority Rule | Verified | Authority only via pipeline; adversarial tests. |
| 56 | Prototype 0 Architecture | Verified | Host runtime + dashboard; baseline tests. |
| 57 | Prototype 0 Operation Demonstration | Verified | `runtime.test.ts` end-to-end operations. |
| 58 | Adversarial Companion Testing | Verified | `adversarial.test.ts` (20 tests, 6 classes). |
| 59 | Financial Isolation Test Class | Verified | Adversarial financial-isolation class (5 tests). |
| 60 | Implementation Priority | N/A (guidance) | Sequencing guidance; reflected in `todo.md`. |
| 61 | Security Invariants | Verified | Invariant assertions in `adversarial.test.ts`. |
| 62 | Prototype 0 Exit Criteria | Partial | Most criteria met; Windows/native-isolation criteria open. |
| 63 | Architectural Philosophy | N/A (definitional) | Architecture reference. |
| 64 | Companion-Driven Relocation | Verified | `importCompanion()`; `runtime.test.ts` relocation. |
| 65 | Relocation Protocol | Verified | Schema + SHA-256 + atomic replace; `runtime.test.ts`. |
| 66 | Relocation Package Minimum Contents | Verified | `RelocationPackage` type + validation; `runtime.test.ts`. |
| 67 | Capability Reconciliation After Relocation | Verified | Post-import reconciliation; `runtime.test.ts`. |
| 68 | Companion Runtime Minimum Substrate | Verified | Host runtime substrate; `runtime.test.ts`. |
| 69 | AI Engine Interface | Verified | Engine interface + streaming + tool-call adapter; `engine.test.ts`, `tools.test.ts`. |
| 70 | Companion I/O and Interaction Layer | Verified | SSE + `CompanionChat.tsx`; streaming tests. |
| 71 | Companion Home | Verified | Durable notes/messages; `runtime.test.ts`. |
| 72 | Relocation Verification | Verified | SHA-256 integrity; `runtime.test.ts`. |
| 73 | Relocation Continuity Status | Verified | Honest partial-continuity reporting; `runtime.test.ts`. |
| 74 | Runtime Completeness Requirement | Partial | Core path complete; governed providers + extension lifecycle implemented; shipped device/remote components, signing and isolation open. |
| 75 | Updated Prototype 0 Requirements | Verified | Streaming/tools/onboarding delivered. |
| 76 | Architectural Refinement | N/A (definitional) | Architecture reference. |
| 77 | Local AI Engine Runtime | Verified | llama.cpp CPU inference; `engine.test.ts`. |
| 78 | Tokenization and Runtime Compatibility | Partial | ChatML reference adapter; generalized tokenizer interface present, one concrete adapter. |
| 79 | Local Inference Limits Versus Provider Quotas | Verified | Local limits independent of quotas; `engine.test.ts`, `limits.test.ts`. |
| 80 | Local Context Management | Verified | Bounded context; `engine.test.ts` context bounds. |
| 81 | Local Model Storage | Verified | Verified GGUF + read-only mount; `engine.test.ts`. |
| 82 | Local AI Engine Resource Model | Verified | Reservation + admission; `engine.test.ts`. |
| 83 | Accelerator Abstraction | Partial | Inventory + compatibility logic (`hardware.test.ts`); Linux Vulkan path authored and admission-tested; real GPU verification remains open. |
| 84 | Local AI Engine Lifecycle | Verified | Load/health/stop/replace; `engine.test.ts`, `runtime.test.ts`. |
| 85 | Offline Companion Operation | Verified | Offline namespace, no network; `runtime.test.ts`. |
| 86 | Engine Independence and Replacement | Verified | Replaceable engine; Home independent of engine; `runtime.test.ts`. |
| 87 | Complete Local Operation Path | Verified | Streaming + tools + context + cancel; `runtime.test.ts`, `tools.test.ts`. |
| 88 | Updated Prototype 0 Local AI Requirements | Verified | Delivered in Phase-1 work. |
| 89 | Revised Architectural Definition | N/A (definitional) | Architecture reference. |

## Summary of open work

- **Blocked (external):** signing certificates, independent security assessment.
- **Decided:** desktop-app scope, confirmed by the owner on 2026-10-06.
- **Done:** source published, CI green, PR merged to `main`.
- **Implemented but unverified-here:** Windows installer/lifecycle, macOS path.
- **Partial (real gaps):** native Windows isolation (adapter + helper authored, unverified on real
  hardware), real accelerator/cgroup/keyring verification, shipped device/remote components + a live
  network fetch, isolated extension execution, production signed distribution, hardware keystore
  and anti-rollback protection, independently retained audit anchors.
- **Deferred (roadmap):** bootable standalone OS, third-party extension ecosystem.

See `REMAINING-WORK.md` for the ordered hand-off list and `FINAL-REPORT.md` for the honest
narrative and the hardware-independence answer.

# Architecture implementation status

Reference: supplied ACOS proposal, revision v0.8, sections 1–89.
Reviewed against the proposal and re-verified in this sandbox on 2026-10-05.

This document is the honest inventory of what works, what is partial, and what remains.
It does not claim "complete", "production-ready" or "secure". See
[completion checklist](completion-checklist.md) for the per-section matrix and
[final report](FINAL-REPORT.md) for the narrative.

## Baseline (this sandbox)

- `pnpm typecheck` clean · `pnpm test` **136/136 pass** · `pnpm test:launch` **2/2 pass** ·
  `pnpm lint` 0 errors (6 pre-existing Fast Refresh warnings) · `pnpm build` succeeds.

## Desktop update — 2026-10-06

[Current implementation and blockers](desktop-completion.md): model registry, Linux Vulkan
path (unverified hardware), delegated cgroups (unverified enforcement), encrypted recovery,
authenticated migration/retirement, signed checkpoints/updates, TOTP and optional desktop
keyring integration. The table below also records earlier delivery limits; this update
supersedes statements that these software paths do not exist.

## Implemented in this repository

| Area | Working implementation | Limit |
| --- | --- | --- |
| Companion / engine separation | One identity, persistent personality/memories, conversation archive, replaceable engine | Single host daemon; no bootable OS image |
| Operations | Explicit ID, identity, target, policy version, deterministic admission/execution/terminal states | CPU execution only; provider results bounded |
| Policy | Fail-closed allowlist, target/action matching, Safe/Intermediate/Advanced ceilings | — |
| Resources | Dynamic host discovery, model admission, exclusive inference slot, process limits, cleanup, CPU-time accounting, address-space budget | CPU execution only; logical reservations, not guaranteed physical RAM on every platform |
| Administrator | Independent host key, expiring HttpOnly session, interlock drain/cancel, emergency termination | Trusted host admin; TOTP implemented; hardware identity and remote-deployment hardening remain open |
| Persistence / audit | SQLite atomic state, hash-linked append journal, private permissions, startup corruption checks, interrupted-operation reconciliation | Signed checkpoint export and companion backup UI added; independent retention required |
| **Encrypted storage** | AES-256-GCM at rest for Home/messages/audit with host key `storage.key` (0600), plaintext migration, integrity verification (`verifyStorage`) | File default; optional Linux Secret Service; not hardware-backed |
| Local AI | Verified GGUF, llama.cpp CPU inference, real model/tokenizer health check, ChatML context, offline namespace, cancellation | Qwen/ChatML reference adapter; one concrete tokenizer |
| **Streaming inference** | Token-by-token stdout iterator through the same admission/authorization/audit pipeline; SSE endpoint; UI token streaming; mid-stream cancellation | CPU path only |
| **Tool-call mediation** | Declared tools, structured `<tool_call>` JSON parser, routed through the same operation pipeline; model text never executed; unknown/denied tools fail closed | Tool set is the declared reference set |
| **Governed providers** | Default-deny provider registry; attach (host fact) separated from enable (policy grant); provider `authorizeTarget` is a second constraint, never a grant; network provider with exact-host allowlist, scheme/credential/private-address refusal and DNS-rebinding re-check; device + remote providers as bridge/transport contracts (unavailable without a component) | Network transport path real but exercised via refusal + a deterministic double; no shipped device bridge or remote transport |
| **Extension lifecycle** | Strict manifest schema; install is inert (`grants: []`); `detectEscalation` structural non-escalation proof; unknown requests grant nothing | Pinned signed manifests supported; isolated execution remains open |
| **Guided onboarding** | First-run detection + step flow (hardware → engine → companion → first chat); `/setup` route; first-run banner | — |
| **Scheduler / event bus** | Durable scheduled + event-triggered tasks through the authority pipeline; idempotency keys; recovery-journal reconciliation | — |
| Home | Governed read/write, durable notes, messages retained independent of engine | Bounded note count/length |
| Relocation | JSON schema + SHA-256, explicit trust/replacement, dependency checks, capability reconciliation, atomic replacement, honest partial continuity | Authenticated migration added separately; legacy relocation remains reconstruction |
| Dashboard | Auth, responsive navigation, overview, chat, capabilities, engine controls, operation detail/filter/export, import, modes, pause/isolation, scheduler, protected-storage card | Requires the host daemon |
| **Adversarial tests** | 20 attack-oriented tests across financial isolation, anti-propagation, approval replay, recovery abuse, administrator interlock, resource reconciliation, credential isolation | Synthetic; not a third-party assessment |
| **Linux packaging** | Per-user installer + `.desktop` entry + icon; `--prefix/--build/--uninstall/--purge`; idempotent upgrade; refuses root | Linux only |
| **Windows packaging** | `Install-ACOS.ps1` (Win11 check, WSL2 + Ubuntu-24.04, clone, shortcuts, launcher) + `Uninstall-ACOS.ps1` | Authored for Windows; **unverified in this sandbox** |

## Remaining work and scope exclusions

1. Bootable standalone distribution, service supervision, host-installation exclusivity, secure
   boot/update integration, dedicated OS users, device mediation. *(Outside the desktop-app
   scope explicitly selected by the owner on 2026-10-06.)*
2. Reviewed threat model and independent security assessment; seccomp/cgroup hardening;
   hardware-backed administrative identity; signed audit anchoring.
3. Native Windows runtime authority/isolation adapter (AppContainer + Job Objects + WFP) — the
   adapter, native helper source and six-point verifier are implemented and unit-tested
   (`docs/windows-native-isolation.md`), but the native helper is authored-not-compiled here and the
   path is unverified on real Windows 11 hardware; the shipped Windows path remains a managed WSL2
   guest runtime.
4. Signed provider/extension registry and WASI-or-equivalent extension isolation. The governed
   provider registry, network provider, device/remote contracts and inert extension lifecycle are
   implemented (`docs/providers-and-authority.md`); what remains is manifest signing, isolated
   extension execution, and shipped device/remote components.
5. Hardware-backed anti-cloning and anti-rollback for migration; software retirement and
   destination-bound transfer are implemented under trusted-host assumptions.
6. GPU/NPU accelerator backends (CUDA/Metal/Vulkan/ROCm) with per-backend isolation and CPU
   fallback. Linux Vulkan path implemented; actual GPU execution remains unverified here.
7. Real-model validation of the new Llama 3 registry entry; additional model families remain future work.
8. Signed release artifacts, checksums and update trust; published CI run and merged commit.

Unavailable providers fail closed. The interface does not represent these remaining subsystems as
operational. Financial and propagation authority are not configurable capabilities.

Hardware contract and platform limits: [hardware discovery](hardware.md).
Open hand-off list: [remaining work](REMAINING-WORK.md).

## P2 registry completion — 2026-10-06

Backend descriptors, Linux accelerator admission, explicit CPU fallback reasons, five model-family
framing adapters and containment plans are implemented. See [local AI](local-ai.md) for configuration and limits.
No GPU execution, non-reference model inference or delegated-cgroup enforcement was verified here.
Metal/native Windows GPU execution remains disabled; CPU isolation remains required.

# ACOS — final delivery report

Date: 2026-10-05 (UTC) · Owner assignment: finish and deliver the ACOS program, Windows 11 first.
This report states plainly what was delivered, what was verified, what is blocked, and the
hardware-independence answer. It makes **no** claim of "complete", "production-ready" or "secure".

## 1. What was delivered

A working, installable-on-Linux desktop application (host runtime + dashboard) that advances the
ACOS desktop-app scope across every roadmap Phase-1 area, plus a full evidence trail. Concretely,
this delivery adds to the handoff baseline:

1. **Streaming inference** — token-by-token engine output, SSE endpoint, UI token streaming,
   mid-stream cancellation — all routed through the same admission/authorization/audit pipeline.
2. **Generalized tool-call mediation** — tools declared in the system prompt, structured
   `<tool_call>` JSON parsed and routed through the operation pipeline; model text is never
   executed; unknown/denied tools fail closed.
3. **Guided onboarding / first run** — hardware discovery → engine → companion → first chat.
4. **Scheduler / event bus** — durable scheduled and event-triggered tasks through the authority
   pipeline, with idempotency keys and recovery-journal reconciliation.
5. **Encrypted companion storage** — AES-256-GCM at rest for Home/messages/audit with a host key
   (`storage.key`, 0600), plaintext migration and integrity verification.
6. **Adversarial test suite** — 20 attack-oriented tests across financial isolation,
   anti-propagation, approval replay, recovery abuse, administrator interlock, resource
   reconciliation and credential isolation.
7. **Packaging** — a per-user Linux installer with a real desktop entry + icon (verified here) and
   a Windows PowerShell installer/uninstaller with a desktop lifecycle (authored, unverified here).

## 2. Verification evidence (this Linux sandbox)

| Check | Result |
| --- | --- |
| `pnpm typecheck` | clean |
| `pnpm test` | **87 / 87 pass, 0 fail** |
| `pnpm test:launch` | **2 / 2 pass** |
| `pnpm lint` | 0 errors (6 pre-existing Fast Refresh warnings) |
| `pnpm build` | succeeds |
| `bash -n src/host/*.sh` | clean |

Test classes: capabilities (3), runtime (26), engine (5), hardware (6), limits (2), crypto (5),
scheduler (6), tools (5), adversarial (20), packaging (5), launch (2).

## 3. What is NOT done (honest blockers and gaps)

- **Windows runtime is unverified.** The Windows installer is authored but cannot be executed in
  this Linux sandbox. There is **no native Windows isolation adapter** — only a written design
  (`docs/windows-native-isolation.md`). The shipped Windows path is a managed WSL2 guest runtime,
  which requires the owner's explicit agreement before it can be called the product runtime.
- **No GPU/NPU execution.** Hardware discovery and compatibility logic exist and are tested with
  synthetic inventories, but inference executes on CPU only. No CUDA/Metal/Vulkan/ROCm backend.
- **Providers governed, components not shipped.** Network, device and remote-execution capabilities
  now run through a governed provider registry (`src/host/providers.ts`): default-deny, attach
  separated from enable, and a provider-specific target constraint. The **network** provider is
  real (exact-host allowlist, scheme/credential/private-address refusal, DNS-rebinding re-check).
  The **device** (microphone/camera) and **remote** providers ship as bridge/transport *contracts*
  with no component, so they stay unavailable until one is supplied. That is deliberate
  (default-deny), and it means a live device capture and a live remote session are unfinished.
- **No signed updates, no source retirement.** Recovery-journal rollback exists; a signed update
  channel and authenticated migration-with-retirement do not.
- **Extension lifecycle implemented but not isolated.** Manifests are validated, install is inert
  (`grants: []`) and non-escalation is proven structurally (`src/host/extensions.ts`). What remains
  is manifest signing and WASI-or-equivalent isolated execution.
- **No independent security assessment.** The adversarial suite is self-authored.
- **No signing certificates or release artifacts.** (Source *is* published and CI *is* green —
  see §6.)
- **Scope conflict unresolved.** The architecture describes a standalone OS; the roadmap describes
  a desktop app. This delivery implements the **desktop-app** scope. The standalone-OS items
  (bootable distribution, secure boot, OS-level device mediation) require an explicit owner ruling.

## 4. Hardware-independence answer

The owner requires an explicit answer to:

> If this repository is downloaded and installed on a completely different compatible computer,
> does ACOS discover that computer's hardware and configure its available resources dynamically,
> or does any part of the implementation assume the developer's machine?

**Answer: ACOS discovers the host's hardware dynamically and configures resources from that
discovery. No developer-machine specifics are hard-coded into the runtime path.**

- CPU architecture, core/thread counts, usable RAM, effective system limits, destination storage
  and free capacity, and accelerator inventory are read at setup/startup from the actual host
  (`src/host/hardware.ts`, `src/host/resources.ts`, `src/host/limits.ts`).
- Hardware discovery and AI-engine support are **separate layers**: discovery reports what the host
  has; engine compatibility is decided against that report (`src/runtime/hardware.ts`,
  `hardware.test.ts`).
- Resource admission selects per operation using available memory, workload requirements and
  policy — not fixed constants.
- Synthetic inventories (CPU-only, ARM64, single/multiple accelerators, unknown telemetry, cgroup
  limits) drive the decision logic in tests, so the logic is exercised without the developer's
  machine (`hardware.test.ts`).
- Developer-machine values appear only as **test fixtures**, never as requirements.

**Caveats that must be stated honestly:** discovery is real, but *execution* is CPU-only, so a
machine whose only viable path is a GPU backend will fall back to CPU or report the accelerator as
unsupported. Windows/macOS discovery is unverified in this sandbox. The answer above concerns
**discovery and configuration**, which are genuinely hardware-agnostic; **accelerator execution** is
not yet.

## 5. Publication (GitHub)

- **Branch:** `finish-acos-phase1` → **PR #2** → squash-merged to `main` (commit `302002d`).
- **CI:** GitHub Actions `.github/workflows/ci.yml` on `ubuntu-24.04`, all steps green —
  namespace-isolation check, `pnpm install --frozen-lockfile`, `typecheck`, `lint`, `test`,
  `test:launch`, shell syntax.
  - Passing runs: [`37333831694`](https://github.com/corenetworkadmin-gif/acos-dashboard/actions/runs/37333831694) (main, dispatch),
    [`37333406769`](https://github.com/corenetworkadmin-gif/acos-dashboard/actions/runs/37333406769) (main, push),
    [`37333506397`](https://github.com/corenetworkadmin-gif/acos-dashboard/actions/runs/37333506397) (branch, dispatch).
- **Upstream history preserved:** the delivery branch was rebased onto `894677d` so it shares
  history with `main`; no upstream commits were rewritten.

## 6. Bottom line

The program is materially further along: it streams, mediates tool calls, onboards, schedules,
encrypts its Home, governs providers and extensions, and defends itself in adversarial tests —
with a real Linux installer, a prepared Windows installer and a macOS installer. It is **not
finished**: the native Windows runtime, GPU execution, shipped device/remote components, signed
updates, isolated extension execution, and an independent audit remain. `REMAINING-WORK.md` is the
ordered hand-off list for the next engineer.

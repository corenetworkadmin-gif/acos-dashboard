# ACOS Product Roadmap

**From prototype to shippable desktop app**

## Vision

ACOS is a **desktop application** that runs on Windows, macOS, and Linux. It hosts **one AI companion per computer** with local intelligence, persistent memory, explicit authority, and a clear security boundary. It is **not an operating system** — it runs inside the user's OS and creates its own protected environment.

The product promise: *your companion, on your terms. Local intelligence. Persistent memory. Explicit authority.*

## Where we are today (Phase 0 → Phase 1)

A working host runtime on Linux/WSL with:

- Real offline CPU inference (llama.cpp + Qwen/ChatML reference)
- Streaming responses with cancellation, through the same authority pipeline
- Structured tool-call mediation (model text is never executed)
- Persistent, **encrypted** Companion Home (durable memory, independent of the engine)
- Capability registry with fail-closed policy
- Administrator interlock and emergency isolation
- Hash-linked audit journal
- Durable scheduler / event bus with idempotency and recovery-journal reconciliation
- Guided first-run onboarding (hardware → engine → companion → first chat)
- Relocation import (bring an existing companion home)
- An adversarial test suite covering financial isolation, propagation, approval replay,
  recovery abuse, administrator interlock and resource reconciliation
- A per-user Linux installer with a real desktop entry, plus a Windows PowerShell installer

**Strong security posture.** Phase-1 items 4 and 6 are complete; items 1, 2 and 5 are partial.
Still not a finished consumer product: GPU execution, signed updates, an independent audit and a
verified native Windows runtime remain. See [remaining work](REMAINING-WORK.md).

---

## Phase 1 — Product foundation: make it installable and usable

**Goal:** a normal person can download, install, and use ACOS without a terminal.

| # | Deliverable | What it means | Status |
|---|-------------|---------------|-------|
| 1 | **Native desktop app** | Package the dashboard + host runtime as a real app with an installer for Windows, macOS, and Linux | **Partial** — Linux installer + desktop entry verified here; Windows PowerShell installer authored (unverified-here); macOS pending |
| 2 | **One-click setup with hardware detection** | The app detects GPU/CPU/RAM and configures itself; downloads the right engine build automatically | **Partial** — dynamic hardware discovery + engine download/verify + guided onboarding implemented; accelerator selection is inventory-only |
| 3 | **GPU / NPU execution** | CUDA (NVIDIA), Metal (Apple), Vulkan/ROCm (AMD), NPU where supported | **Not started** — discovery/compatibility logic exists; execution is CPU-only |
| 4 | **Streaming inference** | Tokens appear as they're generated instead of after a long wait | **Done** — streaming iterator + SSE + UI + cancellation, through the operation pipeline |
| 5 | **Generalized tool-call adapter** | The companion can call tools across model architectures, not just the Qwen/ChatML reference | **Partial** — structured `<tool_call>` mediation through the pipeline; one concrete model adapter |
| 6 | **Onboarding / first-run experience** | A guided setup flow, not a terminal | **Done** — first-run detection + hardware → engine → companion → first chat flow |
| 7 | **Auto-updates** | Signed, safe updates that preserve companion state | **Not started** — recovery-journal rollback exists; no signed update channel |

**Requires:** desktop packaging work, GPU engine builds, a streaming API, tool-call parsing, onboarding UI.

**Timeline:** the largest phase. This is where most of the engineering effort goes.

---

## Phase 2 — Trust & security: make people willing to install it

**Goal:** independent verification that the security boundary holds, and clear legal/data guarantees.

| # | Deliverable | What it means |
|---|-------------|---------------|
| 1 | **Independent security audit** | A third party reviews the boundary. You cannot credibly claim "secure" on your own word. |
| 2 | **Encrypted companion storage** | Home, memories, and audit protected at rest. |
| 3 | **Signed binaries and updates** | Users can verify the app and updates are genuine and untampered. |
| 4 | **Privacy policy and terms of service** | Legally required. States what stays local and what (if anything) leaves. |
| 5 | **Data-handling guarantees** | Clear, user-facing statements: local inference, no cloud quota, no financial access. |

**Requires:** a security review engagement, encryption work, code-signing certificates, legal review.

---

## Phase 3 — Business & support

**Goal:** a sustainable product people can pay for and get help with.

| # | Deliverable | What it means |
|---|-------------|---------------|
| 1 | **Pricing model** | One-time, subscription, or free tier. The "one companion, one host" model is naturally per-seat. |
| 2 | **Support channel** | A way for users to get help. |
| 3 | **User documentation** | Plain-language guides, not just architecture specs. |
| 4 | **Legal entity and licensing** | Who owns it, how it's licensed, liability. |

---

## Phase 4 — The vision (long-term)

**Goal:** the "one companion" ecosystem.

| # | Deliverable | What it means |
|---|-------------|---------------|
| 1 | **Relocation between hosts** | Already prototyped; polish into a real user flow. |
| 2 | **Migration with source retirement** | Move a companion between computers with the source properly retired. |
| 3 | **Extension ecosystem (WASI)** | Third-party capabilities with real isolation. |
| 4 | **Scheduler / autonomous tasks** | The companion acts on schedules and events through the same authorization pipeline. |

---

## What's realistic vs. moonshot

**Realistic (the path to market):**
- A polished, secure desktop app on Windows/macOS/Linux
- GPU/NPU execution, streaming, tool-calls
- Independent security audit
- A real business around it

**Moonshot (not the first product, maybe never):**
- A bootable standalone OS
- A full third-party extension ecosystem
- Cross-host companion migration at scale

The desktop app is the honest, achievable version of the vision.

---

## Definition of "market-ready"

A working checklist for when ACOS is shippable:

- [ ] Installs on Windows, macOS, and Linux with a real installer
- [ ] One-click setup with automatic hardware detection
- [ ] GPU/NPU execution where available; CPU fallback otherwise
- [ ] Streaming responses
- [ ] Tool-call support across model architectures
- [ ] Onboarding a non-technical user can complete unaided
- [ ] Independent security audit passed
- [ ] Encrypted storage and signed binaries/updates
- [ ] Privacy policy and terms of service published
- [ ] Pricing, support, and documentation in place

---

## Biggest risks (honest)

1. **Security certification is expensive and slow.** The audit is the long pole in Phase 2.
2. **GPU driver complexity across vendors.** CUDA/Metal/Vulkan each have their own quirks; NPU support is immature.
3. **The "one companion" premise is novel and unproven.** It's a different mental model from every AI assistant on the market — a strength, but also a risk.
4. **Solo effort.** Scope must be disciplined. Phase 1 alone is substantial; the moonshot items must wait.

---

## Recommended next step

Start **Phase 1, item 1** (native desktop packaging) — it's the unlock that makes everything else reachable by real users. In parallel, begin **Phase 1, items 2–5** (hardware-aware setup, GPU, streaming, tool-calls), which are the features that make the app feel like a real product.

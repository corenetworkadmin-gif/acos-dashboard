# Architecture implementation status

Reference: supplied ACOS proposal, revision v0.8, sections 1–89.

## Implemented in this repository

| Area                          | Working implementation                                                                                                                         | Limit                                                                                            |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Companion / engine separation | One current identity, persistent personality/memories, conversation archive, replaceable configured engine                                     | Single host daemon; no bootable OS image                                                         |
| Operations                    | Explicit ID, identity, target, policy version, deterministic admission/execution/terminal states                                               | Three executable capability contracts                                                            |
| Policy                        | Fail-closed allowlist, target/action matching, Safe/Intermediate/Advanced ceilings                                                             | Network/device/remote providers remain unavailable                                               |
| Resources                     | Dynamic host discovery, model resource admission, exclusive inference slot, process limits and cleanup                                                              | CPU execution only; partial accelerator inventory; logical reservations, not guaranteed physical RAM                          |
| Administrator                 | Independent host key, expiring HttpOnly session, interlock drain/cancel, emergency process termination                                         | Trusted host administrator; no hardware keystore, MFA, or remote deployment hardening            |
| Persistence / audit           | SQLite atomic state and hash-linked append journal, private permissions, startup corruption checks and interrupted-operation reconciliation    | No encrypted disk, external signature anchoring, or automated backup UI                          |
| Local AI                      | Verified GGUF, llama.cpp CPU inference, actual model/tokenizer health check, ChatML context, offline namespace, cancellation                   | Qwen/ChatML reference adapter; no streaming, GPU/NPU, generalized tokenizer or tool-call adapter |
| Home                          | Governed read/write, durable notes, retained messages independent of engine                                                                    | Bounded note count/length; retrieval selects recent authorized notes                             |
| Relocation                    | JSON schema + SHA-256, explicit trust/replacement, dependency checks, capability reconciliation, atomic replacement, honest partial continuity | No signed source identity, source deactivation, encrypted transfer, or model/extension transfer  |
| Dashboard                     | Auth, responsive navigation, overview, chat, capabilities, engine controls, operation detail/filter/export, import, modes, pause/isolation     | Requires the host daemon; static hosting alone cannot provide runtime functionality              |

## Still required for the full proposed ACOS operating system

1. Bootable standalone distribution, service supervision, host installation exclusivity, secure boot/update integration, dedicated OS users and device mediation.
2. Reviewed threat model and independent security assessment, seccomp/cgroup hardening, encrypted companion storage, hardware-backed administrative identity, signed audit anchoring.
3. Scheduler/event bus, event-triggered autonomous tasks, broader resource reconciliation, protected credential service.
4. Signed provider/extension registry, WASI or equivalent extension isolation, capability-specific device/network implementations and constrained remote execution.
5. Authenticated source-to-destination migration with source retirement, identity proofs, anti-replication enforcement, transactional snapshot/restore/update orchestration.
6. Generalized local model installation/compatibility registry, streaming inference, structured tool-call mediation, accelerator scheduling, model replacement compatibility reports.
7. Adversarial test suite (spec Phase 7, section 60): propagation, covert-channel, credential-isolation, financial-isolation, administrator-interlock, recovery-abuse, authorization-replay, and resource-reconciliation testing. The current tests cover policy denials, persistence, interlock/cancellation, relocation, restart reconciliation, audit corruption, HTTP authorization/CSRF, and real Linux isolation, but not the full adversarial class.
8. Financial isolation test class (spec section 59): dedicated tests attempting banking-credential discovery, browser-session inspection, transaction initiation, and the other prohibited paths. The boundary is enforced architecturally — no financial capability exists and relocation rejects financial/propagation declarations — but the dedicated test class is not yet written.

Unavailable providers fail closed. The interface does not represent these remaining subsystems as operational. Financial and propagation authority are not configurable capabilities.

Reviewed against the supplied v0.8 proposal (sections 1–89) on 2026-10-04. The implementation is published on `main`; the earlier task-branch setup instructions in `docs/windows.md` have been updated to match.

Hardware contract and platform limits: [hardware discovery](hardware.md).

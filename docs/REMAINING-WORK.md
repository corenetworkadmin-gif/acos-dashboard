# ACOS — remaining work (hand-off for the next engineer)

Date: 2026-10-05 (UTC). This is the ordered list of what still needs doing, written so the next
person can pick up without re-deriving context. Companion docs: `FINAL-REPORT.md`,
`completion-checklist.md`, `implementation-status.md`.

## How to run what exists

```bash
# unprivileged Linux account (WSL2 Ubuntu 24.04 is the documented Windows path)
# Node 24.14.1, pnpm 10.34.5, bubblewrap, util-linux (prlimit), gcc, python3
pnpm install --frozen-lockfile
pnpm typecheck && pnpm lint && pnpm test && pnpm test:launch
pnpm build && pnpm start          # then open the dashboard and unlock with the admin key
pnpm install:linux                # per-user launcher + desktop entry
```

## Priority 0 — unblock the release pipeline

1. **GitHub publish — DONE.** The delivery is published: PR #2 squash-merged to `main`
   (commit `302002d`), CI green (runs `37333831694`, `37333406769`, `37333506397`).
   Remaining sub-item: publish **release artifacts/checksums/signatures** once certificates exist.
2. **Owner scope decision.** Get an explicit ruling on standalone-OS vs desktop-app scope. The
   delivered program is the desktop app. Record the decision in `completion-checklist.md`.

## Priority 1 — Windows 11 first delivery

3. **Verify `src/windows/Install-ACOS.ps1` on a real Windows 11 machine** (build 22000+). Confirm
   WSL2 enable, Ubuntu-24.04 install, repo clone, `setup-wsl.sh`, Desktop/Start-Menu shortcuts and
   `Start-ACOS.cmd` all work end-to-end. Fix anything that fails. This is authored, not verified.
4. **Decide the Windows runtime model.** Either (a) implement the native isolation adapter
   described in `docs/windows-native-isolation.md` (AppContainer + Job Objects + WFP + restricted
   tokens) and verify OS enforcement, or (b) obtain the owner's explicit agreement to ship the
   managed WSL2 guest runtime and verify that path fully. A desktop window around an unrestricted
   process does not satisfy the OS-enforcement requirement.
5. **macOS packaging.** Not started. Build the equivalent installer + desktop lifecycle.

## Priority 2 — local AI completeness

6. **GPU/NPU backends.** Implement at least one accelerator backend (Vulkan is the most portable;
   CUDA for NVIDIA) behind the existing resource abstraction, with per-backend isolation and CPU
   fallback. Discovery/compatibility logic already exists (`hardware.ts`); only execution is missing.
   Test on real hardware for each claimed backend.
7. **Generalized tokenizer / model registry.** Extend beyond the single ChatML reference adapter:
   a compatibility registry that reports supported model families and tokenizer formats.
8. **Resource containment.** Move per-job physical-RAM/process/thread limits from best-effort to
   OS-enforced where the platform supports it (cgroups v2 on Linux, Job Objects on Windows).
   Reconcile after cancellation/crash and test 32-worker, memory-pressure and timeout paths.

## Priority 3 — providers and authority (delivered; hardening remains)

9. **Governed providers — delivered.** `network.request`, `device.microphone`, `device.camera`
   and `remote.execute` now run through a default-deny provider registry
   (`src/host/providers.ts`) inside the same versioned operation/admission/authorization/audit
   pipeline, with a provider-specific target constraint and final revalidation. See
   `docs/providers-and-authority.md`. **Remaining:** ship a real microphone/camera `DeviceBridge`
   and a real `RemoteTransport`, and verify the network transport path against a live allowlisted
   host (its refusals are tested; a live fetch is not).
10. **Extension lifecycle — delivered (inert).** Manifests are validated, install grants nothing
    (`grants: []`), and non-escalation is proven structurally (`src/host/extensions.ts`).
    **Remaining:** manifest signing and WASI-or-equivalent isolated execution.

## Priority 4 — lifecycle and trust

11. **Signed updates.** A signed update channel with integrity/authenticity checks, rollback and
    preservation of current authority. Recovery-journal rollback already exists.
12. **Migration with source retirement.** Authenticated source-to-destination migration, identity
    proofs, source deactivation, anti-replication enforcement, encrypted transfer.
13. **Backup/restore UI** and **external audit anchoring** (signature anchoring of the hash-linked
    journal).
14. **Hardware-backed admin identity** (TPM/Secure Enclave) and MFA; move `storage.key` to a
    keystore where available.

## Priority 5 — assurance and release

15. **Independent security assessment.** The adversarial suite is self-authored; a third party must
    review the boundary before any "secure" claim.
16. **Signing certificates** for binaries and updates; publish release artifacts with checksums.
17. **Screenshots, support channel, repository description**, and a live demonstration to the owner.

## Known-good invariants to preserve (do not regress)

- No financial capability exists and none can be granted; relocation rejects financial/propagation
  declarations.
- No replication/propagation capability exists.
- Model text is never executed; only parsed tool calls routed through the pipeline run.
- Fail-closed policy; default-deny; operation-bound approvals; final revalidation.
- The hash-linked audit journal and encrypted storage must stay intact.

## Current green baseline (do not break)

`pnpm typecheck` clean · `pnpm test` 124/124 · `pnpm test:launch` 2/2 · `pnpm lint` 0 errors ·
`pnpm build` succeeds.

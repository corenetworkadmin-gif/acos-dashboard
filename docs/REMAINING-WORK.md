# ACOS — remaining work (hand-off for the next engineer)

Updated: 2026-10-06 (UTC). This is the ordered list of what still needs doing, written so the next
person can pick up without re-deriving context. Companion docs: `FINAL-REPORT.md`,
`completion-checklist.md`, `implementation-status.md`.

Owner confirmed desktop-app scope on 2026-10-06 and confirmed P1 and P3 delivered.
P2, P4 and P5 remain open; target-platform verification and P3 hardening remain explicit
follow-ups. Standalone-OS delivery is outside the agreed scope.

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
2. **Owner scope decision — DONE (2026-10-06).** The owner explicitly selected a desktop app.
   Recorded in `completion-checklist.md`. This does not select or approve a Windows runtime model.

## Priority 1 — Windows 11 first delivery (delivered; platform verification remains)

3. **Windows installer and verifier — delivered.** `src/windows/Install-ACOS.ps1`,
   `Uninstall-ACOS.ps1` and `verify-windows.ps1` exist. End-to-end Windows 11
   verification remains unverified in this Linux sandbox; preserve that distinction.
4. **Windows isolation implementation — delivered.** The platform adapter, native helper
   source and verifier are present. Native compilation and OS-enforcement verification on
   Windows remain outstanding. The shipped WSL2 path still requires an explicit runtime
   choice; desktop-app scope alone does not approve it.
5. **macOS packaging — delivered.** `src/macos/install-macos.sh` and `docs/macos.md`
   provide the installer and desktop lifecycle. Target-platform verification remains open.

## Priority 2 — local AI completeness (implemented paths; hardware validation remains)

6. **Vulkan path implemented.** Explicit render-node isolation, isolated backend probe,
   measured VRAM admission and CPU fallback are present. Verify on actual hardware before
   claiming support; CUDA/NPU backends are not implemented.
7. **Model registry implemented.** Qwen/ChatML and Llama 3 GGUF framing are registered.
   Verify Llama models/tokenizers with real models; only reference Qwen CPU inference was exercised.
8. **Cgroup containment implemented.** Delegated Linux memory/pids limits, cancellation and
   orphan reconciliation are present. Real 32-worker, memory-pressure, timeout and crash tests
   in a delegated subtree remain blocked in this sandbox. Existing rlimit tests still pass.

## Priority 3 — providers and authority (delivered; hardening remains)

9. **Governed providers — delivered.** `network.request`, `device.microphone`, `device.camera`
   and `remote.execute` now run through a default-deny provider registry
   (`src/host/providers.ts`) inside the same versioned operation/admission/authorization/audit
   pipeline, with a provider-specific target constraint and final revalidation. See
   `docs/providers-and-authority.md`. **Shipped (2026-10-06):** a real ffmpeg `CommandDeviceBridge`
   and a real OpenSSH `SshRemoteTransport` (both opt-in via `ACOS_DEVICE_BRIDGE=ffmpeg` /
   `ACOS_REMOTE_TRANSPORT=ssh`; default-deny unchanged), and a live transport-path fetch test
   against a local allowlisted HTTP server (`network-provider.live.integration.test.ts`).
   **Remaining:** capture on real microphone/camera hardware and a remote execution against a
   live SSH endpoint (neither is possible in this repository's test environment).
10. **Extension lifecycle — delivered.** Manifests are validated (signed installation via the
    pinned Ed25519 key), install grants nothing (`grants: []`), and non-escalation is proven
    structurally (`src/host/extensions.ts`). **Shipped (2026-10-06):** isolated execution —
    the `runExtension` command runs an installed extension's WASM under
    `wasi_snapshot_preview1` in a bounded worker sandbox (no preopens/env, in-sandbox stdout
    clamp, hard timeout kill, escalation re-check, audited with `Grants: none`);
    see `src/host/extension-sandbox.ts`. **Remaining:** manifest-signing policy is
    host-configured (`ACOS_EXTENSION_PUBLIC_KEY_FILE`); a signed-registry distribution channel
    and cross-platform WASI verification remain open.

## Priority 4 — lifecycle and trust (software paths delivered; hardware trust remains)

11. **Signed updates implemented.** Pinned-key verification, bounded extraction, staged health
    checks, HTTPS channel downloads and rollback retaining the sequence high-water mark.
    Production keys, certificates and an owner-controlled distribution endpoint remain required.
12. **Authenticated migration implemented.** Destination-bound encrypted transfer, signed identities,
    source retirement before ticket release, restart persistence and single-use offers. This trusts
    host administrators; hardware anti-cloning/anti-rollback protection is still outstanding.
13. **Recovery UI and signed audit checkpoints implemented.** Companion backup/restore preserves
    current policy and the journal. Checkpoints require independent external retention; a managed
    anchoring service and full-installation disaster recovery are not supplied.
14. **TOTP and Linux Secret Service integration implemented.** TPM/Secure Enclave identity and
    hardware-protected storage remain open. Secret Service requires verification in a real session.

See [implementation update](desktop-completion.md), [lifecycle trust](lifecycle-trust.md),
[release procedures](desktop-releases.md) and [compute configuration](desktop-compute.md).

## Priority 5 — assurance and release

15. **Independent security assessment.** The adversarial suite is self-authored; a third party must
    review the boundary before any "secure" claim.
16. **Signing certificates** for binaries and updates; publish release artifacts with checksums.
17. **Screenshots, support guidance and live demo delivered.** See `screenshots/settings.png` and
    `../SUPPORT.md`. Repository-description writes are blocked by the managed delivery layer.

## Known-good invariants to preserve (do not regress)

- No financial capability exists and none can be granted; relocation rejects financial/propagation
  declarations.
- No replication/propagation capability exists.
- Model text is never executed; only parsed tool calls routed through the pipeline run.
- Fail-closed policy; default-deny; operation-bound approvals; final revalidation.
- The hash-linked audit journal and encrypted storage must stay intact.

## Current green baseline (do not break)

`pnpm typecheck` clean · `pnpm test` 136/136 · `pnpm test:launch` 2/2 · `pnpm lint` 0 errors ·
`pnpm build` succeeds. (Linux sandbox figures. On a Windows 11 host the platform-dependent
Linux-only tests fail — identically on unmodified `main`; see the re-verification note in
`implementation-status.md`.)

# Desktop implementation update — 2026-10-06

The owner selected desktop-app scope. P1 and P3 were already delivered. This update
adds the following P2/P4/P5 work, preserving their existing verification limitations.

## Added

- Registered Qwen/ChatML and Llama 3 prompt adapters, including mediated tool-result
  framing. Non-reference model configuration requires an explicit adapter; tokenizer
  loading stays inside the isolated llama.cpp process. The UI lists supported adapters.
- A Linux Vulkan path using one explicitly configured DRM render node, an isolated
  engine device probe and discovered free-VRAM admission. `auto` falls back to CPU
  before inference when the accelerator is unavailable. No CUDA/NPU execution claim.
- Optional delegated cgroup v2 memory, swap and task limits applied before the provider
  starts; descendants inherit the job, cancellation kills it, and stale jobs are reaped.
  Cleanup failure prevents further inference. `ACOS_REQUIRE_CGROUP=1` requires it.
- Encrypted companion backup/restore UI preserving current policy and the audit chain.
- Signed, encrypted destination-bound migration, atomic source retirement before ticket
  export, restart persistence, single-use destination offers and retry ticket recovery.
- Ed25519 audit checkpoint export and pinned-key verification tooling.
- Optional TOTP as a second unlock factor with persistent replay protection.
- Optional Linux Secret Service storage-key migration with read-back verification before
  removing the original file. Unavailable configured keystores fail closed.
- Pinned-key signed extension-manifest installation; manifests remain inert.
- Signed release manifests, bounded safe archive extraction, health-checked activation,
  HTTPS channel downloads and rollback with a persistent sequence high-water mark.
  Companion data is outside release directories and is not restored by application rollback.
- A self-contained Linux desktop release package (Node 24 required), checksums, support
  instructions and current UI screenshots.

See [lifecycle trust](lifecycle-trust.md), [desktop releases](desktop-releases.md), and
[compute configuration](desktop-compute.md) for operating procedures and limits.

## Still required before full completion

- Verify Vulkan on real supported hardware and cgroup enforcement in a delegated subtree,
  including 32-worker, memory-pressure, timeout and crash-recovery tests. This sandbox has
  no render device; its populated root cgroup refuses controller delegation with EBUSY.
- Verify non-reference model families with actual GGUF files. The pinned Qwen CPU model
  was exercised; pure adapter tests do not validate a Llama model or every tokenizer.
- Verify Secret Service in a real unlocked desktop session. TPM/Secure Enclave identities
  and hardware-protected monotonic anti-rollback remain unimplemented. Software migration
  assumes trusted host administrators and cannot prevent an administrator cloning disks.
- P1 target-platform verification remains outstanding here. The desktop scope decision
  does not independently approve WSL2 as the Windows product runtime.
- P3 hardening still includes real camera/microphone bridges, a remote transport, and
  isolated extension execution. Signed inert manifests do not supply these components.
- Owner-provisioned production signing keys/certificates and an HTTPS release endpoint;
  publish authenticated artifacts only after those exist. The generated archive is unsigned.
- Independent security assessment. This update's tests are authored within the project.
- Repository-description changes are blocked by this task's managed GitHub delivery layer.
  The proposed description is in the delivery notes; no remote metadata change is claimed.

No production-ready or independently assessed security claim is made.

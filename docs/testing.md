# Testing ACOS

## Test environment

Use an unprivileged Linux account (WSL2 Ubuntu 24.04 is the documented Windows path), Node **24.14.1**, pnpm **10.34.5**, and the frozen lockfile. Inference tests need working unprivileged user/PID/mount/network namespaces, Bubblewrap with `--size` support, and `prlimit` from util-linux. The test suite also needs a C compiler/pthreads for native worker stress and Python 3 for the existing namespace test. **Compiler and Python requirements are for development tests, not end-user inference.** No GPU, CUDA, Docker, hosted AI account, Ollama or LM Studio is needed.

Ubuntu test prerequisites:

```bash
sudo apt-get update
sudo apt-get install -y bubblewrap util-linux build-essential python3
pnpm install --frozen-lockfile
pnpm run check:host
```

On Amazon Linux, use `sudo dnf install bubblewrap util-linux gcc python3`. `check:host` prints discovery and can report unavailable inference without failing startup; **the test suite must actually pass its sandbox tests**. Do not skip isolation checks or globally disable host security to turn a failure into a pass. Ubuntu AppArmor restrictions may require an administrator-managed profile for Bubblewrap; CI scopes its exception to `/usr/bin/bwrap` on its ephemeral runner.

## Required checks

Run from the repository root:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm test:launch
for script in src/host/*.sh; do bash -n "$script"; done
```

`test:launch` builds the production dashboard before exercising the actual host/UI launcher. `pnpm build` may be used separately when only a build is needed. The suite uses temporary SQLite directories, ephemeral loopback ports, synthetic admin identities and explicit fixture engines. It does not touch your configured companion Home. Existing Fast Refresh warnings in bundled UI files and build deprecation/Browserslist warnings are documented; errors must still fail CI.

Current sandbox result: `pnpm test` **87/87 pass**, `pnpm test:launch` **2/2 pass**, typecheck clean, lint 0 errors, build green. `packaging.test.ts` installs and uninstalls the Linux launcher into a temporary prefix and does not touch your real desktop entries.

| Tests | Coverage |
| --- | --- |
| `capabilities.test.ts` | Authenticated HTTP grants ON/OFF, writes allowed/denied, persistence across restart, unattached-provider rejection, provider metadata reconciliation |
| `runtime.test.ts` | Default-deny policy, interlock, cancellation, emergency isolation, Home persistence, relocation, audit integrity, restart recovery, HTTP auth/CSRF, actual namespace/filesystem/network isolation, streaming, scheduler, encrypted storage |
| `engine.test.ts` | Read-only model mount, integrity changes, context bounds, real process timeout/cancellation and reservation cleanup, memory pressure |
| `hardware.test.ts` | Synthetic CPU-only/ARM64/multiple-accelerator inventories, unknown telemetry, cgroup limits, provider compatibility and policy |
| `limits.test.ts` | CPU-time scaling, virtual-memory headroom and actual isolated 32-worker allocation stress |
| `crypto.test.ts` | AES-256-GCM round-trip, ciphertext at rest, tamper detection, plaintext migration |
| `scheduler.test.ts` | Durable scheduled/event tasks, idempotency, recovery-journal reconciliation, denial when capability off |
| `tools.test.ts` | Structured tool-call parsing, allowed tool executes, denied tool rejected, malformed call rejected |
| `adversarial.test.ts` | 20 attack-oriented tests: financial isolation, anti-propagation, approval replay, recovery abuse, administrator interlock, resource reconciliation, credential isolation |
| `packaging.test.ts` | Linux installer installs launcher/entry/icon; idempotent upgrade; uninstall preserves data; purge deletes; refuses root/unknown options; launcher points at the real start script |
| `launch.integration.ts` | Built UI/API proxy, custom ports, occupied-port refusal, shutdown and released sockets |

A fixture reporting ARM64 or multiple GPUs tests decision logic. It does not prove that an ARM64 binary, Windows installation or GPU backend works. Current production execution is CPU-only.

## Real-model stress test

This additional check requires the pinned local model (~510 MB download) or a compatible configured engine/model. It is explicit and does not run during every normal test:

```bash
pnpm setup:engine  # optional x64 reference download; preserves existing .env.local
pnpm test:engine
```

The command reads `.env.local`. For custom models configure binary, model path, independently verified model digest and `ACOS_MODEL_RAM_MB`; optionally set `ACOS_ADDRESS_SPACE_MB` after measuring overhead. Never put admin keys in test reports.

The test requests 1, 8, 15 and 32 workers and verifies real thread creation, response generation and reservation release. On smaller hosts it deliberately oversubscribes CPU workers to probe thread/allocator overhead; RAM admission and isolation still use actual host values. It samples `/proc` from the host (the provider namespace has no `/proc`). Output is JSON with observed peaks, limits and responses. Samples can miss short peaks. This is a compatibility check, not a performance benchmark or proof that the largest possible context fits. See [resource-limit audit](resource-limits.md).

For focused checks:

```bash
node --experimental-strip-types --test src/host/capabilities.test.ts
node --experimental-strip-types --test src/host/limits.test.ts
```

## Browser acceptance checks

Use a separate disposable `ACOS_DATA_DIR` for manual testing so your own memories and grants are preserved. Build and start with `pnpm build` then `pnpm start`; unlock with that local directory's admin key.

1. Overview reports this installation's actual resources. Unknown accelerators stay unknown.
2. In Capabilities, open administrator controls. Enable Home write, confirm the saved-policy message, then close controls.
3. Save a synthetic note in Companion. It should succeed and appear once.
4. Disable Home write, close controls, and attempt another save. The server must reject it and preserve the existing notes. Restart the host and verify the OFF grant persists.
5. An unattached provider remains unchecked/disabled. A direct authenticated enable request must also fail; mode changes cannot attach providers.
6. Verify and load the model, close controls, then chat. Test cancel, administrator interlock and emergency isolation while generation is active. Confirm resources are released and Home remains intact.
7. Check desktop and narrow layouts, error messages, disconnected-host controls and keyboard navigation.

## CI

`.github/workflows/ci.yml` runs on pull requests, main/task-branch pushes and manual dispatch. It pins action commits and tool versions, grants read-only repository access, installs only test prerequisites, and runs the required checks above. A manual `real_model` input adds the optional reference download and stress matrix. Namespace failures are errors, not skipped tests. No provider credentials or repository secrets are required.

A locally passing workflow-equivalent command is not a GitHub Actions result. Check the actual run on GitHub after publishing. Native Windows/WSL, ARM64 execution, GPU inference and delegated cgroup containment require their own target environments before being claimed validated.

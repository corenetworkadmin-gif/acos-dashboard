# Hardware discovery and compute admission

ACOS discovers the installation's resources. Developer hardware is test data. There is no required CPU model, GPU, GPU count, drive letter, storage device, or network adapter.

## Current build boundary

The host uses Node 24+ on Linux, including WSL2. Its CPU provider accepts x64 and ARM64 with a matching engine binary. The optional checksum-pinned engine download currently supplies **x64 only**; that archive is not a requirement for starting ACOS. The WSL installer chooses an x64 or ARM64 Node archive from the detected architecture. Native Windows/macOS isolation and GPU/NPU execution providers are not implemented. These are build/provider limitations, not detected hardware requirements. ARM64 installer execution still needs validation on an ARM64 target.

No CUDA Toolkit, NVIDIA GPU, Python, Docker, Ollama, LM Studio, or GPU driver is installed or required. The optional CPU reference model is selected with `ACOS_INSTALL_REFERENCE_ENGINE=1 bash src/host/setup-wsl.sh`, or separately with `pnpm setup:engine`. Other models must fit the ChatML adapter and provide a compatible binary, independently verified model hash, and measured memory budget.

## Discovery

`pnpm run check:host` prints a JSON report. Startup collects the same report; Overview exposes it. Hardware is not persisted into the companion's identity or relocation package. Discovery reads:

- OS and CPU architecture, CPU model for display only, visible thread count, process CPU affinity, and the intersection of CPU feature flags.
- Available and total RAM, Node's available-process-memory bound, and cgroup v2 memory/CPU limits including ancestors. CPU fractions below one core use one thread under the existing host quota.
- Free space on the filesystem holding ACOS data. The optional engine installer checks its own selected filesystem before downloading.
- PCI display/processing accelerator devices and drivers; VRAM counters where exposed. If already installed, NVIDIA driver telemetry enriches memory and compute capability, including the WSL driver path. Missing telemetry remains **unknown**. Integrated/shared memory is not presented as dedicated VRAM.
- A real Bubblewrap namespace and prlimit probe. Failure disables inference while the host and Home remain available.

A VM/WSL installation sees resources exposed to its guest, not all physical Windows hardware. PCI inventory and optional driver telemetry are not exhaustive on every platform. Some integrated GPUs/NPUs are not exposed through these interfaces. Unknown or hidden devices are not assigned execution capability. cgroup v1 quota enumeration is not implemented; Node's process-memory bound and affinity are still used. A provider load verifies actual binary/model compatibility rather than inferring it from vendor names.

## Provider separation and selection

`hardware.ts` produces a provider-independent inventory. `resources.ts` matches a workload against explicit provider architectures/device IDs, policy, and current memory. It ranks compatible devices by configured preference and free memory; no device is permanently primary. A preference cannot override compatibility or memory checks. The selection contract has fixture coverage for multiple accelerators, CPU-only, integrated/shared-memory unknowns, ARM64, unavailable isolation and resource pressure.

Only the isolated **CPU** provider is registered in this build. GPU inventory does not grant device access: no GPU device nodes are mounted into inference. Selecting an unsupported `ACOS_COMPUTE_BACKEND` fails that engine operation. Adding an accelerator provider requires a real backend/device compatibility probe, resource accounting and an isolated device-access implementation before registering it. Current policy configuration exposes backend and maximum CPU threads; accelerator preferences are a provider contract, not a working GPU setting in this release.

## Admission and reservations

Before model verification and each inference, ACOS refreshes resources and checks the model's declared working-RAM estimate against currently available RAM, leaving 25% headroom. The pinned Qwen/ChatML model profile declares 2048 MiB. Other profiles require `ACOS_MODEL_RAM_MB` (legacy alias `ACOS_MODEL_MEMORY_MB`); a model's weight-file size alone does not prove its working-memory needs. Successful isolated model loading is still required. CPU threads derive from usable threads, leaving one where possible and capped at 32 by default policy; `ACOS_MAX_CPU_THREADS` can set a different ceiling.

ACOS owns one exclusive inference slot. Its current operation records an allocation, and `prlimit` enforces a separate virtual address-space ceiling with worker/allocator headroom. It does not enforce resident RAM. No ACOS UID-wide process-count cap is imposed. Completion, failure, cancellation and timeout release that allocation. This is **not a physical-memory guarantee** or a reservation against other host programs. Availability can change after admission; process failures remain contained. Dedicated cgroup physical-memory accounting and broader accelerator scheduling remain future work. Timeout, output, context and file limits are provider/security policy, not claims about installed hardware.

## Readiness audit

On a different compatible computer, ACOS discovers that computer's resources and derives CPU allocation dynamically. No developer machine model/count/path is used as a prerequisite. Current limitations are explicit: x64 reference archive, x64/ARM64 CPU adapter, Linux isolation, partial accelerator telemetry, no GPU/NPU execution, no native Windows provider. Full architecture readiness and cross-platform certification are not claimed.

Resource-limit semantics, current production gaps and measured thread tests: [resource-limit audit](resource-limits.md).

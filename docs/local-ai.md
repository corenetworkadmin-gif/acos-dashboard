# Local AI backends, models and containment

## Backend selection

`src/host/backends.ts` describes CPU, Vulkan, CUDA, ROCm and Metal. CPU executes on the
existing platform adapters. Linux Vulkan/CUDA/ROCm paths require explicit device nodes,
a compatible trusted llama.cpp build, successful isolated `--list-devices`, discovered
PCI identity and measured free VRAM. Metal and native Windows GPU execution remain
disabled until their device isolation is implemented and verified. NPU execution is open.
**No GPU execution was verified in this sandbox.** The installed reference engine is CPU-only.

Example configuration for Linux Vulkan (measure budgets for your actual model):

```dotenv
ACOS_COMPUTE_BACKEND=auto
ACOS_ACCELERATOR_BACKEND=vulkan
ACOS_ACCELERATOR_DEVICE_PATHS=/dev/dri/renderD128
ACOS_MODEL_VRAM_MB=1024
ACOS_MODEL_RAM_MB=2048
```

The legacy `ACOS_VULKAN_RENDER_NODE` setting remains supported. For CUDA, use
`ACOS_ACCELERATOR_BACKEND=cuda`, an explicit comma-separated list containing one
`/dev/nvidiaN`, `/dev/nvidiactl` and any required `/dev/nvidia-uvm` nodes, plus
`ACOS_ACCELERATOR_DEVICE_ID=pci:0000:01:00.0` matching discovery. ACOS checks the driver's
PCI-to-device-minor mapping at every launch. ROCm requires `/dev/kfd` and one DRM render
node. `ACOS_ENGINE_DEVICE` optionally pins the device name returned by the isolated probe.
Driver libraries must already be accessible inside the read-only sandbox; ACOS does not
install them. Exactly one matching backend device must appear in the isolated listing.

`ACOS_COMPUTE_BACKEND=cpu` disables offload. `auto` or a requested unavailable backend
falls back to CPU with `fallback`/`reason` in the compute plan. Both paths require fresh
host RAM admission and isolation. Declare enough **system RAM for CPU fallback**, not
only the offloaded working set. CPU receives `-ngl 0 --device none` and no GPU nodes.
Accelerators receive their descriptor's offload arguments only after verification.
An admission/probe failure can select CPU; a running inference failure is reported,
not silently replayed. Cancellation and failed containment cleanup never trigger fallback.

Device access expands the kernel-driver attack surface. VRAM admission is not a kernel
VRAM quota. Shared NVIDIA control/UVM nodes and ROCm kfd are driver interfaces, not proof
of exclusive physical-GPU tenancy. Real driver isolation and execution testing remain required.

## Model compatibility

`ACOS_MODEL_FAMILY` selects `qwen-chatml` (alias `chatml`), `llama3`, `mistral`, `gemma`
or `phi`. `ACOS_MODEL_ADAPTER` remains an alias setting; conflicting settings fail startup.
Resolution prefers explicit ID, then the pinned reference SHA-256, then conservative GGUF
filenames. Unknown/ambiguous names need an explicit family. A known reference hash cannot
be relabeled. Every model still requires its actual hash and measured RAM budget.

| Family | Framing/tokenizer declaration |
| --- | --- |
| Qwen2/2.5 | ChatML, GPT-2 BPE |
| Llama 3/3.1/3.2 | Llama 3 headers, BPE |
| Mistral 7B Instruct v0.1/v0.2 | `[INST]`, SentencePiece |
| Gemma/Gemma 2 IT | user/model turns, SentencePiece |
| Phi-3/3.5 Instruct | role/end markers, SentencePiece |

The host snapshot exposes the registry and compatibility report. These are framing
adapters; llama.cpp loads the GGUF tokenizer. A filename match is **not tokenizer or
execution verification**. Only the pinned Qwen CPU model was exercised here. Newer
families, Mistral v0.3 and multimodal models require their own adapters and validation.
System instructions are folded into the first user turn for Mistral/Gemma. Tool results
remain mediated text and grant no execution authority.

Templates follow the pinned [llama.cpp templates](https://github.com/ggml-org/llama.cpp/blob/b11392/src/llama-chat.cpp),
[Mistral v0.2 tokenizer](https://huggingface.co/mistralai/Mistral-7B-Instruct-v0.2/blob/main/tokenizer_config.json)
and [Phi-3 tokenizer](https://huggingface.co/microsoft/Phi-3-mini-4k-instruct/blob/main/tokenizer_config.json).

## Containment

Linux administrators can delegate an empty cgroup v2 subtree with `memory` and `pids`
enabled, then set `ACOS_CGROUP_ROOT`. `ACOS_REQUIRE_CGROUP=1` refuses jobs without it.
Every job applies memory.max, swap.max=0, oom.group=1 and pids.max=workers+16 before
membership and exec. Cancel/timeout kills descendants; cleanup failure blocks subsequent
jobs. Orphans whose host PID no longer exists are reaped on the next admission.
A configured invalid subtree fails closed. Without delegation, the plan honestly reports
rlimits: virtual address space/CPU time, without per-job physical RAM or task enforcement.

Windows uses the existing native Job Object helper for committed-memory/process limits;
worker threads remain an engine setting, not a kernel thread quota. Target verification
is outstanding. macOS retains its existing Seatbelt/rlimit implementation.

Run `pnpm test` for admission, 32-worker allocation, timeout/cancellation, framing and
refusal tests; `pnpm test:engine` exercises the real reference CPU model at 1/8/15/32
workers. Delegated-cgroup memory pressure/crash tests and GPU execution require target
facilities and are not represented by unit tests.

# Desktop model and resource configuration

## Models

See [local AI](local-ai.md) for the backend registry, all five model families and containment reporting.
Set `ACOS_MODEL_FAMILY` for the registered GGUF family.
The pinned reference digest defaults to Qwen/ChatML. Unknown adapters and unconfigured
non-reference models fail closed. Set the measured `ACOS_MODEL_RAM_MB` for each model.
The GGUF model still supplies its tokenizer to llama.cpp; the registry selects framing,
not a replacement tokenizer. Llama framing is unit-tested, not real-model verified here.

## Vulkan (Linux, target verification outstanding)

Use a trusted Vulkan-enabled llama.cpp build compatible with b11392's CLI. Install its
system Vulkan loader/ICD for the actual GPU. The bundled reference build is CPU-only.

```dotenv
ACOS_COMPUTE_BACKEND=auto
ACOS_VULKAN_RENDER_NODE=/dev/dri/renderD128
ACOS_MODEL_VRAM_MB=1024
```

The VRAM number is an example, not a universal recommendation: measure the selected
model's requirement. Only the configured render character device is exposed; network
isolation and read-only model/engine mounts remain. The host requires PCI telemetry,
known available VRAM and exactly one Vulkan engine device in an isolated probe.
Unknown/insufficient accelerator resources fall back to CPU, including an explicit `vulkan` request.
Host RAM and isolation admission must still succeed.
The mapping is checked again before launch. GPU-driver access expands the kernel attack
surface and does not impose a kernel VRAM quota; resource admission is not hard GPU
memory containment. Real driver/model execution must be verified before claiming support.

## Linux physical RAM and process/thread containment

An administrator must delegate a cgroup v2 subtree to the ACOS account with `memory`
and `pids` enabled in its `cgroup.subtree_control`. Keep the subtree free of unrelated
processes. Configure its absolute path using `ACOS_CGROUP_ROOT`; set
`ACOS_REQUIRE_CGROUP=1` to refuse inference without it. ACOS does not alter parent
controller policy or move the host itself.

Each job gets `memory.max`, `memory.swap.max=0`, `memory.oom.group=1` and `pids.max`
(worker count plus 16 wrapper/helper tasks). A fixed host launcher joins before starting
the provider. Timeout/cancel kills the job; cleanup reaps descendants. Rootless namespace
and existing address-space/CPU limits remain in force. Without configuration the prior
rlimit-only behavior remains and must not be described as physical-RAM containment.

The implementation follows the [kernel cgroup v2 interfaces](https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html).
This sandbox could not delegate its populated cgroup; real enforcement tests remain open.

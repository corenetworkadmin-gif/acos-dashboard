# Resource-limit audit

## Findings and changes

| Concern | Finding | Current behavior |
| --- | --- | --- |
| `--cpu=120` vs 120-second wall timeout | Valid. `RLIMIT_CPU` accounts process CPU time across its threads. Approximate early deadline is CPU budget divided by actual concurrent CPU consumption, not simply the requested worker count. Eight workers on a four-core/quota host do not consume eight CPU seconds per wall second. | Wall timeout remains 120 seconds. CPU allowance is `ceil(wallMilliseconds / 1000) * (workers + 1) + 1`, allowing a helper thread and accounting granularity. Both decode and batch worker counts are explicitly set. This is a backstop, not a CPU utilization quota or a process-tree CPU budget. |
| `--nproc=64` | Valid objection to using it as job containment. Linux counts real-UID processes/threads, with privilege and user-namespace accounting nuances. It does not mean “64 processes in this PID namespace.” A host UID can hit `EAGAIN`; moving the limit inside Bubblewrap does not establish a portable job boundary. | Removed the ACOS-imposed limit. Inherited host limits still apply. This release has **no per-job process/thread-count containment**. Namespace isolation and process-group cancellation are retained. |
| `--as=2GiB` | Valid risk, not a guarantee of failure on every model/host. `RLIMIT_AS` includes mmap, stacks and heap arenas. Physical RAM admission was incorrectly coupled to this virtual-memory ceiling. | Working RAM is separately admitted using `ACOS_MODEL_RAM_MB` (legacy `ACOS_MODEL_MEMORY_MB` remains an alias). Default address space is the larger of twice the RAM budget or RAM + 128 MiB arena allowance + `(workers + 4) * 8 MiB` stack allowance. Optional `ACOS_ADDRESS_SPACE_MB` must cover the minimum overhead. The reference model uses 2 GiB estimated working RAM and normally 4 GiB address space. |

The child gets an explicit 8 MiB stack limit and `MALLOC_ARENA_MAX=2` inside its otherwise cleared environment. The glibc setting reduces virtual arena proliferation; it neither limits total heap allocations nor applies to every allocator. Model-specific profiles still need measurement. Raising virtual address space does not claim that RAM is reserved or physically capped.

## Reproduction and evidence

`src/host/fixtures/thread-stress.c` is a synthetic test program, not runtime code. An eight-worker busy loop with a one-second aggregate CPU limit was killed after **0.31 wall seconds** on the development test host. The same 2.5-second workload with a 28-second CPU allowance completed. This shortened experiment demonstrates the accounting mismatch without waiting 120 seconds. It does not predict timing on another host.

The automated native test creates **32 actual workers**, allocates memory in each, and reads the real limits from inside the isolated process. The optional `pnpm test:engine` runs the real pinned Qwen model at 1, 8, 15 and 32 requested workers, samples the provider process from the host, and prints peak observed threads, virtual memory, RSS, elapsed time, and effective limits. The override is confined to this explicit stress test; production admission continues to use discovered CPU availability. Tests above the available core count are oversubscribed, not evidence of performance on a 32-core machine.

One successful 32-worker reference run observed 33 threads, about **1.27 GiB peak virtual memory** and **619 MiB peak RSS**. Short sampled peaks are diagnostic evidence, not a universal model envelope. Re-run with longer prompts, full contexts and the intended model/build before deployment. For comparison, the previous 2 GiB / nproc=64 / CPU=120 profile also completed the same short 32-worker model request in 1.7 seconds on this test host. The virtual-memory concern is a portability risk; it did not reproduce as a failure with this small model and prompt.

## Production boundary

The runtime is a prototype for a trusted administrator and configured local engine. Before claiming robust resource containment, implement and validate delegated **cgroup v2** jobs with `pids.max`, `memory.max`, appropriate swap/CPU controls, attachment before provider execution, whole-job termination, and cleanup after failures. A PID namespace alone does not replace those controls. This task's sandbox exposes cgroup v2 read-only, so no delegated-cgroup enforcement is claimed tested or implemented.

Current guarantees: namespace/filesystem/network isolation, model integrity verification, an exclusive ACOS inference slot, available-memory admission with headroom, a virtual-memory ceiling, bounded files/descriptors, a wall deadline and cancellation. Physical-memory availability can change after admission; unrelated desktop programs are not controlled by ACOS. Removing the misleading process limit is a compatibility fix, not production process containment.

## Sources

- [Linux getrlimit manual](https://man7.org/linux/man-pages/man2/getrlimit.2.html): `RLIMIT_CPU`, `RLIMIT_NPROC`, `RLIMIT_AS` and privilege exceptions.
- [Linux kernel cgroup v2 documentation](https://docs.kernel.org/admin-guide/cgroup-v2.html): job memory/process controllers and migration semantics.
- [GNU libc allocation tunables](https://www.gnu.org/software/libc/manual/2.42/html_node/Memory-Allocation-Tunables.html): arena configuration.

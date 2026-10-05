const MiB = 1024 ** 2;
export interface LimitConfig {
  // Estimated working RAM for admission, not a virtual address-space limit.
  memoryBytes: number;
  addressSpaceBytes?: number;
  timeoutMs: number;
}
export function executionLimits(config: LimitConfig, threads: number) {
  if (!Number.isSafeInteger(threads) || threads < 1)
    throw new Error("Execution threads must be a positive integer.");
  if (!Number.isSafeInteger(config.timeoutMs) || config.timeoutMs <= 0)
    throw new Error("Execution wall timeout must be a positive integer.");
  if (!Number.isSafeInteger(config.memoryBytes) || config.memoryBytes <= 0)
    throw new Error("Model working-memory budget must be a positive integer.");
  // Virtual mappings include model mmap, worker stacks and allocator arenas.
  // MALLOC_ARENA_MAX=2 bounds glibc's arena proliferation, not total heap size.
  const stackBytes = 8 * MiB;
  const minimumAddressSpace =
    config.memoryBytes + 128 * MiB + (threads + 4) * stackBytes;
  const addressSpaceBytes =
    config.addressSpaceBytes ??
    Math.max(2 * config.memoryBytes, minimumAddressSpace);
  if (
    !Number.isSafeInteger(addressSpaceBytes) ||
    addressSpaceBytes < minimumAddressSpace
  )
    throw new Error(
      "ACOS_ADDRESS_SPACE_MB is too small for the working-memory budget and worker overhead.",
    );
  // RLIMIT_CPU sums process CPU time across workers. Wall time remains the primary deadline.
  // Include the main/helper allowance and one-second kernel accounting granularity.
  const cpuSeconds = Math.ceil(config.timeoutMs / 1000) * (threads + 1) + 1;
  if (!Number.isSafeInteger(cpuSeconds))
    throw new Error("CPU budget is out of range.");
  return { addressSpaceBytes, cpuSeconds, stackBytes };
}

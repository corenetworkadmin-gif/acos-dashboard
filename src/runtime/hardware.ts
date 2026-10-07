// Serializable discovery contract; no engine or OS implementation dependencies.
export interface Accelerator {
  id: string;
  name: string;
  vendor: string;
  type: "gpu" | "accelerator";
  driver: string | null;
  memoryBytes: number | null;
  availableMemoryBytes: number | null;
  computeCapability: string | null;
}
export interface HardwareReport {
  discoveredAt: string;
  platform: string;
  architecture: string;
  environment: string;
  cpu: {
    model: string;
    logicalThreads: number;
    usableThreads: number;
    features: string[];
  };
  memory: { totalBytes: number; availableBytes: number };
  storage: { totalBytes: number; availableBytes: number } | null;
  accelerators: Accelerator[];
  isolation: { available: boolean; reason: string | null };
  limitations: string[];
}
export interface ComputePlan {
  fallback: boolean;
  reason: string | null;
  backend: string;
  deviceId: string;
  threads: number;
  memoryBytes: number;
  acceleratorMemoryBytes: number;
}

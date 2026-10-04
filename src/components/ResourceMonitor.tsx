import { useRuntime } from "@/runtime/store";
import { Widget } from "./Widget";
const bytes = (value: number | null) =>
  value === null ? "Unknown" : `${(value / 1024 ** 3).toFixed(2)} GiB`;
export default function ResourceMonitor() {
  const { host } = useRuntime();
  const hardware = host.hardware;
  return (
    <Widget
      title="Detected resources"
      description="Resources visible to this installation, checked at startup and inference admission."
    >
      {hardware ? (
        <div className="space-y-4 text-xs">
          <dl className="grid grid-cols-2 gap-3">
            <dt>System</dt>
            <dd>
              {hardware.platform} / {hardware.architecture}
            </dd>
            <dt>CPU threads</dt>
            <dd>
              {hardware.cpu.usableThreads} usable /{" "}
              {hardware.cpu.logicalThreads} visible
            </dd>
            <dt>System RAM</dt>
            <dd>{bytes(hardware.memory.totalBytes)}</dd>
            <dt>Available RAM</dt>
            <dd>{bytes(hardware.memory.availableBytes)}</dd>
            <dt>Home filesystem free</dt>
            <dd>{bytes(hardware.storage?.availableBytes ?? null)}</dd>
            <dt>Isolation</dt>
            <dd>
              {hardware.isolation.available
                ? "Available"
                : "Inference unavailable"}
            </dd>
            <dt>Inference allocation</dt>
            <dd>
              {host.memoryReservation ? bytes(host.memoryReservation) : "None"}
            </dd>
            <dt>Last compute plan</dt>
            <dd>
              {host.compute
                ? `${host.compute.backend} · ${host.compute.threads} threads`
                : "No model admitted"}
            </dd>
          </dl>
          <p className="break-words text-muted-foreground">
            {hardware.cpu.model}
          </p>
          <div className="border-t pt-3">
            <p className="mb-2 font-medium">
              Accelerators ({hardware.accelerators.length} detected)
            </p>
            {hardware.accelerators.length === 0 ? (
              <p>
                No accelerators exposed by this OS, or discovery unavailable.
                CPU inference can operate independently.
              </p>
            ) : (
              hardware.accelerators.map((device) => (
                <div key={device.id} className="mb-3 break-words">
                  <p>
                    {device.name} · {device.type}
                  </p>
                  <p className="text-muted-foreground">
                    {device.id} · memory {bytes(device.memoryBytes)} · available{" "}
                    {bytes(device.availableMemoryBytes)}
                  </p>
                  <p className="text-muted-foreground">
                    Compute capability: {device.computeCapability ?? "Unknown"}{" "}
                    · Execution provider unavailable
                  </p>
                </div>
              ))
            )}
          </div>
          <p>
            Supported engine adapter: CPU. GPU/NPU execution requires a
            compatible isolated provider.
          </p>
          {hardware.isolation.reason && <p>{hardware.isolation.reason}</p>}
          <p className="text-muted-foreground">
            {hardware.environment}. Resource availability can change. ACOS
            reserves one inference slot and enforces a process address-space
            limit; this is not an OS guarantee of physical RAM.
          </p>
          <details className="text-muted-foreground">
            <summary>Discovery details</summary>
            <p>Sample: {hardware.discoveredAt}</p>
            <p className="break-words">
              CPU features: {hardware.cpu.features.join(", ") || "Unknown"}
            </p>
            {hardware.limitations.map((item) => (
              <p key={item}>{item}</p>
            ))}
          </details>
        </div>
      ) : (
        <p>Discovery unavailable.</p>
      )}
    </Widget>
  );
}

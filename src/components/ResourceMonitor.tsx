import { Cpu, HardDrive, Layers } from "lucide-react";
import { useRuntime } from "@/runtime/store";
import { Progress } from "@/components/ui/progress";
import { Widget } from "./Widget";
export default function ResourceMonitor() {
  const state = useRuntime();
  const homeBytes = new TextEncoder().encode(
    JSON.stringify(state.companion),
  ).length;
  return (
    <Widget
      title="Resource allocation"
      description="Host reservations and durable companion state."
    >
      <div className="space-y-6">
        {[
          {
            name: "Inference slot",
            value: state.host.busy ? "1 / 1 reserved" : "0 / 1 reserved",
            percent: state.host.busy ? 100 : 0,
            icon: Cpu,
          },
          {
            name: "Process memory limit",
            value: state.host.memoryReservation
              ? "4 GB reserved"
              : "No active reservation",
            percent: state.host.memoryReservation ? 100 : 0,
            icon: Layers,
          },
          {
            name: "Companion Home",
            value: `${(homeBytes / 1024).toFixed(1)} KB · ${state.companion.memories.length} notes`,
            percent: state.companion.memories.length,
            icon: HardDrive,
          },
        ].map(({ name, value, percent, icon: Icon }) => (
          <div key={name}>
            <div className="mb-2.5 flex items-center justify-between gap-2 text-xs">
              <span className="flex items-center gap-2 text-muted-foreground">
                <Icon size={14} />
                {name}
              </span>
              <span className="font-mono text-[10px]">{value}</span>
            </div>
            <Progress value={percent} className="h-1.5" />
          </div>
        ))}
      </div>
      <p className="mt-6 border-t pt-4 text-[10px] leading-relaxed text-muted-foreground">
        CPU inference · 2 threads · 120s timeout · No cloud usage quota. These
        are allocation limits, not hardware utilization readings.
      </p>
    </Widget>
  );
}

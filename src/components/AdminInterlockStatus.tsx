import { LockKeyhole, ShieldCheck } from "lucide-react";
import { command, useRuntime } from "@/runtime/store";
import { ActionButton } from "./ActionButton";
import { Widget } from "./Widget";
import StatusBadge from "./StatusBadge";
export function AdminGate({ children }: { children: React.ReactNode }) {
  const state = useRuntime();
  if (state.adminOpen) return <>{children}</>;
  return (
    <div className="flex min-h-72 flex-col items-center justify-center rounded-xl border bg-white p-8 text-center">
      <div className="mb-5 rounded-full bg-emerald-50 p-4">
        <LockKeyhole className="h-6 w-6 text-emerald-700" />
      </div>
      <h2 className="text-lg font-semibold">Administrator controls</h2>
      <p className="mb-6 mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
        Opening these controls blocks new tasks, cancels active inference, and
        verifies the companion is paused before continuing.
      </p>
      <ActionButton action={() => command("openAdmin")}>
        Open administrator session
      </ActionButton>
    </div>
  );
}
export function InterlockBanner() {
  const state = useRuntime();
  if (!state.adminOpen && !state.emergency) return null;
  return (
    <div
      role="status"
      className={`mb-6 flex flex-wrap items-center justify-between gap-4 rounded-lg border p-4 ${state.emergency ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"}`}
    >
      <div className="flex gap-3">
        <LockKeyhole className="mt-0.5 h-4 w-4" />
        <div>
          <p className="text-sm font-semibold">
            {state.emergency
              ? "Emergency isolation active"
              : "Administrator interlock engaged"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Companion paused. New operations blocked.{" "}
            {state.emergency
              ? "Release isolation in Settings."
              : "Close this session to restore the previous state."}
          </p>
        </div>
      </div>
      {state.adminOpen && (
        <ActionButton
          variant="outline"
          size="sm"
          action={() => command("closeAdmin")}
        >
          Close administrator session
        </ActionButton>
      )}
    </div>
  );
}
export default function AdminInterlockStatus() {
  const state = useRuntime();
  return (
    <Widget
      title="Security & authority"
      action={<ShieldCheck className="h-4 w-4 text-emerald-700" />}
    >
      <div className="space-y-4">
        {[
          ["Operating mode", state.mode],
          ["Administrator interlock", state.adminOpen ? "Engaged" : "Standby"],
          ["Inference network", "Isolated"],
          ["Financial capabilities", "Prohibited"],
        ].map(([label, value]) => (
          <div
            key={label}
            className="flex items-center justify-between gap-2 text-xs"
          >
            <span className="text-muted-foreground">{label}</span>
            <span className="font-medium">{value}</span>
          </div>
        ))}
        <div className="border-t pt-4">
          <StatusBadge
            tone={state.host.isolation === "VERIFIED" ? "good" : "warning"}
          >
            {state.host.isolation === "VERIFIED"
              ? "Engine isolation verified"
              : "Engine verification required"}
          </StatusBadge>
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            Capabilities remain subject to policy and target authorization at
            execution.
          </p>
        </div>
      </div>
    </Widget>
  );
}

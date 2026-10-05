import { useRef, useState } from "react";
import { Search, ShieldCheck } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { command, useConnection, useRuntime } from "@/runtime/store";
import { Widget } from "./Widget";
import StatusBadge from "./StatusBadge";
export default function CapabilityRegistry() {
  const state = useRuntime();
  const { connected } = useConnection();
  const saving = useRef(false);
  const [feedback, setFeedback] = useState<{
    id: string;
    message: string;
    error: boolean;
  } | null>(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const caps = state.capabilities.filter((c) =>
    `${c.name} ${c.id}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className="space-y-6">
      <Widget
        title="Capability registry"
        description="A policy switch grants permission only. It cannot attach a provider. Close administrator controls before running companion operations."
        action={
          <StatusBadge>{state.capabilities.length} registered</StatusBadge>
        }
      >
        <div className="relative mb-6 max-w-sm">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            aria-label="Search capabilities"
            placeholder="Search capabilities…"
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          {caps.map((cap) => (
            <div
              key={cap.id}
              className="grid gap-4 border-t py-5 lg:grid-cols-[1fr_220px]"
              data-capability={cap.id}
            >
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-medium">{cap.name}</h3>
                  <code className="text-[10px] text-muted-foreground">
                    {cap.id}
                  </code>
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {cap.description}
                </p>
                <p className="mt-2 text-[10px] text-muted-foreground">
                  {cap.provider} · Target: {cap.target}
                </p>
              </div>
              <div className="flex flex-col gap-3 lg:items-end">
                <span className="text-xs font-medium">
                  Policy: {cap.enabled ? "Enabled" : "Disabled"}
                </span>
                {cap.configurable ? (
                  <Switch
                    aria-label={`Enable ${cap.name}`}
                    aria-describedby={`capability-${cap.id}-status`}
                    checked={cap.enabled}
                    disabled={
                      !connected ||
                      !state.adminOpen ||
                      !cap.attached ||
                      (!cap.available && !cap.enabled) ||
                      busy !== null
                    }
                    onCheckedChange={async (enabled) => {
                      if (saving.current) return;
                      saving.current = true;
                      setBusy(cap.id);
                      setFeedback(null);
                      try {
                        await command("capability", { id: cap.id, enabled });
                        setFeedback({
                          id: cap.id,
                          message: `Policy ${enabled ? "enabled" : "disabled"} and saved on the host.`,
                          error: false,
                        });
                      } catch (e) {
                        const message =
                          e instanceof Error
                            ? e.message
                            : "Policy could not be saved.";
                        setFeedback({ id: cap.id, message, error: true });
                        toast.error(message);
                      } finally {
                        saving.current = false;
                        setBusy(null);
                      }
                    }}
                  />
                ) : (
                  <span className="text-xs text-muted-foreground">
                    Fixed host policy
                  </span>
                )}
                {busy === cap.id && (
                  <span role="status" className="text-xs">
                    Saving policy…
                  </span>
                )}
              </div>
              <div
                id={`capability-${cap.id}-status`}
                className="space-y-2 text-xs lg:col-span-2"
              >
                <div className="flex flex-wrap gap-2">
                  <StatusBadge tone={cap.attached ? "good" : "neutral"}>
                    Attachment: {cap.attached ? "Attached" : "Not attached"}
                  </StatusBadge>
                  <StatusBadge tone={cap.available ? "good" : "warning"}>
                    Availability: {cap.available ? "Available" : "Unavailable"}
                  </StatusBadge>
                  <StatusBadge
                    tone={cap.authorization.allowed ? "good" : "neutral"}
                  >
                    Authorization:{" "}
                    {cap.authorization.allowed
                      ? "Eligible for operation checks"
                      : "Blocked"}
                  </StatusBadge>
                </div>
                {cap.availabilityReason && (
                  <p className="text-muted-foreground">
                    {cap.availabilityReason}
                  </p>
                )}
                {cap.authorization.reason && (
                  <p className="text-muted-foreground">
                    {cap.authorization.reason}. Enabling policy does not bypass
                    this restriction.
                  </p>
                )}
                {!connected && (
                  <p className="text-amber-700">
                    Host disconnected. Reconnect to change policy.
                  </p>
                )}
                {feedback?.id === cap.id && (
                  <p
                    role={feedback.error ? "alert" : "status"}
                    className={
                      feedback.error ? "text-red-700" : "text-emerald-700"
                    }
                  >
                    {feedback.message}
                  </p>
                )}
              </div>
            </div>
          ))}
          {caps.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No capabilities match your search.
            </p>
          )}
        </div>
      </Widget>
      <div className="flex gap-3 rounded-lg border border-emerald-200 bg-emerald-50/50 p-5">
        <ShieldCheck size={20} className="shrink-0 text-emerald-700" />
        <div>
          <p className="text-sm font-medium">
            Financial access is outside the ACOS boundary.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            There is no financial capability. Network and device providers
            remain unavailable until a governed implementation is installed.
          </p>
        </div>
      </div>
    </div>
  );
}

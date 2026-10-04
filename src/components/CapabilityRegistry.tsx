import { useState } from "react";
import { Search, ShieldCheck } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { command, useRuntime } from "@/runtime/store";
import { Widget } from "./Widget";
import StatusBadge from "./StatusBadge";
export default function CapabilityRegistry() {
  const state = useRuntime();
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const caps = state.capabilities.filter((c) =>
    `${c.name} ${c.id}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className="space-y-6">
      <Widget
        title="Capability registry"
        description="Registration is not authorization. Configure only the authority your companion needs."
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
              className="grid gap-4 border-t py-5 md:grid-cols-[1fr_140px_110px]"
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
              <div className="flex items-center">
                <StatusBadge tone={cap.available ? "good" : "neutral"}>
                  {cap.available ? "Provider available" : "Not attached"}
                </StatusBadge>
              </div>
              <div className="flex items-center justify-end gap-3">
                <span className="text-xs text-muted-foreground">
                  {cap.enabled ? "Enabled" : "Disabled"}
                </span>
                <Switch
                  aria-label={`Enable ${cap.name}`}
                  checked={cap.enabled}
                  disabled={
                    !cap.configurable || !cap.available || busy === cap.id
                  }
                  onCheckedChange={async (enabled) => {
                    setBusy(cap.id);
                    try {
                      await command("capability", { id: cap.id, enabled });
                    } catch (e) {
                      toast.error((e as Error).message);
                    } finally {
                      setBusy(null);
                    }
                  }}
                />
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

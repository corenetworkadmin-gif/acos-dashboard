import { useState } from "react";
import { Shield, ShieldAlert, ShieldCheck } from "lucide-react";
import { Input } from "@/components/ui/input";
import { command, useRuntime } from "@/runtime/store";
import { Widget } from "./Widget";
import { ActionButton } from "./ActionButton";
import { modes } from "@/runtime/model";
export default function SettingsPanel() {
  const state = useRuntime();
  const [name, setName] = useState(state.companion.name);
  return (
    <div className="space-y-6">
      <Widget
        title="Operating mode"
        description="Modes define policy ceilings. Selecting a mode does not enable any capability."
      >
        <div className="grid gap-4 md:grid-cols-3">
          {modes.map((mode, index) => {
            const Icon = [ShieldCheck, Shield, ShieldAlert][index];
            return (
              <div
                key={mode}
                className={`rounded-lg border p-5 ${state.mode === mode ? "border-primary bg-emerald-50/40 ring-1 ring-primary" : ""}`}
              >
                <Icon className="mb-4 h-5 w-5 text-primary" />
                <h3 className="text-sm font-semibold capitalize">
                  {mode.toLowerCase()}
                </h3>
                <p className="mb-6 mt-2 min-h-14 text-xs leading-relaxed text-muted-foreground">
                  {
                    [
                      "Maximum isolation. Local compute and companion storage only.",
                      "May permit governed Internet access when a provider is available.",
                      "May permit explicitly authorized devices and remote execution.",
                    ][index]
                  }
                </p>
                <ActionButton
                  variant={state.mode === mode ? "secondary" : "outline"}
                  className="w-full"
                  size="sm"
                  disabled={state.mode === mode}
                  action={() => command("mode", { mode })}
                >
                  {state.mode === mode
                    ? "Current mode"
                    : `Use ${mode.toLowerCase()} mode`}
                </ActionButton>
              </div>
            );
          })}
        </div>
      </Widget>
      <div className="grid gap-6 lg:grid-cols-2">
        <Widget
          title="Companion identity"
          description="Update the display name without changing identity or memory."
        >
          <label htmlFor="companion-name" className="text-xs font-medium">
            Display name
          </label>
          <Input
            id="companion-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            className="mb-4 mt-2"
          />
          <ActionButton
            disabled={!name.trim() || name.trim() === state.companion.name}
            action={() => command("rename", { name: name.trim() })}
          >
            Save name
          </ActionButton>
          <p className="mt-4 break-all font-mono text-[10px] text-muted-foreground">
            Identity: {state.companion.id}
          </p>
        </Widget>
        <Widget
          title="Emergency control"
          description="Immediately terminate local inference and prevent new operations."
        >
          <p className="mb-5 text-xs leading-relaxed text-muted-foreground">
            Isolation is independent of model cooperation. Releasing it keeps
            the companion paused until you explicitly resume.
          </p>
          {state.emergency ? (
            <ActionButton
              variant="outline"
              action={() => command("releaseIsolation")}
            >
              Release emergency isolation
            </ActionButton>
          ) : (
            <ActionButton
              variant="destructive"
              action={() => command("isolate")}
            >
              Emergency isolate
            </ActionButton>
          )}
        </Widget>
      </div>
    </div>
  );
}

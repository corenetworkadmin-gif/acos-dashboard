import { Cpu, Fingerprint, Network, ShieldCheck } from "lucide-react";
import { command, useRuntime } from "@/runtime/store";
import { Widget } from "./Widget";
import { ActionButton } from "./ActionButton";
import StatusBadge from "./StatusBadge";
export default function LocalAIEngineStatus() {
  const state = useRuntime();
  return (
    <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
      <Widget
        title="Local AI engine"
        description={`llama.cpp · GGUF · ${state.host.modelAdapter}`}
        action={
          <StatusBadge tone={state.engine === "READY" ? "good" : "warning"}>
            {state.host.busy
              ? "Processing"
              : state.engine === "READY"
                ? "Ready"
                : "Stopped"}
          </StatusBadge>
        }
      >
        <div className="mb-6 flex items-center gap-4 rounded-lg border bg-muted/30 p-5">
          <div className="rounded-xl border bg-white p-4">
            <Cpu className="h-7 w-7 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="break-all text-sm font-semibold">
              {state.host.model ?? "No model configured"}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Local inference · Fully offline execution
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-6">
          {[
            [
              "Context window",
              `${state.host.contextLimit.toLocaleString()} tokens`,
            ],
            [
              "Output budget",
              `${state.host.maxOutputTokens} tokens / response`,
            ],
            [
              "Compute",
              state.host.compute
                ? `${state.host.compute.backend} · ${state.host.compute.threads} threads`
                : "Awaiting resource admission",
            ],
            [
              "Tokenizer",
              state.engine === "READY"
                ? "Model load verified"
                : "Pending verification",
            ],
          ].map(([label, value]) => (
            <div key={label}>
              <p className="text-[11px] text-muted-foreground">{label}</p>
              <p className="mt-1.5 text-sm font-medium">{value}</p>
            </div>
          ))}
        </div>
        {state.host.compute?.reason && (
          <p className="mt-4 text-xs text-muted-foreground">
            {state.host.compute.reason}
          </p>
        )}
        {state.host.engineError && (
          <p
            role="alert"
            className="mt-5 break-words rounded border border-red-200 bg-red-50 p-3 text-xs text-red-700"
          >
            {state.host.engineError}
          </p>
        )}
        <div className="mt-7 flex flex-wrap gap-3 border-t pt-5">
          <ActionButton
            disabled={
              state.host.busy || !state.host.model || state.engine === "READY"
            }
            action={() => command("engine", { status: "READY" })}
          >
            Verify & load model
          </ActionButton>
          <ActionButton
            variant="outline"
            disabled={state.host.busy || state.engine === "STOPPED"}
            action={() => command("engine", { status: "STOPPED" })}
          >
            Unload engine
          </ActionButton>
          <ActionButton
            variant="ghost"
            disabled={state.host.busy || state.messages.length === 0}
            action={() => command("clearConversation")}
          >
            Clear active context
          </ActionButton>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          Loading validates the model checksum, Linux sandbox, tokenizer, and a
          real inference health check. Companion memories survive unloading.
        </p>
      </Widget>
      <div className="space-y-6">
        <Widget
          title="Registered model adapters"
          description="Choose an adapter in host configuration. Each model must pass its own load and inference checks."
        >
          <ul className="space-y-3 text-xs">
            {state.host.modelRegistry.map((adapter) => (
              <li key={adapter.id}>
                <strong>{adapter.id}</strong>
                <p>
                  {adapter.families.join(", ")} · {adapter.format} ·{" "}
                  {adapter.tokenizer}
                </p>
              </li>
            ))}
          </ul>
        </Widget>
        <Widget title="Execution boundary">
          <div className="space-y-5">
            {[
              [
                Network,
                "Network namespace",
                "No Internet or LAN access from inference.",
              ],
              [
                ShieldCheck,
                "Filesystem boundary",
                "Model and engine mounted read-only; no Home or host credentials.",
              ],
              [
                Fingerprint,
                "Model integrity",
                state.host.modelHash
                  ? `SHA-256: ${state.host.modelHash}`
                  : "Awaiting model verification.",
              ],
            ].map(([Icon, title, description]) => {
              const I = Icon as typeof Cpu;
              return (
                <div key={String(title)} className="flex gap-3">
                  <I className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div>
                    <h3 className="text-xs font-semibold">{String(title)}</h3>
                    <p className="mt-1.5 break-all text-xs leading-relaxed text-muted-foreground">
                      {String(description)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </Widget>
        <Widget title="Host configuration">
          <p className="text-xs leading-relaxed text-muted-foreground">
            The host administrator installs a trusted llama.cpp binary and GGUF
            model, then sets ACOS_ENGINE_BINARY, ACOS_MODEL_PATH, and
            ACOS_MODEL_SHA256. Model paths cannot be changed by the companion.
          </p>
        </Widget>
      </div>
    </div>
  );
}

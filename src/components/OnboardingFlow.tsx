import {
  ArrowRight,
  BrainCircuit,
  Check,
  Circle,
  Cpu,
  HardDrive,
  MemoryStick,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { command, useRuntime } from "@/runtime/store";
import { Widget } from "./Widget";
import { ActionButton } from "./ActionButton";
import StatusBadge from "./StatusBadge";

// Guided first-run flow. It reflects the host's real state at every step and
// never fabricates readiness: each step is marked done only from live evidence
// (discovered hardware, a verified/loaded engine, a confirmed Home, a real turn).
export default function OnboardingFlow() {
  const state = useRuntime();
  const hardware = state.host.hardware;
  const steps = state.onboarding.steps;
  const done = steps.filter((step) => step.done).length;
  const nextStep = steps.find((step) => !step.done);
  return (
    <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
      <Widget
        title="Set up ACOS on this computer"
        description="Four steps from a fresh install to a real conversation."
        action={
          <StatusBadge tone={done === steps.length ? "good" : "warning"}>
            {done} / {steps.length} complete
          </StatusBadge>
        }
      >
        <div className="mb-6 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${(done / steps.length) * 100}%` }}
          />
        </div>
        <div className="space-y-1">
          {steps.map((step, index) => (
            <div
              key={step.id}
              className={`flex items-center gap-4 rounded-lg px-1 py-4 ${
                nextStep?.id === step.id ? "bg-muted/40" : ""
              }`}
            >
              {step.done ? (
                <Check
                  size={20}
                  className="shrink-0 rounded-full bg-emerald-50 p-0.5 text-emerald-700"
                />
              ) : (
                <Circle size={20} className="shrink-0 text-slate-300" />
              )}
              <div className="flex-1">
                <p className="text-xs font-medium">
                  {index + 1}. {step.label}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {step.id === "hardware"
                    ? hardware
                      ? `${hardware.architecture} · ${hardware.cpu.usableThreads} usable threads · ${(hardware.memory.availableBytes / 1024 ** 3).toFixed(1)} GB free RAM`
                      : "Discovering resources…"
                    : step.id === "engine"
                      ? state.host.model
                        ? `Model: ${state.host.model}`
                        : "No local model configured on this host yet."
                      : step.id === "companion"
                        ? "Confirm the durable Home your companion will keep."
                        : "Close administrator controls and start a conversation."}
                </p>
              </div>
              {step.id === "conversation" && (
                <Link
                  to="/companion"
                  className="text-[11px] text-primary underline"
                >
                  Open
                </Link>
              )}
            </div>
          ))}
        </div>
        <div className="mt-6 flex flex-wrap gap-3 border-t pt-5">
          {state.adminOpen ? (
            <ActionButton
              disabled={state.host.busy}
              action={async () => {
                await command("engine", { status: "READY" });
                toast.success("Local engine verified and loaded");
              }}
            >
              <Cpu size={14} className="mr-2" />
              Verify &amp; load model
            </ActionButton>
          ) : (
            <ActionButton
              variant="outline"
              action={() => command("openAdmin")}
            >
              <ShieldCheck size={14} className="mr-2" />
              Open administrator session
            </ActionButton>
          )}
          <ActionButton
            variant="outline"
            disabled={!state.adminOpen || state.onboarding.companionHome}
            action={async () => {
              await command("confirmCompanionHome");
              toast.success("Companion Home established");
            }}
          >
            <BrainCircuit size={14} className="mr-2" />
            Establish companion Home
          </ActionButton>
          <ActionButton
            variant="ghost"
            disabled={!state.adminOpen || state.onboarding.completed}
            action={async () => {
              await command("completeOnboarding");
              toast.success("Setup marked complete");
            }}
          >
            <Sparkles size={14} className="mr-2" />
            Finish setup
          </ActionButton>
        </div>
        {state.host.engineError && (
          <p
            role="alert"
            className="mt-4 break-words rounded border border-red-200 bg-red-50 p-3 text-xs text-red-700"
          >
            {state.host.engineError}
          </p>
        )}
      </Widget>
      <div className="space-y-6">
        <Widget title="Discovered on this computer">
          {hardware ? (
            <div className="space-y-5">
              {[
                [
                  Cpu,
                  "Processor",
                  `${hardware.cpu.model || hardware.architecture} · ${hardware.cpu.logicalThreads} logical / ${hardware.cpu.usableThreads} usable threads`,
                ],
                [
                  MemoryStick,
                  "Memory",
                  `${(hardware.memory.totalBytes / 1024 ** 3).toFixed(1)} GB total · ${(hardware.memory.availableBytes / 1024 ** 3).toFixed(1)} GB available`,
                ],
                [
                  HardDrive,
                  "Storage",
                  hardware.storage
                    ? `${(hardware.storage.availableBytes / 1024 ** 3).toFixed(1)} GB free`
                    : "Not reported",
                ],
                [
                  ShieldCheck,
                  "Isolation",
                  hardware.isolation?.available
                    ? "Host isolation available"
                    : "Host isolation not detected",
                ],
              ].map(([Icon, title, description]) => {
                const I = Icon as typeof Cpu;
                return (
                  <div key={String(title)} className="flex gap-3">
                    <I className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <div>
                      <h3 className="text-xs font-semibold">{String(title)}</h3>
                      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                        {String(description)}
                      </p>
                    </div>
                  </div>
                );
              })}
              <p className="border-t pt-4 text-[11px] leading-relaxed text-muted-foreground">
                Accelerators detected:{" "}
                {hardware.accelerators?.length
                  ? hardware.accelerators
                      .map((a) => `${a.vendor} ${a.name}`)
                      .join(", ")
                  : "none — CPU inference will be used."}
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Discovering this computer&rsquo;s resources…
            </p>
          )}
        </Widget>
        <Widget title="Why this matters">
          <p className="text-xs leading-relaxed text-muted-foreground">
            ACOS discovers resources on the actual installation. Nothing here is
            hard-coded to a developer machine, so a different compatible computer
            configures its own CPU, memory, storage and accelerators.
          </p>
          <Link
            to="/engine"
            className="mt-4 inline-flex items-center gap-1.5 text-[11px] text-primary underline"
          >
            Open local engine <ArrowRight size={12} />
          </Link>
        </Widget>
      </div>
    </div>
  );
}

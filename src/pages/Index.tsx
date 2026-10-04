import {
  ArrowRight,
  ArrowUpRight,
  BrainCircuit,
  Check,
  Circle,
  Cpu,
  Pause,
  Play,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { command, useRuntime } from "@/runtime/store";
import { Widget } from "@/components/Widget";
import { ActionButton } from "@/components/ActionButton";
import StatusBadge from "@/components/StatusBadge";
import ResourceMonitor from "@/components/ResourceMonitor";
import AdminInterlockStatus from "@/components/AdminInterlockStatus";
export default function Index() {
  const state = useRuntime();
  const paused = state.paused || state.adminOpen || state.emergency;
  const enabled = state.capabilities.filter(
    (c) => c.enabled && c.available,
  ).length;
  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-xl border border-[#cbded3] bg-[#e9f2ec] p-6 sm:p-8">
        <div className="absolute -right-12 -top-16 h-72 w-72 rounded-full border border-primary/5" />
        <div className="absolute -right-5 -top-9 h-56 w-56 rounded-full border border-primary/10" />
        <div className="absolute right-6 top-5 hidden h-32 w-32 items-center justify-center rounded-full border border-primary/10 bg-white/20 md:flex">
          <BrainCircuit
            className="h-16 w-16 text-[#497c62]"
            strokeWidth={0.8}
          />
        </div>
        <div className="relative max-w-lg">
          <div className="mb-5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.16em] text-[#49765c]">
            <Sparkles size={13} />
            Your companion, on your terms
          </div>
          <h2 className="font-serif text-3xl leading-tight text-[#244b37] sm:text-4xl">
            A home for {state.companion.name}.<br />
            Control that stays with you.
          </h2>
          <p className="mb-6 mt-4 max-w-sm text-xs leading-relaxed text-[#61786a]">
            Local intelligence. Persistent memory. Explicit authority.
            <br />A clear view of your companion’s operating environment.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button asChild size="sm">
              <Link to="/companion">
                Open companion <ArrowRight size={14} className="ml-2" />
              </Link>
            </Button>
            <Button
              asChild
              variant="outline"
              size="sm"
              className="border-[#bccfc2] bg-transparent"
            >
              <Link to="/engine">Manage local engine</Link>
            </Button>
          </div>
        </div>
      </section>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: "COMPANION STATE",
            value: paused
              ? "Paused"
              : state.engine === "READY"
                ? "Ready"
                : "Awaiting engine",
            detail: paused
              ? "Admissions are blocked"
              : "One identity · One host",
            icon: BrainCircuit,
            good: !paused && state.engine === "READY",
          },
          {
            label: "OPERATING MODE",
            value: state.mode.charAt(0) + state.mode.slice(1).toLowerCase(),
            detail: `Policy version ${state.policyVersion}`,
            icon: ShieldCheck,
            good: true,
          },
          {
            label: "LOCAL ENGINE",
            value: state.host.busy
              ? "Processing"
              : state.engine === "READY"
                ? "Ready"
                : "Not loaded",
            detail: state.host.model
              ? "llama.cpp · CPU inference"
              : "Host configuration required",
            icon: Cpu,
            good: state.engine === "READY",
          },
          {
            label: "CAPABILITIES",
            value: `${enabled} / ${state.capabilities.length}`,
            detail: "Enabled / Registered",
            icon: Check,
            good: true,
          },
        ].map(({ label, value, detail, icon: Icon, good }) => (
          <div key={label} className="rounded-lg border bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between text-[9px] font-semibold tracking-[.12em] text-muted-foreground">
              {label}
              <Icon size={15} className="text-slate-400" />
            </div>
            <div className="mt-4 flex items-center gap-2">
              <span
                className={`h-1.5 w-1.5 rounded-full ${good ? "bg-emerald-500" : "bg-amber-400"}`}
              />
              <span className="text-xl font-semibold tracking-tight">
                {value}
              </span>
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground">{detail}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <Widget
          title="Your companion"
          description="Identity and continuity across engine changes."
          action={
            <StatusBadge tone={paused ? "warning" : "good"}>
              {paused ? "Paused" : "Available"}
            </StatusBadge>
          }
        >
          <div className="flex flex-wrap items-center justify-between gap-5">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50">
                <BrainCircuit
                  className="h-7 w-7 text-primary"
                  strokeWidth={1.2}
                />
              </div>
              <div>
                <h3 className="text-lg font-semibold">
                  {state.companion.name}
                </h3>
                <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                  {state.companion.id}
                </p>
              </div>
            </div>
            <ActionButton
              variant="outline"
              size="sm"
              disabled={state.adminOpen || state.emergency}
              action={() => command("pause", { paused: !state.paused })}
            >
              {state.paused ? (
                <Play size={13} className="mr-2" />
              ) : (
                <Pause size={13} className="mr-2" />
              )}
              {state.paused ? "Resume companion" : "Pause companion"}
            </ActionButton>
          </div>
          <div className="mt-6 grid grid-cols-3 gap-3 border-t pt-5">
            {[
              [String(state.companion.memories.length), "Durable memories"],
              [
                String(state.messages.filter((m) => m.role === "user").length),
                "Conversation turns",
              ],
              [String(state.host.completedOperations), "Completed operations"],
            ].map(([value, label]) => (
              <div key={label}>
                <p className="text-xl font-medium">{value}</p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {label}
                </p>
              </div>
            ))}
          </div>
        </Widget>
        <AdminInterlockStatus />
      </div>
      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <Widget
          title="Get your workspace ready"
          description="A few deliberate steps before your first conversation."
        >
          <div className="space-y-1">
            {[
              {
                title: "Verify and load your local model",
                description:
                  "Check model integrity and the isolated execution boundary.",
                done: state.engine === "READY",
                path: "/engine",
              },
              {
                title: "Review companion capabilities",
                description:
                  "Decide which operations your companion may request.",
                done: state.policyVersion > 1,
                path: "/capabilities",
              },
              {
                title: "Start your first conversation",
                description:
                  "Close administrator controls and talk to your companion.",
                done: state.messages.length > 0,
                path: "/companion",
              },
            ].map((item) => (
              <Link
                key={item.title}
                to={item.path}
                className="flex items-center gap-4 rounded-lg px-1 py-4 hover:bg-muted/30"
              >
                {item.done ? (
                  <Check
                    size={19}
                    className="shrink-0 rounded-full bg-emerald-50 p-0.5 text-emerald-700"
                  />
                ) : (
                  <Circle size={19} className="shrink-0 text-slate-300" />
                )}
                <div className="flex-1">
                  <p className="text-xs font-medium">{item.title}</p>
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    {item.description}
                  </p>
                </div>
                <ArrowUpRight size={15} className="text-muted-foreground" />
              </Link>
            ))}
          </div>
        </Widget>
        <ResourceMonitor />
      </div>
      <footer className="flex flex-wrap justify-between gap-2 pt-1 text-[10px] text-muted-foreground">
        <span>ACOS host runtime · Linux isolation · Local storage</span>
        <span>
          One companion. Explicit authority. No financial capabilities.
        </span>
      </footer>
    </div>
  );
}

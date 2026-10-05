import { useState } from "react";
import {
  Bell,
  CalendarClock,
  Play,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { command, useRuntime } from "@/runtime/store";
import { Widget } from "./Widget";
import { ActionButton } from "./ActionButton";
import StatusBadge from "./StatusBadge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const time = (value: number | null) =>
  value ? new Date(value).toLocaleTimeString() : "—";

// Scheduler and event bus. Every row here is a *request*: ACOS still decides at run
// time whether it is authorized. Nothing on this page grants authority.
export default function SchedulerPanel() {
  const state = useRuntime();
  const scheduler = state.scheduler;
  const [name, setName] = useState("");
  const [capability, setCapability] = useState("home.write");
  const [action, setAction] = useState("write");
  const [target, setTarget] = useState("companion/home");
  const [input, setInput] = useState("");
  const [kind, setKind] = useState<"interval" | "event">("interval");
  const [intervalSeconds, setIntervalSeconds] = useState("60");
  const [eventName, setEventName] = useState("host.boot");
  const [idempotencyKey, setIdempotencyKey] = useState("");

  const submit = async () => {
    await command("scheduleTask", {
      name,
      capability,
      action,
      target,
      input,
      kind,
      intervalMs:
        kind === "interval" ? Math.max(1000, Number(intervalSeconds) * 1000) : undefined,
      eventName: kind === "event" ? eventName : undefined,
      idempotencyKey: idempotencyKey || undefined,
    });
    toast.success("Scheduled task registered");
    setName("");
    setInput("");
    setIdempotencyKey("");
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
      <div className="space-y-6">
        {scheduler.recoveryRequired && (
          <Widget
            title="Recovery required"
            description="A durable operation was interrupted mid-activation. ACOS failed closed and paused the companion until you reconcile it."
            action={<StatusBadge tone="danger">Paused</StatusBadge>}
          >
            <ul className="mb-4 space-y-2 text-xs text-muted-foreground">
              {scheduler.recovery
                .filter((r) => r.decision === "RECOVERY_REQUIRED")
                .map((r) => (
                  <li key={r.operationId}>
                    <span className="font-medium text-foreground">
                      {r.operationId.slice(0, 8)}
                    </span>{" "}
                    — {r.reason}
                  </li>
                ))}
            </ul>
            <ActionButton
              action={async () => {
                await command("recover");
                toast.success("Recovery reconciled; companion resumed");
              }}
            >
              <RotateCcw size={14} className="mr-2" />
              Reconcile with current authority
            </ActionButton>
          </Widget>
        )}

        <Widget
          title="Scheduled & event-triggered work"
          description="Autonomy never implies authority. Each run enters the same operation pipeline and can be denied."
          action={
            <StatusBadge tone={scheduler.tasks.length ? "good" : "neutral"}>
              {scheduler.tasks.length} task{scheduler.tasks.length === 1 ? "" : "s"}
            </StatusBadge>
          }
        >
          <div className="space-y-3">
            {scheduler.tasks.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No scheduled work yet. Register one below.
              </p>
            )}
            {scheduler.tasks.map((task) => (
              <div
                key={task.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{task.name}</p>
                  <p className="mt-1 truncate text-[11px] text-muted-foreground">
                    {task.capability} · {task.action} · {task.target} ·{" "}
                    {task.kind === "interval"
                      ? `every ${(task.intervalMs ?? 0) / 1000}s`
                      : `on "${task.eventName}"`}
                    {task.idempotencyKey ? " · idempotent" : ""}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    runs {task.runs} · last {time(task.lastRun)} · next{" "}
                    {task.kind === "interval" ? time(task.nextRun) : "on event"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={task.enabled}
                    onCheckedChange={async (enabled) => {
                      await command("setScheduledEnabled", { id: task.id, enabled });
                    }}
                  />
                  <ActionButton
                    variant="ghost"
                    size="icon"
                    action={async () => {
                      await command("removeScheduled", { id: task.id });
                      toast.success("Task removed");
                    }}
                  >
                    <Trash2 size={14} />
                  </ActionButton>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap gap-3 border-t pt-5">
            <ActionButton
              variant="outline"
              action={async () => {
                const result = (await command("runScheduled")) as {
                  ran: { name: string; outcome: string }[];
                  skipped: boolean;
                };
                if (result.skipped)
                  toast.info("Scheduler idle: interlock open, paused, or busy.");
                else
                  toast.success(
                    `Evaluated ${result.ran.length} due task(s) through the pipeline.`,
                  );
              }}
            >
              <Play size={14} className="mr-2" />
              Run due tasks now
            </ActionButton>
          </div>
        </Widget>

        <Widget
          title="Register a task"
          description="A scheduled request. It grants no authority; policy decides each run."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nightly note"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Capability</Label>
              <Select
                value={capability}
                onValueChange={(value) => {
                  setCapability(value);
                  setAction(value === "home.write" ? "write" : "read");
                  setTarget("companion/home");
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="home.write">home.write</SelectItem>
                  <SelectItem value="home.read">home.read</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Trigger</Label>
              <Select
                value={kind}
                onValueChange={(value) => setKind(value as "interval" | "event")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="interval">Interval</SelectItem>
                  <SelectItem value="event">Event</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {kind === "interval" ? (
              <div className="space-y-1.5">
                <Label className="text-xs">Every (seconds)</Label>
                <Input
                  type="number"
                  min={1}
                  value={intervalSeconds}
                  onChange={(e) => setIntervalSeconds(e.target.value)}
                />
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label className="text-xs">Event name</Label>
                <Input
                  value={eventName}
                  onChange={(e) => setEventName(e.target.value)}
                />
              </div>
            )}
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs">
                Input{capability === "home.read" ? " (optional)" : ""}
              </Label>
              <Textarea
                rows={2}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Text the operation carries"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs">
                Idempotency key (optional — prevents duplicate execution)
              </Label>
              <Input
                value={idempotencyKey}
                onChange={(e) => setIdempotencyKey(e.target.value)}
                placeholder="e.g. nightly-note-2026-10-05"
              />
            </div>
          </div>
          <div className="mt-5">
            <ActionButton
              disabled={!state.adminOpen || !name.trim()}
              action={submit}
            >
              <Plus size={14} className="mr-2" />
              Register task
            </ActionButton>
          </div>
        </Widget>
      </div>

      <div className="space-y-6">
        <Widget
          title="Event bus"
          description="Events are informational and never grant authority."
          action={
            <ActionButton
              variant="outline"
              action={async () => {
                const result = (await command("emitEvent", {
                  name: "manual.test",
                  detail: "Emitted from the console",
                })) as { triggered: number };
                toast.success(`Event recorded; ${result.triggered} task(s) triggered`);
              }}
            >
              <Bell size={14} className="mr-2" />
              Emit test event
            </ActionButton>
          }
        >
          <div className="space-y-2">
            {scheduler.events.length === 0 && (
              <p className="text-xs text-muted-foreground">No events recorded.</p>
            )}
            {scheduler.events.slice(0, 8).map((event) => (
              <div
                key={event.id}
                className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium">{event.name}</p>
                  {event.detail && (
                    <p className="truncate text-[11px] text-muted-foreground">
                      {event.detail}
                    </p>
                  )}
                </div>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {time(event.timestamp)}
                </span>
              </div>
            ))}
          </div>
        </Widget>

        <Widget
          title="Recovery journal"
          description="Durable markers written around operations where interruption matters."
          action={
            <StatusBadge tone={scheduler.recoveryRequired ? "danger" : "good"}>
              {scheduler.recoveryRequired ? "Action needed" : "Reconciled"}
            </StatusBadge>
          }
        >
          <div className="space-y-2">
            {scheduler.journal.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No durable operations recorded yet.
              </p>
            )}
            {scheduler.journal.slice(0, 8).map((entry) => (
              <div
                key={entry.id}
                className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <CalendarClock size={13} className="text-muted-foreground" />
                  <span className="text-xs font-medium">{entry.marker}</span>
                </div>
                <StatusBadge tone={entry.resolved ? "good" : "warning"}>
                  {entry.resolved ? "resolved" : "pending"}
                </StatusBadge>
              </div>
            ))}
          </div>
        </Widget>

        <Widget
          title="Idempotency ledger"
          description="Keys that prevent an operation from executing twice."
        >
          <div className="space-y-2">
            {scheduler.idempotency.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No idempotent operations recorded.
              </p>
            )}
            {scheduler.idempotency.slice(0, 8).map((record) => (
              <div
                key={record.key}
                className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
              >
                <span className="font-mono text-[11px] text-muted-foreground">
                  {record.key}…
                </span>
                <StatusBadge
                  tone={record.status === "COMPLETED" ? "good" : "warning"}
                >
                  {record.status}
                </StatusBadge>
              </div>
            ))}
          </div>
        </Widget>
      </div>
    </div>
  );
}

import { useState } from "react";
import { Activity, ArrowDownToLine, ChevronRight, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useRuntime } from "@/runtime/store";
import type { Operation } from "@/runtime/model";
import { Widget } from "./Widget";
import StatusBadge from "./StatusBadge";
import { downloadJson } from "@/lib/download";
export default function OperationLog() {
  const state = useRuntime();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [selected, setSelected] = useState<Operation | null>(null);
  const operations = state.operations.filter(
    (op) =>
      `${op.id} ${op.capability} ${op.action}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (filter === "ALL" || op.status === filter),
  );
  const detail =
    state.operations.find((op) => op.id === selected?.id) ?? selected;
  return (
    <>
      <Widget
        title="Operation history"
        description="Every request is correlated with its authorization, execution, and resource release."
        action={
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              downloadJson(
                {
                  exportedAt: new Date().toISOString(),
                  operations: state.operations,
                },
                "acos-operations.json",
              )
            }
          >
            <ArrowDownToLine size={13} className="mr-2" />
            Export
          </Button>
        }
      >
        <div className="mb-5 flex flex-wrap gap-3">
          <div className="relative min-w-52 flex-1">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search operations"
              placeholder="Search by ID, capability, or action…"
              className="pl-9"
            />
          </div>
          <select
            aria-label="Filter operation status"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="rounded-md border bg-white px-3 text-xs"
          >
            {[
              "ALL",
              "COMPLETED",
              "DENIED",
              "FAILED",
              "CANCELLED",
              "RUNNING",
              "TIMEOUT",
            ].map((s) => (
              <option key={s} value={s}>
                {s === "ALL" ? "All statuses" : s}
              </option>
            ))}
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-y bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="p-3 font-medium">Operation</th>
                <th className="p-3 font-medium">Capability / target</th>
                <th className="p-3 font-medium">Status</th>
                <th className="p-3 font-medium">Time</th>
                <th className="p-3">
                  <span className="sr-only">Details</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {operations.map((op) => (
                <tr key={op.id} className="border-b hover:bg-muted/20">
                  <td className="p-3">
                    <p className="font-medium">{op.action}</p>
                    <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                      {op.id.slice(0, 8)}
                    </p>
                  </td>
                  <td className="p-3">
                    <p>{op.capability}</p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {op.target}
                    </p>
                  </td>
                  <td className="p-3">
                    <StatusBadge
                      tone={
                        op.status === "COMPLETED"
                          ? "good"
                          : ["DENIED", "FAILED", "TIMEOUT"].includes(op.status)
                            ? "danger"
                            : "warning"
                      }
                    >
                      {op.status}
                    </StatusBadge>
                  </td>
                  <td className="whitespace-nowrap p-3 text-[11px] text-muted-foreground">
                    {new Date(op.timestamp).toLocaleTimeString()}
                  </td>
                  <td>
                    <Button
                      aria-label={`View operation ${op.id.slice(0, 8)}`}
                      variant="ghost"
                      size="icon"
                      onClick={() => setSelected(op)}
                    >
                      <ChevronRight size={15} />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {operations.length === 0 && (
          <div className="py-16 text-center">
            <Activity className="mx-auto mb-4 h-7 w-7 text-slate-300" />
            <p className="text-sm font-medium">
              {search || filter !== "ALL"
                ? "No matching operations"
                : "A clear starting point."}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Requests from chat and Companion Home will appear here.
            </p>
          </div>
        )}
        <p className="mt-4 text-[10px] text-muted-foreground">
          Showing {operations.length} of {state.operations.length} recent
          operations. Full host events are retained in the SQLite audit journal.
        </p>
      </Widget>
      <Widget className="mt-6" title="Administrator activity">
        <div className="max-h-72 space-y-4 overflow-auto">
          {state.activity.slice(0, 30).map((event) => (
            <div key={event.id} className="flex gap-4 text-xs">
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                {new Date(event.timestamp).toLocaleTimeString()}
              </span>
              <p className="break-words">{event.description}</p>
            </div>
          ))}
        </div>
      </Widget>
      <Dialog
        open={!!detail}
        onOpenChange={(open) => !open && setSelected(null)}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Operation lifecycle</DialogTitle>
            <DialogDescription className="break-all font-mono text-[11px]">
              {detail?.id}
            </DialogDescription>
          </DialogHeader>
          {detail && (
            <>
              <div className="grid grid-cols-2 gap-4 rounded-lg bg-muted/40 p-4 text-xs">
                <div>
                  Capability
                  <p className="mt-1 font-medium">{detail.capability}</p>
                </div>
                <div>
                  Policy version
                  <p className="mt-1 font-medium">v{detail.policyVersion}</p>
                </div>
                <div>
                  Target<p className="mt-1 font-medium">{detail.target}</p>
                </div>
                <div>
                  Companion
                  <p className="mt-1 break-all font-medium">
                    {detail.companionId}
                  </p>
                </div>
              </div>
              <ol className="ml-2 border-l pl-5">
                {detail.events.map((event, i) => (
                  <li key={i} className="relative py-3">
                    <span className="absolute -left-[25px] top-4 h-2 w-2 rounded-full bg-primary" />
                    <p className="text-xs font-semibold">{event.state}</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {event.description}
                    </p>
                  </li>
                ))}
              </ol>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

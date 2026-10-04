import { useState } from "react";
import { ArrowDownToLine, FileJson, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { command, getSample, useRuntime } from "@/runtime/store";
import type { ImportReport } from "@/runtime/model";
import { Widget } from "./Widget";
import { ActionButton } from "./ActionButton";
import { downloadJson } from "@/lib/download";
import StatusBadge from "./StatusBadge";
export default function CompanionImport() {
  const state = useRuntime();
  const [text, setText] = useState("");
  const [report, setReport] = useState<ImportReport | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [imported, setImported] = useState(false);
  const update = (value: string) => {
    setText(value);
    setReport(null);
    setConfirmed(false);
    setError("");
    setImported(false);
  };
  return (
    <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
      <Widget
        title="Bring your companion home"
        description="Validate a relocation package before replacing the current companion."
      >
        <div className="mb-6 flex flex-wrap gap-3">
          <ActionButton
            variant="outline"
            size="sm"
            action={async () =>
              downloadJson(await getSample(), "acos-relocation-example.json")
            }
          >
            <ArrowDownToLine size={14} className="mr-2" />
            Download example
          </ActionButton>
          <ActionButton
            variant="ghost"
            size="sm"
            action={async () =>
              update(JSON.stringify(await getSample(), null, 2))
            }
          >
            Use example
          </ActionButton>
        </div>
        <label className="mb-4 flex cursor-pointer flex-col items-center rounded-lg border border-dashed bg-muted/20 p-7 text-center hover:border-primary">
          <Upload className="mb-3 h-6 w-6 text-primary" />
          <span className="text-sm font-medium">
            Choose a relocation package
          </span>
          <span className="mt-2 text-xs text-muted-foreground">
            JSON envelope · Up to 500 KB
          </span>
          <input
            aria-label="Upload relocation package"
            type="file"
            accept=".json,application/json"
            className="sr-only"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              if (file.size > 512000) {
                toast.error("Package exceeds 500 KB.");
                return;
              }
              try {
                update(await file.text());
              } catch {
                toast.error("Could not read this file");
              }
              e.target.value = "";
            }}
          />
        </label>
        <label htmlFor="package-json" className="text-xs font-medium">
          Or paste package JSON
        </label>
        <Textarea
          id="package-json"
          value={text}
          onChange={(e) => update(e.target.value)}
          maxLength={512000}
          placeholder={'{ "payload": { ... }, "sha256": "..." }'}
          className="mb-4 mt-2 min-h-48 font-mono text-[11px]"
        />
        <ActionButton
          disabled={!text.trim()}
          action={async () => {
            setError("");
            setReport(null);
            try {
              const result = await command("inspectImport", {
                package: JSON.parse(text),
              });
              setReport(result.report);
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <FileJson size={14} className="mr-2" />
          Validate package
        </ActionButton>
        {error && (
          <p
            role="alert"
            className="mt-4 break-words rounded border border-red-200 bg-red-50 p-3 text-xs text-red-700"
          >
            {error}
          </p>
        )}
        {report && (
          <div className="mt-6 space-y-4 border-t pt-5">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-sm font-semibold">
                {imported ? "Import result" : "Validation result"} ·{" "}
                {report.name}
              </h3>
              <StatusBadge
                tone={report.status === "IMPORT_FAILED" ? "danger" : "warning"}
              >
                {report.status === "IMPORT_FAILED"
                  ? "Import blocked"
                  : "Partial continuity"}
              </StatusBadge>
            </div>
            <ul className="list-disc space-y-2 pl-4 text-xs leading-relaxed text-muted-foreground">
              {report.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
            {report.capabilities.map((cap) => (
              <div
                key={cap.name}
                className="flex justify-between gap-3 text-xs"
              >
                <code>{cap.name}</code>
                <span className="text-muted-foreground">{cap.status}</span>
              </div>
            ))}
            {report.status !== "IMPORT_FAILED" && !imported && (
              <>
                <label className="flex items-start gap-3 rounded border bg-muted/20 p-4 text-xs leading-relaxed">
                  <Checkbox
                    aria-label="Confirm companion replacement"
                    checked={confirmed}
                    onCheckedChange={(value) => setConfirmed(value === true)}
                    className="mt-0.5"
                  />
                  <span>
                    I trust this package’s source and understand it replaces{" "}
                    {state.companion.name}, including the current memories and
                    conversation. Imported declarations do not grant authority.
                  </span>
                </label>
                <ActionButton
                  disabled={!confirmed || state.host.busy}
                  action={async () => {
                    const result = await command("import", {
                      package: JSON.parse(text),
                      replace: confirmed,
                    });
                    setReport(result);
                    setImported(result.status !== "IMPORT_FAILED");
                    if (result.status !== "IMPORT_FAILED")
                      toast.success("Companion imported and paused for review");
                  }}
                >
                  Import & replace companion
                </ActionButton>
              </>
            )}
            {imported && (
              <p
                role="status"
                className="rounded bg-emerald-50 p-3 text-xs text-emerald-800"
              >
                Import committed. Review capabilities, load the engine, close
                the administrator session, and resume from Overview.
              </p>
            )}
          </div>
        )}
      </Widget>
      <div className="space-y-6">
        <Widget title="A deliberate move">
          <ol className="space-y-6">
            {[
              [
                "01",
                "Prepare",
                "The source companion provides its identity, durable state, and requirements.",
              ],
              [
                "02",
                "Validate",
                "Verify package checksum, schema, dependencies, and capability declarations.",
              ],
              [
                "03",
                "Reconcile",
                "Keep host policy. Missing capabilities remain explicitly unavailable.",
              ],
              [
                "04",
                "Activate",
                "Replace one companion atomically and keep it paused for review.",
              ],
            ].map(([n, title, description]) => (
              <li key={n} className="flex gap-4">
                <span className="font-mono text-xs text-primary/60">{n}</span>
                <div>
                  <p className="text-xs font-semibold">{title}</p>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    {description}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </Widget>
        <Widget title="Import history">
          {state.imports.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No packages imported yet.
            </p>
          ) : (
            state.imports.map((item) => (
              <div className="border-b py-3 text-xs" key={item.id}>
                <p className="font-medium">{item.name}</p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {new Date(item.timestamp).toLocaleString()} ·{" "}
                  {item.status === "IMPORT_FAILED"
                    ? "Rejected"
                    : "Partial continuity"}
                </p>
              </div>
            ))
          )}
        </Widget>
      </div>
    </div>
  );
}

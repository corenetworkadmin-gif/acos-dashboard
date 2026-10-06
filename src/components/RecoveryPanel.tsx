import { useState } from "react";
import { command } from "@/runtime/store";
import { ActionButton } from "./ActionButton";
import { Widget } from "./Widget";

function download(name: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function RecoveryPanel() {
  const [file, setFile] = useState<File | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  return (
    <Widget
      title="Recovery and audit checkpoints"
      description="Recover companion memories and recent conversation while preserving current permissions and audit history."
    >
      <p className="mb-4 text-xs text-muted-foreground">
        Backups are encrypted for this installation and companion. Keep the host
        storage key separately: a lost key cannot be recovered from this file.
        This backup excludes older archived turns and scheduled tasks. Retain
        signed audit checkpoints separately and pin the original signing public
        key to detect later tampering.
      </p>
      <div className="flex flex-wrap gap-3">
        <ActionButton
          variant="outline"
          action={async () =>
            download(
              "acos-companion-backup.json",
              await command("exportBackup"),
            )
          }
        >
          Download encrypted backup
        </ActionButton>
        <ActionButton
          variant="outline"
          action={async () =>
            download(
              "acos-audit-anchor.json",
              await command("exportAuditAnchor"),
            )
          }
        >
          Download signed audit checkpoint
        </ActionButton>
      </div>
      <label className="mt-5 block text-sm" htmlFor="recovery-file">
        Companion backup file
      </label>
      <input
        id="recovery-file"
        type="file"
        accept="application/json,.json"
        onChange={(event) => {
          setFile(event.target.files?.[0] ?? null);
          setConfirmed(false);
        }}
      />
      <label className="my-4 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        Replace current memories and recent conversation with this backup.
      </label>
      <ActionButton
        disabled={!file || !confirmed}
        action={async () => {
          if (!file || file.size > 500_000)
            throw new Error("Select a backup smaller than 500 KB.");
          await command("restoreBackup", {
            backup: JSON.parse(await file.text()),
            confirm: confirmed,
          });
          setConfirmed(false);
        }}
      >
        Restore and pause companion
      </ActionButton>
    </Widget>
  );
}

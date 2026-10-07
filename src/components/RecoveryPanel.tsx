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
  const [checkpoint, setCheckpoint] = useState<File | null>(null);
  const [pinnedKey, setPinnedKey] = useState("");
  const [anchorResult, setAnchorResult] = useState("");
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
      <details className="mt-5 rounded border p-3">
        <summary className="cursor-pointer text-sm">
          Compare an externally retained checkpoint
        </summary>
        <label htmlFor="anchor-file" className="mt-3 block text-xs">
          Retained checkpoint
        </label>
        <input
          id="anchor-file"
          type="file"
          accept="application/json,.json"
          onChange={(e) => {
            setCheckpoint(e.target.files?.[0] ?? null);
            setAnchorResult("");
          }}
        />
        <label htmlFor="anchor-key" className="mt-3 block text-xs">
          Independently pinned signing public key (PEM)
        </label>
        <textarea
          id="anchor-key"
          value={pinnedKey}
          onChange={(e) => {
            setPinnedKey(e.target.value);
            setAnchorResult("");
          }}
          className="my-2 w-full rounded border p-2 font-mono text-xs"
        />
        <ActionButton
          variant="outline"
          disabled={!checkpoint || !pinnedKey}
          action={async () => {
            setAnchorResult("");
            if (!checkpoint || checkpoint.size > 32000)
              throw new Error("Select a checkpoint smaller than 32 KB.");
            const result = (await command("verifyAuditAnchor", {
              checkpoint: JSON.parse(await checkpoint.text()),
              pinnedKey,
            })) as { sequence: number; laterEntries: number };
            setAnchorResult(
              `Checkpoint matches through entry ${result.sequence}. ${result.laterEntries} later entries are not covered by this checkpoint.`,
            );
          }}
        >
          Compare with current journal
        </ActionButton>
        <p role="status" className="mt-2 text-xs">
          {anchorResult}
        </p>
      </details>
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

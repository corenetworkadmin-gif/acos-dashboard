import { useState } from "react";
import { command, useRuntime } from "@/runtime/store";
import { ActionButton } from "./ActionButton";
import { Widget } from "./Widget";
import { Textarea } from "./ui/textarea";
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
export function MigrationPanel() {
  const state = useRuntime();
  const [file, setFile] = useState<File | null>(null);
  const [key, setKey] = useState("");
  const [confirm, setConfirm] = useState(false);
  async function transfer() {
    if (!file || file.size > 500_000)
      throw new Error("Select a transfer file smaller than 500 KB.");
    return JSON.parse(await file.text()).signed;
  }
  return (
    <Widget
      title="Authenticated migration"
      description="Move this companion between trusted installations with encrypted transfer and source retirement."
    >
      <p className="mb-3 text-sm font-medium">
        {state.migration.retired
          ? "This source installation is retired."
          : "This installation is active."}
      </p>
      <label className="text-sm" htmlFor="migration-own-key">
        This installation’s public identity key
      </label>
      <Textarea
        id="migration-own-key"
        readOnly
        value={state.migration.publicKey}
        className="mb-4 font-mono text-xs"
      />
      <ol className="mb-4 list-decimal space-y-2 pl-5 text-sm">
        <li>On the destination, download an offer. It expires in 24 hours.</li>
        <li>
          On the source, select that offer and independently confirm the
          destination’s public key. Retire the source and download its encrypted
          ticket.
        </li>
        <li>
          On the destination, select the ticket and independently confirm the
          source’s public key. Accept it to replace the destination companion,
          preserving destination permissions.
        </li>
      </ol>
      <p className="mb-4 text-xs text-muted-foreground">
        Source retirement is permanent in ACOS. Keep its data directory intact
        until the ticket is accepted; it allows re-downloading a ticket after
        interruption. This protocol assumes trusted host administrators and
        cannot prevent someone restoring a copied disk image.
      </p>
      <div className="mb-4 flex flex-wrap gap-3">
        <ActionButton
          variant="outline"
          action={async () =>
            download(
              "acos-migration-offer.json",
              await command("migrationOffer"),
            )
          }
        >
          Create destination offer
        </ActionButton>
        <ActionButton
          variant="outline"
          action={async () =>
            download(
              "acos-migration-ticket.json",
              await command("migrationTicket"),
            )
          }
        >
          Recover retired source ticket
        </ActionButton>
      </div>
      <label htmlFor="migration-file" className="block text-sm">
        Offer or ticket file
      </label>
      <input
        id="migration-file"
        type="file"
        accept=".json,application/json"
        onChange={(e) => {
          setFile(e.target.files?.[0] ?? null);
          setConfirm(false);
        }}
      />
      <label htmlFor="migration-key" className="mt-4 block text-sm">
        Independently verified peer public key (PEM)
      </label>
      <Textarea
        id="migration-key"
        value={key}
        onChange={(e) => {
          setKey(e.target.value);
          setConfirm(false);
        }}
      />
      <label className="my-4 flex gap-2 text-sm">
        <input
          type="checkbox"
          checked={confirm}
          onChange={(e) => setConfirm(e.target.checked)}
        />
        I verified the peer key separately and confirm source retirement or
        destination replacement.
      </label>
      <div className="flex flex-wrap gap-3">
        <ActionButton
          variant="destructive"
          disabled={!file || !key || !confirm}
          action={async () => {
            download(
              "acos-migration-ticket.json",
              await command("retireForMigration", {
                offer: await transfer(),
                destinationKey: key,
                confirm,
              }),
            );
            setConfirm(false);
          }}
        >
          Retire source and download ticket
        </ActionButton>
        <ActionButton
          disabled={!file || !key || !confirm}
          action={async () => {
            await command("acceptMigration", {
              ticket: await transfer(),
              sourceKey: key,
              confirm,
            });
            setConfirm(false);
          }}
        >
          Accept ticket on destination
        </ActionButton>
      </div>
    </Widget>
  );
}

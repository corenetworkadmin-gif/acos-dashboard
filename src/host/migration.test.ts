import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { HostRuntime } from "./runtime.ts";
import { LocalEngine } from "./engine.ts";
test("migration retires before transfer, survives restart and consumes a destination-bound offer once", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "acos-migrate-"));
  let source = new HostRuntime(
    path.join(root, "source"),
    new LocalEngine(null),
  );
  const destination = new HostRuntime(
    path.join(root, "destination"),
    new LocalEngine(null),
  );
  try {
    await source.openAdmin();
    await destination.openAdmin();
    source.rename("Migrated companion");
    source.setCapability("home.write", true);
    const offer = destination.migrationOffer();
    assert.throws(
      () => source.retireForMigration(offer.signed, offer.publicKey, false),
      /Confirm/,
    );
    const ticket = source.retireForMigration(
      offer.signed,
      offer.publicKey,
      true,
    );
    assert.equal(source.snapshot().migration.retired, true);
    assert.throws(() => source.setPaused(false), /retired/);
    assert.throws(() => source.restoreBackup({}, true), /administrator/);
    await source.shutdown();
    source = new HostRuntime(path.join(root, "source"), new LocalEngine(null));
    await source.openAdmin();
    assert.deepEqual(source.migrationTicket(), ticket);
    source.closeAdmin();
    await assert.rejects(
      source.run("home.write", "write", "companion/home", "forbidden"),
      /retired/,
    );
    destination.acceptMigration(ticket.signed, ticket.publicKey, true);
    assert.equal(destination.snapshot().companion.name, "Migrated companion");
    assert.equal(destination.snapshot().paused, true);
    assert.equal(
      destination.snapshot().capabilities.find((c) => c.id === "home.write")
        ?.enabled,
      false,
    );
    assert.throws(
      () => destination.acceptMigration(ticket.signed, ticket.publicKey, true),
      /unconsumed/,
    );
    destination.migrationOffer();
    assert.throws(
      () => destination.acceptMigration(ticket.signed, ticket.publicKey, true),
      /mismatch/,
    );
    assert.equal(destination.verifyStorage().ok, true);
  } finally {
    await source.shutdown();
    await destination.shutdown();
    rmSync(root, { recursive: true, force: true });
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadStorageKey } from "./storage-key.ts";
test("storage keys persist privately and lost keys are never silently replaced", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "acos-key-test-"));
  try {
    const key = loadStorageKey(directory);
    assert.deepEqual(loadStorageKey(directory), key);
    assert.equal(
      statSync(path.join(directory, "storage.key")).mode & 0o777,
      0o600,
    );
    writeFileSync(
      path.join(directory, "acos.sqlite"),
      "existing encrypted database",
    );
    rmSync(path.join(directory, "storage.key"));
    assert.throws(() => loadStorageKey(directory), /lost/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

import { applyUpdateChannel } from "./updates.ts";
import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
  symlinkSync,
} from "node:fs";
import { generateKeyPairSync, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { UpdateStore, unpackRelease } from "./update-store.ts";
import { signPayload } from "./trust.ts";

test("signed updates stage before activation, retain authority files and roll back without lowering replay fence", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "acos-update-test-"));
  try {
    const keys = generateKeyPairSync("ed25519");
    const privateKey = keys.privateKey
      .export({ format: "pem", type: "pkcs8" })
      .toString();
    const store = new UpdateStore(
      path.join(root, "releases"),
      keys.publicKey.export({ format: "pem", type: "spki" }).toString(),
    );
    const source = path.join(root, "source");
    mkdirSync(path.join(source, "web"), { recursive: true });
    writeFileSync(path.join(source, "server.mjs"), "// synthetic release");
    writeFileSync(path.join(source, "web/index.html"), "ACOS");
    const archive = path.join(root, "acos-test.tar.gz");
    execFileSync("tar", [
      "--format=ustar",
      "-czf",
      archive,
      "-C",
      source,
      "server.mjs",
      "web",
    ]);
    const bytes = readFileSync(archive);
    const manifest = (sequence: number) =>
      signPayload(
        JSON.stringify({
          purpose: "acos-release-v1",
          stateSchema: 1,
          version: "0.2.0",
          sequence,
          expiresAt: Date.now() + 60_000,
          platform: process.platform,
          architecture: process.arch,
          artifact: {
            name: "acos-test.tar.gz",
            bytes: bytes.length,
            sha256: createHash("sha256").update(bytes).digest("hex"),
          },
        }),
        privateKey,
      );
    const authority = path.join(root, "authority");
    writeFileSync(authority, "revoked");
    const health = async (directory: string) => {
      assert.equal(
        readFileSync(path.join(directory, "web/index.html"), "utf8"),
        "ACOS",
      );
    };
    const signed = manifest(1);
    const requested: string[] = [];
    const download = async (url: URL, max: number) => {
      requested.push(url.pathname);
      const result = url.pathname.endsWith("manifest.json")
        ? Buffer.from(JSON.stringify(signed))
        : bytes;
      assert.ok(result.length <= max);
      return result;
    };
    await assert.rejects(
      applyUpdateChannel(
        store,
        new URL("http://updates.invalid/manifest.json"),
        health,
        download,
      ),
      /HTTPS/,
    );
    assert.equal(requested.length, 0);
    await assert.rejects(
      applyUpdateChannel(
        store,
        new URL("https://updates.invalid/manifest.json"),
        health,
        async () =>
          Buffer.from(
            JSON.stringify({ ...signed, payload: signed.payload + " " }),
          ),
      ),
      /Signature/,
    );
    await applyUpdateChannel(
      store,
      new URL("https://updates.invalid/manifest.json"),
      health,
      download,
    );
    assert.deepEqual(requested, ["/manifest.json", "/acos-test.tar.gz"]);
    const first = store.state();
    await assert.rejects(
      store.apply(manifest(2), archive, async () => {
        throw new Error("unhealthy");
      }),
      /unhealthy/,
    );
    assert.deepEqual(store.state(), first);
    await store.apply(manifest(2), archive, health);
    await store.rollback(health);
    assert.equal(store.state().current, first.current);
    assert.equal(store.state().sequence, 2);
    assert.equal(readFileSync(authority, "utf8"), "revoked");
    await assert.rejects(store.apply(manifest(2), archive, health), /rollback/);
    symlinkSync("/etc/passwd", path.join(source, "web/link"));
    execFileSync("tar", [
      "--format=ustar",
      "-czf",
      archive,
      "-C",
      source,
      "server.mjs",
      "web",
    ]);
    const unsafe = path.join(root, "unsafe");
    mkdirSync(unsafe);
    assert.throws(() => unpackRelease(readFileSync(archive), unsafe), /links/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

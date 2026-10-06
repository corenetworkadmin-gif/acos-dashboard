import test from "node:test";
import assert from "node:assert/strict";
import {
  ExtensionRegistry,
  detectEscalation,
  extensionManifestSchema,
  type CapabilityFact,
} from "./extensions.ts";

const facts = (): CapabilityFact[] => [
  { id: "network.request", enabled: false, attached: false },
  { id: "home.write", enabled: true, attached: true },
];

test("manifest validation rejects malformed ids, missing fields and unknown keys", () => {
  assert.throws(() =>
    extensionManifestSchema.parse({ id: "Bad Id", name: "x", version: "1" }),
  );
  assert.throws(() =>
    extensionManifestSchema.parse({ id: "ok", name: "", version: "1" }),
  );
  assert.throws(() =>
    extensionManifestSchema.parse({
      id: "ok",
      name: "x",
      version: "1",
      extra: true,
    }),
  );
  const parsed = extensionManifestSchema.parse({
    id: "acme.tools",
    name: "Acme Tools",
    version: "1.0.0",
  });
  assert.deepEqual(parsed.requests, []);
  assert.deepEqual(parsed.tools, []);
});

test("installing an extension grants nothing and records requested capabilities as facts", () => {
  const registry = new ExtensionRegistry();
  const report = registry.install(
    {
      id: "acme.tools",
      name: "Acme Tools",
      version: "1.0.0",
      requests: ["network.request", "unknown.capability"],
      tools: ["network.request"],
    },
    facts(),
  );
  // The structural guarantee: no authority is ever granted by installation.
  assert.deepEqual(report.grants, []);
  assert.deepEqual(report.requests, [
    {
      capability: "network.request",
      known: true,
      enabled: false,
      attached: false,
    },
    {
      capability: "unknown.capability",
      known: false,
      enabled: false,
      attached: false,
    },
  ]);
  assert.deepEqual(report.tools, ["network.request"]);
  assert.equal(registry.list().length, 1);
  assert.equal(registry.get("acme.tools")?.name, "Acme Tools");
});

test("an extension requesting an already-enabled capability still changes nothing", () => {
  const registry = new ExtensionRegistry();
  const before = facts();
  const report = registry.install(
    {
      id: "acme.home",
      name: "Home helper",
      version: "2.1.0",
      requests: ["home.write"],
    },
    before,
  );
  assert.deepEqual(report.grants, []);
  assert.deepEqual(report.requests, [
    { capability: "home.write", known: true, enabled: true, attached: true },
  ]);
  // Installing never mutates the capability fact set it was given.
  assert.deepEqual(before, facts());
});

test("remove deletes an installed extension and reports whether it existed", () => {
  const registry = new ExtensionRegistry();
  registry.install(
    { id: "acme.tools", name: "Acme Tools", version: "1.0.0" },
    facts(),
  );
  assert.equal(registry.remove("acme.tools"), true);
  assert.equal(registry.remove("acme.tools"), false);
  assert.equal(registry.list().length, 0);
});

test("detectEscalation reports no change for an inert install and flags real escalations", () => {
  const before = facts();
  assert.deepEqual(detectEscalation(before, facts()), []);

  const enabled = facts().map((cap) =>
    cap.id === "network.request" ? { ...cap, enabled: true } : cap,
  );
  assert.deepEqual(detectEscalation(before, enabled), [
    "network.request: capability enabled by extension",
  ]);

  const attached = facts().map((cap) =>
    cap.id === "network.request" ? { ...cap, attached: true } : cap,
  );
  assert.deepEqual(detectEscalation(before, attached), [
    "network.request: provider attached by extension",
  ]);
});

test("signed installation uses a pinned signer and still grants nothing", async () => {
  const { generateKeyPairSync } = await import("node:crypto");
  const { signPayload } = await import("./trust.ts");
  const keys = generateKeyPairSync("ed25519");
  const privateKey = keys.privateKey
    .export({ format: "pem", type: "pkcs8" })
    .toString();
  const publicKey = keys.publicKey
    .export({ format: "pem", type: "spki" })
    .toString();
  const signed = signPayload(
    JSON.stringify({
      purpose: "acos-extension-v1",
      manifest: {
        id: "signed-test",
        name: "Test",
        version: "1",
        requests: ["network.request"],
      },
    }),
    privateKey,
  );
  const registry = new ExtensionRegistry();
  assert.deepEqual(
    registry.installSigned(signed, publicKey, facts()).grants,
    [],
  );
  assert.throws(
    () =>
      registry.installSigned(
        { ...signed, payload: signed.payload.replace("Test", "Evil") },
        publicKey,
        facts(),
      ),
    /Signature/,
  );
});

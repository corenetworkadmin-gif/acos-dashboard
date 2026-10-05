import test from "node:test";
import assert from "node:assert/strict";
import {
  NetworkProvider,
  DeviceProvider,
  RemoteProvider,
  ProviderRegistry,
  defaultProviders,
  isPrivateAddress,
  isPrivateHost,
  type DeviceBridge,
  type RemoteTransport,
} from "./providers.ts";

test("isPrivateAddress classifies loopback, link-local, private, reserved and ULA ranges", () => {
  for (const address of [
    "127.0.0.1",
    "10.1.2.3",
    "192.168.0.5",
    "172.16.0.1",
    "172.31.255.255",
    "169.254.10.10",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "::",
    "fe80::1",
    "fc00::1",
    "fd12:3456::1",
    "::ffff:127.0.0.1",
  ])
    assert.equal(isPrivateAddress(address), true, address);
  for (const address of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700::1111"])
    assert.equal(isPrivateAddress(address), false, address);
});

test("isPrivateHost treats localhost names and private literals as private", () => {
  assert.equal(isPrivateHost("localhost"), true);
  assert.equal(isPrivateHost("api.localhost"), true);
  assert.equal(isPrivateHost("127.0.0.1"), true);
  assert.equal(isPrivateHost("[::1]"), true);
  assert.equal(isPrivateHost("example.com"), false);
});

test("network provider is default-denied until an administrator attaches an allowlist", () => {
  const provider = new NetworkProvider();
  assert.equal(provider.capability, "network.request");
  assert.equal(provider.attached(), false);
  assert.equal(provider.target(), "None configured");
  assert.equal(
    provider.authorizeTarget("https://example.com/"),
    "No governed provider is attached.",
  );
  assert.throws(() => provider.attach({ hosts: [] }), /at least one allowed host/);
  assert.throws(
    () => provider.attach({ hosts: ["not a host!"] }),
    /Invalid allowlist host/,
  );
  assert.equal(provider.attached(), false);
});

test("network provider enforces the host allowlist, scheme, credentials and private refusal", () => {
  const provider = new NetworkProvider();
  provider.attach({ hosts: ["Example.com", "localhost"] });
  assert.equal(provider.attached(), true);
  assert.equal(provider.target(), "2 hosts allowed");
  assert.equal(provider.authorizeTarget("https://example.com/page"), null);
  assert.match(
    provider.authorizeTarget("https://evil.example.net/")!,
    /not in the attached allowlist/,
  );
  assert.match(provider.authorizeTarget("ftp://example.com/")!, /http and https/);
  assert.match(
    provider.authorizeTarget("https://user:pass@example.com/")!,
    /Credentials/,
  );
  assert.match(provider.authorizeTarget("not-a-url")!, /valid absolute URL/);
  assert.match(provider.authorizeTarget("http://localhost/")!, /private or loopback/);
  provider.detach();
  assert.equal(provider.attached(), false);
  assert.equal(provider.target(), "None configured");
});

test("network provider permits private targets only when the administrator opts in", () => {
  const provider = new NetworkProvider();
  provider.attach({ hosts: ["localhost"], allowPrivate: true });
  assert.equal(provider.authorizeTarget("http://localhost:8080/"), null);
});

test("registry is default-deny and reports every unattached provider", () => {
  const registry = new ProviderRegistry(defaultProviders());
  for (const capability of [
    "network.request",
    "device.microphone",
    "device.camera",
    "remote.execute",
  ]) {
    assert.equal(registry.isAttached(capability), false);
    assert.equal(registry.isAvailable(capability), false);
    assert.equal(registry.target(capability), "None configured");
  }
  const summaries = registry.summaries();
  assert.equal(summaries.length, 4);
  for (const summary of summaries) {
    assert.equal(summary.attached, false);
    assert.equal(summary.available, false);
    assert.equal(summary.availabilityReason, "No governed provider is attached.");
  }
});

test("registry attach is a host fact and unknown capabilities fail closed", async () => {
  const registry = new ProviderRegistry(defaultProviders());
  registry.attach("network.request", { hosts: ["example.com"] });
  assert.equal(registry.isAttached("network.request"), true);
  assert.equal(registry.isAvailable("network.request"), true);
  assert.equal(registry.target("network.request"), "example.com");
  assert.match(
    registry.authorizeTarget("unknown.capability", "x")!,
    /failed closed/,
  );
  assert.throws(() => registry.attach("unknown.capability", {}), /Unknown provider/);
  assert.throws(() => registry.detach("unknown.capability"), /Unknown provider/);
  await assert.rejects(
    registry.execute("unknown.capability", {
      input: "",
      target: "",
      timeoutMs: 1000,
      signal: new AbortController().signal,
    }),
    /Unknown provider/,
  );
  registry.detach("network.request");
  assert.equal(registry.isAttached("network.request"), false);
});

test("device providers stay unavailable without an explicit bridge", () => {
  const microphone = new DeviceProvider("microphone", null);
  assert.equal(microphone.capability, "device.microphone");
  assert.deepEqual(microphone.probe(), {
    available: false,
    reason: "No microphone bridge is configured on this host.",
  });
  assert.throws(() => microphone.attach(), /No microphone bridge/);
  assert.equal(microphone.attached(), false);
});

test("device provider captures through an injected bridge only for its own device", async () => {
  const captured: string[] = [];
  const bridge: DeviceBridge = {
    async capture({ device }) {
      captured.push(device);
      return { summary: `captured ${device}`, detail: { device } };
    },
  };
  const camera = new DeviceProvider("camera", bridge);
  assert.equal(camera.probe().available, true);
  camera.attach();
  assert.equal(camera.attached(), true);
  assert.match(camera.authorizeTarget("microphone")!, /does not match/);
  assert.equal(camera.authorizeTarget("camera"), null);
  const result = await camera.execute({
    input: "",
    target: "camera",
    timeoutMs: 1000,
    signal: new AbortController().signal,
  });
  assert.equal(result.output, "captured camera");
  assert.deepEqual(captured, ["camera"]);
});

test("remote provider requires a transport and an explicit endpoint", async () => {
  const unavailable = new RemoteProvider(null);
  assert.equal(unavailable.probe().available, false);
  assert.throws(() => unavailable.attach({ target: "x" }), /No remote transport/);

  const calls: { target: string; command: string }[] = [];
  const transport: RemoteTransport = {
    async execute({ target, command }) {
      calls.push({ target, command });
      return { output: `ran ${command}`, exitCode: 0 };
    },
  };
  const remote = new RemoteProvider(transport);
  assert.throws(() => remote.attach({ target: "  " }), /requires a target/);
  remote.attach({ target: "host-1" });
  assert.equal(remote.target(), "host-1");
  assert.match(remote.authorizeTarget("host-2")!, /does not match/);
  assert.equal(remote.authorizeTarget("host-1"), null);
  const result = await remote.execute({
    input: "uptime",
    target: "host-1",
    timeoutMs: 1000,
    signal: new AbortController().signal,
  });
  assert.equal(result.output, "ran uptime");
  assert.deepEqual(result.detail, { exitCode: 0 });
  assert.deepEqual(calls, [{ target: "host-1", command: "uptime" }]);
});

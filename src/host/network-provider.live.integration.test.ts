// Live integration test for the network provider's transport path: a real
// fetch through NetworkProvider.execute() against a real HTTP server. The
// server is loopback-only, so the administrator opt-in (allowPrivate) is used
// exactly as documented for lab/test deployments; the refusals below prove the
// same path still fails closed without that opt-in.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { NetworkProvider } from "./providers.ts";

function providerContext(target: string, timeoutMs = 5000) {
  return {
    input: target,
    target,
    timeoutMs,
    signal: new AbortController().signal,
  };
}

test("network provider performs a live fetch against an allowlisted local host", async () => {
  const server = http.createServer((req, res) => {
    if (req.url === "/api/test") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "success", message: "Live fetch works" }));
      return;
    }
    if (req.url === "/large") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("x".repeat(64 * 1024));
      return;
    }
    if (req.url === "/redirect") {
      res.writeHead(302, { Location: "http://example.com/escaped" });
      res.end();
      return;
    }
    res.writeHead(404);
    res.end("Not Found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    // The allowlist is exact-host; ports are not part of the host match, so a
    // local lab server is reached on its ephemeral port after the admin opted
    // in to private targets.
    const provider = new NetworkProvider();
    provider.attach({
      hosts: ["127.0.0.1"],
      allowPrivate: true,
      maxBytes: 1024,
      timeoutMs: 5000,
    });
    assert.equal(
      provider.authorizeTarget(`http://127.0.0.1:${port}/api/test`),
      null,
    );

    const result = await provider.execute(
      providerContext(`http://127.0.0.1:${port}/api/test`),
    );
    assert.equal(result.detail?.status, 200);
    assert.deepEqual(JSON.parse(result.output), {
      status: "success",
      message: "Live fetch works",
    });
    assert.equal(result.detail?.truncated, false);

    // Response-size cap is enforced on the live stream, not just in theory.
    const capped = await provider.execute(
      providerContext(`http://127.0.0.1:${port}/large`),
    );
    assert.equal(capped.detail?.bytes, 1024);
    assert.equal(capped.detail?.truncated, true);
    assert.equal(capped.output.length, 1024);

    // redirect: "manual" — a redirect cannot silently carry the body onward;
    // the provider reports it instead of following it.
    const redirected = await provider.execute(
      providerContext(`http://127.0.0.1:${port}/redirect`),
    );
    assert.equal(redirected.detail?.status, 302);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("network provider refusals still fail closed around the live path", () => {
  // Without the administrator opt-in, the same loopback target is refused at
  // authorization time — a live server existing locally grants nothing.
  const denied = new NetworkProvider();
  denied.attach({ hosts: ["127.0.0.1"] });
  assert.match(
    denied.authorizeTarget("http://127.0.0.1/")!,
    /private or loopback/,
  );

  // A port is not a host: an unlisted host is refused even with the opt-in.
  const provider = new NetworkProvider();
  provider.attach({ hosts: ["example.com"], allowPrivate: true });
  assert.match(
    provider.authorizeTarget("http://localhost/")!,
    /not in the attached allowlist/,
  );
});

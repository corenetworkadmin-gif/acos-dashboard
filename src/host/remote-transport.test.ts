import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { spawn } from "node:child_process";
import {
  SshRemoteTransport,
  isValidSshTarget,
} from "./providers/remote-transport.ts";
import { RemoteProvider } from "./providers.ts";

interface FakeChild {
  stdout: EventEmitter;
  stderr: EventEmitter;
  killed: boolean;
  kill: () => boolean;
  on: EventEmitter["on"];
  emit: EventEmitter["emit"];
}

function fakeChild(emitCloseOnKill = true): FakeChild {
  const emitter = new EventEmitter();
  const child: FakeChild = {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    killed: false,
    kill() {
      child.killed = true;
      if (emitCloseOnKill) setImmediate(() => emitter.emit("close", -1));
      return true;
    },
    on: emitter.on.bind(emitter),
    emit: emitter.emit.bind(emitter),
  };
  return child;
}

// The transport only touches stdout/stderr/on/kill, which this double
// provides; the cast keeps the production signature aligned with real spawn.
const asSpawn = (
  fn: (command: string, args: readonly string[]) => FakeChild,
): typeof spawn => fn as unknown as typeof spawn;

test("ssh targets are plain host/user@host and never option-like", () => {
  for (const target of ["host", "host.example.com", "user@host", "u1@10.0.0.1", "a_b.c-1"])
    assert.equal(isValidSshTarget(target), true, target);
  for (const target of [
    "",
    "-oProxyCommand=evil",
    "host name",
    "host;rm -rf /",
    "$(x)",
    "user@host@extra",
    "user@",
    "host:22",
  ])
    assert.equal(isValidSshTarget(target), false, target);
});

test("transport probe reflects an absent OpenSSH client and blocks execute", async () => {
  const transport = new SshRemoteTransport({
    sshPath: "/nonexistent/ssh",
    probeFn: () => false,
  });
  assert.deepEqual(transport.probe(), {
    available: false,
    reason: 'OpenSSH client "/nonexistent/ssh" is not available on this host.',
  });
  const provider = new RemoteProvider(transport);
  assert.equal(provider.probe().available, false);
  await assert.rejects(
    transport.execute({
      target: "host-1",
      command: "uptime",
      timeoutMs: 1000,
      signal: new AbortController().signal,
    }),
    /not available/,
  );
});

test("execute builds a shell-free ssh invocation and returns the result", async () => {
  const captured: { cmd?: string; args?: string[] } = {};
  const child = fakeChild();
  const transport = new SshRemoteTransport({
    probeFn: () => true,
    spawnFn: asSpawn((cmd, args) => {
      captured.cmd = cmd;
      captured.args = [...args];
      setImmediate(() => {
        child.stdout.emit("data", Buffer.from("up 3 days\n"));
        child.emit("close", 0);
      });
      return child;
    }),
  });
  const result = await transport.execute({
    target: "user@host-1",
    command: "uptime",
    timeoutMs: 5000,
    signal: new AbortController().signal,
  });
  assert.deepEqual(result, { output: "up 3 days\n", exitCode: 0 });
  assert.deepEqual(captured.args, [
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=5",
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    "LogLevel=ERROR",
    "user@host-1",
    "uptime",
  ]);
});

test("output beyond the cap is truncated and the process is killed", async () => {
  const child = fakeChild();
  const transport = new SshRemoteTransport({
    probeFn: () => true,
    maxBytes: 1024,
    spawnFn: asSpawn(() => {
      setImmediate(() => {
        child.stdout.emit("data", Buffer.alloc(4096, 0x41));
        // kill() emits close(-1) via the fake child.
      });
      return child;
    }),
  });
  const result = await transport.execute({
    target: "host-1",
    command: "yes",
    timeoutMs: 5000,
    signal: new AbortController().signal,
  });
  assert.equal(child.killed, true);
  assert.equal(result.output.length, 1024 + "\n[output truncated]".length);
  assert.ok(result.output.endsWith("[output truncated]"));
});

test("a command that exceeds its time budget is killed and rejects", async () => {
  const child = fakeChild();
  const transport = new SshRemoteTransport({
    probeFn: () => true,
    spawnFn: asSpawn(() => child),
  });
  await assert.rejects(
    transport.execute({
      target: "host-1",
      command: "sleep 9999",
      timeoutMs: 60,
      signal: new AbortController().signal,
    }),
    /budget/,
  );
  assert.equal(child.killed, true);
});

test("invalid targets and empty commands are refused before any spawn", async () => {
  let spawned = false;
  const transport = new SshRemoteTransport({
    probeFn: () => true,
    spawnFn: asSpawn(() => {
      spawned = true;
      return fakeChild();
    }),
  });
  await assert.rejects(
    transport.execute({
      target: "-oProxyCommand=evil",
      command: "uptime",
      timeoutMs: 1000,
      signal: new AbortController().signal,
    }),
    /refused before execution/,
  );
  await assert.rejects(
    transport.execute({
      target: "host-1",
      command: "   ",
      timeoutMs: 1000,
      signal: new AbortController().signal,
    }),
    /empty/,
  );
  assert.equal(spawned, false);
});

test("the default probe reports the host's real OpenSSH client honestly", () => {
  const probe = new SshRemoteTransport().probe();
  if (probe.available) assert.equal(probe.reason, null);
  else assert.match(probe.reason!, /not available/);
});

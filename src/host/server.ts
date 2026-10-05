import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { HostRuntime, envelope, samplePackage } from "./runtime.ts";
import { engineConfig, LocalEngine } from "./engine.ts";

const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("openAdmin") }).strict(),
  z.object({ type: z.literal("closeAdmin") }).strict(),
  z.object({ type: z.literal("isolate") }).strict(),
  z.object({ type: z.literal("releaseIsolation") }).strict(),
  z.object({ type: z.literal("cancel") }).strict(),
  z.object({ type: z.literal("clearConversation") }).strict(),
  z.object({ type: z.literal("confirmCompanionHome") }).strict(),
  z.object({ type: z.literal("completeOnboarding") }).strict(),
  z.object({ type: z.literal("reopenOnboarding") }).strict(),
  z
    .object({
      type: z.literal("scheduleTask"),
      name: z.string().trim().min(1).max(80),
      capability: z.string().max(80),
      action: z.string().max(32),
      target: z.string().max(100),
      input: z.string().max(4000).default(""),
      kind: z.enum(["interval", "event"]),
      intervalMs: z.number().int().positive().max(86_400_000).optional(),
      eventName: z.string().trim().max(80).optional(),
      idempotencyKey: z.string().trim().max(80).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("setScheduledEnabled"),
      id: z.string().max(64),
      enabled: z.boolean(),
    })
    .strict(),
  z.object({ type: z.literal("removeScheduled"), id: z.string().max(64) }).strict(),
  z
    .object({
      type: z.literal("emitEvent"),
      name: z.string().trim().min(1).max(80),
      detail: z.string().max(200).default(""),
    })
    .strict(),
  z.object({ type: z.literal("runScheduled") }).strict(),
  z.object({ type: z.literal("recover") }).strict(),
  z.object({ type: z.literal("verifyStorage") }).strict(),
  z.object({ type: z.literal("pause"), paused: z.boolean() }).strict(),
  z
    .object({
      type: z.literal("mode"),
      mode: z.enum(["SAFE", "INTERMEDIATE", "ADVANCED"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("capability"),
      id: z.string().max(80),
      enabled: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("attachProvider"),
      capability: z.string().max(80),
      config: z.unknown(),
    })
    .strict(),
  z
    .object({
      type: z.literal("detachProvider"),
      capability: z.string().max(80),
    })
    .strict(),
  z.object({ type: z.literal("probeProviders") }).strict(),
  z
    .object({
      type: z.literal("installExtension"),
      manifest: z.unknown(),
    })
    .strict(),
  z
    .object({
      type: z.literal("removeExtension"),
      id: z.string().max(80),
    })
    .strict(),
  z
    .object({ type: z.literal("engine"), status: z.enum(["READY", "STOPPED"]) })
    .strict(),
  z
    .object({
      type: z.literal("rename"),
      name: z.string().trim().min(1).max(80),
    })
    .strict(),
  z
    .object({
      type: z.literal("run"),
      capability: z.string().max(80),
      action: z.string().max(32),
      target: z.string().max(100),
      input: z.string().max(4000).default(""),
    })
    .strict(),
  z.object({ type: z.literal("inspectImport"), package: z.unknown() }).strict(),
  z
    .object({
      type: z.literal("import"),
      package: z.unknown(),
      replace: z.boolean(),
    })
    .strict(),
]);
async function body(req: IncomingMessage) {
  if (!req.headers["content-type"]?.startsWith("application/json"))
    throw new Error("Content-Type must be application/json");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 550_000) throw new Error("Request too large");
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
const equal = (a: string, b: string) =>
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
export function createHostServer(runtime: HostRuntime, key: string) {
  let session: { token: string; expires: number } | null = null;
  let attempts = 0,
    retryAt = 0;
  const view = () => {
    const state = runtime.snapshot();
    return state.adminOpen
      ? state
      : { ...state, operations: [], activity: [], imports: [] };
  };
  const server = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      const send = (code: number, value: unknown) => {
        res.statusCode = code;
        res.end(JSON.stringify(value));
      };
      try {
        // Same-origin requests only; JSON + Origin check prevents form CSRF and browser cross-origin writes.
        const host = req.headers.host ?? "";
        const allowed = new Set([
          "localhost",
          "127.0.0.1",
          "[::1]",
          ...(process.env.ACOS_ALLOWED_HOSTS ?? "").split(",").filter(Boolean),
        ]);
        const hostname = new URL("http://" + host).hostname;
        if (!allowed.has(hostname))
          return send(403, { error: "Host is not allowed" });
        if (req.headers.origin && new URL(req.headers.origin).host !== host)
          return send(403, { error: "Origin is not allowed" });
        if (req.method === "GET" && req.url === "/api/health")
          return send(200, { status: "ok", service: "acos-host" });
        if (req.method === "POST" && req.url === "/api/login") {
          if (Date.now() < retryAt)
            return send(429, {
              error: "Too many attempts. Try again in a minute.",
            });
          const credentials = z
            .object({ key: z.string().max(128) })
            .strict()
            .parse(await body(req));
          if (!equal(credentials.key, key)) {
            if (++attempts >= 5) {
              retryAt = Date.now() + 60_000;
              attempts = 0;
            }
            return send(401, { error: "Invalid administrator key" });
          }
          if (session) await runtime.sessionExpired();
          attempts = 0;
          session = {
            token: randomBytes(32).toString("hex"),
            expires: Date.now() + 8 * 60 * 60_000,
          };
          res.setHeader(
            "Set-Cookie",
            `acos_session=${session.token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=28800`,
          );
          return send(200, { success: true });
        }
        const token =
          req.headers.cookie
            ?.split(";")
            .map((c) => c.trim())
            .find((c) => c.startsWith("acos_session="))
            ?.slice(13) ?? "";
        if (
          !session ||
          session.expires < Date.now() ||
          !equal(token, session.token)
        )
          return send(401, {
            error: "Unlock the host with your administrator key.",
          });
        if (req.method === "GET" && req.url === "/api/state")
          return send(200, view());
        if (req.method === "GET" && req.url === "/api/relocation-example")
          return send(200, envelope(samplePackage));
        if (req.method === "POST" && req.url === "/api/logout") {
          session = null;
          await runtime.sessionExpired();
          res.setHeader(
            "Set-Cookie",
            "acos_session=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0",
          );
          return send(200, { success: true });
        }
        // Server-Sent Events streaming for chat.send. Runs the same admission and
        // authorization pipeline; tokens are delivered as they are generated.
        if (req.method === "POST" && req.url === "/api/stream") {
          const authenticatedSession = session;
          const request = z
            .object({
              capability: z.string().max(80),
              action: z.string().max(32),
              target: z.string().max(100),
              input: z.string().max(4000).default(""),
              tools: z.boolean().default(false),
            })
            .strict()
            .parse(await body(req));
          if (session !== authenticatedSession || session.expires < Date.now())
            return send(401, {
              error: "Session ended while receiving this request.",
            });
          if (request.tools && request.capability !== "chat.send")
            return send(400, {
              error: "Tool-mediated chat is only available for chat.send.",
            });
          res.statusCode = 200;
          res.setHeader("Content-Type", "text/event-stream");
          res.setHeader("Cache-Control", "no-store");
          res.setHeader("Connection", "keep-alive");
          res.setHeader("X-Accel-Buffering", "no");
          const write = (event: string, data: unknown) => {
            res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
          };
          let finished = false;
          // A disconnected client cancels the in-flight isolated process.
          res.on("close", () => {
            if (!finished) void runtime.cancel();
          });
          try {
            if (request.tools) {
              await runtime.runChatWithTools(request.input, (event) => {
                if (event.type === "token") write("token", { text: event.text });
                else if (event.type === "tool")
                  write("tool", {
                    name: event.name,
                    arguments: event.arguments,
                  });
                else if (event.type === "tool_result")
                  write("tool_result", {
                    name: event.name,
                    result: event.result,
                  });
                else
                  write("tool_denied", {
                    name: event.name,
                    reason: event.reason,
                  });
              });
            } else {
              await runtime.runStreaming(
                request.capability,
                request.action,
                request.target,
                request.input,
                (text) => write("token", { text }),
              );
            }
            write("done", { state: view() });
          } catch (error) {
            write("error", {
              error: error instanceof Error ? error.message : "Stream failed",
              state: view(),
            });
          } finally {
            finished = true;
            res.end();
          }
          return;
        }
        if (req.method !== "POST" || req.url !== "/api/command")
          return send(404, { error: "Endpoint not found" });
        const authenticatedSession = session;
        const command = commandSchema.parse(await body(req));
        if (session !== authenticatedSession || session.expires < Date.now())
          return send(401, {
            error: "Session ended while receiving this request.",
          });
        let result: unknown;
        switch (command.type) {
          case "openAdmin":
            result = await runtime.openAdmin();
            break;
          case "closeAdmin":
            result = runtime.closeAdmin();
            break;
          case "isolate":
            result = await runtime.isolate();
            break;
          case "releaseIsolation":
            result = runtime.releaseIsolation();
            break;
          case "cancel":
            result = await runtime.cancel();
            break;
          case "pause":
            result = await runtime.setPaused(command.paused);
            break;
          case "mode":
            result = runtime.setMode(command.mode);
            break;
          case "capability":
            result = runtime.setCapability(command.id, command.enabled);
            break;
          case "attachProvider":
            result = runtime.attachProvider(command.capability, command.config);
            break;
          case "detachProvider":
            result = runtime.detachProvider(command.capability);
            break;
          case "probeProviders":
            result = runtime.probeProviders();
            break;
          case "installExtension":
            result = runtime.installExtension(command.manifest);
            break;
          case "removeExtension":
            result = runtime.removeExtension(command.id);
            break;
          case "engine":
            result = await runtime.setEngine(command.status);
            break;
          case "rename":
            result = runtime.rename(command.name);
            break;
          case "clearConversation":
            result = runtime.clearConversation();
            break;
          case "confirmCompanionHome":
            result = runtime.confirmCompanionHome();
            break;
          case "completeOnboarding":
            result = runtime.completeOnboarding();
            break;
          case "reopenOnboarding":
            result = runtime.reopenOnboarding();
            break;
          case "scheduleTask":
            result = runtime.scheduleTask({
              name: command.name,
              capability: command.capability,
              action: command.action,
              target: command.target,
              input: command.input,
              kind: command.kind,
              intervalMs: command.intervalMs,
              eventName: command.eventName,
              idempotencyKey: command.idempotencyKey,
            });
            break;
          case "setScheduledEnabled":
            result = runtime.setScheduledEnabled(command.id, command.enabled);
            break;
          case "removeScheduled":
            result = runtime.removeScheduled(command.id);
            break;
          case "emitEvent":
            result = await runtime.emitEvent(command.name, command.detail);
            break;
          case "runScheduled":
            result = await runtime.runScheduled();
            break;
          case "recover":
            result = runtime.recover();
            break;
          case "verifyStorage":
            result = runtime.verifyStorage();
            break;
          case "run":
            result = await runtime.run(
              command.capability,
              command.action,
              command.target,
              command.input,
            );
            break;
          case "inspectImport":
            result = runtime.inspectImport(command.package);
            break;
          case "import":
            result = runtime.importCompanion(command.package, command.replace);
            break;
        }
        send(200, { result: result ?? null, state: view() });
      } catch (error) {
        send(400, {
          error: error instanceof Error ? error.message : "Request failed",
        });
      }
    },
  );
  const expiry = setInterval(() => {
    if (session && session.expires < Date.now()) {
      session = null;
      void runtime.sessionExpired().catch(() => server.close());
    }
  }, 30_000);
  expiry.unref();
  server.on("close", () => clearInterval(expiry));
  return server;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (process.getuid?.() === 0)
    throw new Error(
      "Run the ACOS host as a dedicated unprivileged user, never root.",
    );
  process.umask(0o077);
  const directory =
    process.env.ACOS_DATA_DIR ?? path.join(homedir(), ".local/share/acos");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const keyPath = path.join(directory, "admin.key");
  if (!existsSync(keyPath))
    writeFileSync(keyPath, randomBytes(32).toString("hex"), {
      mode: 0o600,
      flag: "wx",
    });
  chmodSync(keyPath, 0o600);
  const key = readFileSync(keyPath, "utf8").trim();
  if (!/^[a-f0-9]{64}$/.test(key))
    throw new Error(
      "Administrator key file is malformed. Restore the trusted key before startup.",
    );
  const runtime = new HostRuntime(directory, new LocalEngine(engineConfig()));
  runtime.startScheduler();
  const server = createHostServer(
    runtime,
    readFileSync(keyPath, "utf8").trim(),
  );
  server.requestTimeout = 150_000;
  server.listen(Number(process.env.ACOS_PORT ?? 4317), "127.0.0.1", () =>
    console.log(
      `ACOS host ready on loopback port ${process.env.ACOS_PORT ?? 4317}. Administrator key file: ${keyPath}`,
    ),
  );
  for (const signal of ["SIGTERM", "SIGINT"])
    process.on(signal, () => {
      server.close();
      void runtime.shutdown().finally(() => process.exit(0));
    });
}

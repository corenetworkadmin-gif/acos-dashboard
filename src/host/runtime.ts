import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, realpathSync, existsSync } from "node:fs";
import path from "node:path";
import {
  capabilityReason,
  capabilityDefinitions,
  initialState,
  relocationSchema,
  savedSchema,
} from "../runtime/model.ts";
import type {
  ImportReport,
  Mode,
  Operation,
  OperationStatus,
  RelocationPackage,
  RuntimeState,
} from "../runtime/model.ts";
import { LocalEngine } from "./engine.ts";

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const samplePackage: RelocationPackage = {
  protocolVersion: "1.0",
  companion: { id: "atlas-relocated", name: "Atlas", version: "1.0.0" },
  state: {
    memories: [
      "My purpose is to help organize ideas and support thoughtful work.",
    ],
    personality: "Calm, curious, and practical.",
  },
  capabilities: ["chat.send", "home.read", "home.write"],
  dependencies: [],
  source: "Example relocation package",
};
export const envelope = (payload: RelocationPackage) => ({
  payload,
  sha256: digest(JSON.stringify(payload)),
});
export class HostRuntime {
  private db: DatabaseSync;
  private state: RuntimeState;
  private pending: Promise<unknown> | null = null;
  private stopping = false;
  private loading = false;
  private loadJob: Promise<void> | null = null;
  private loadCancelled = false;
  private cancelled = false;
  engine: LocalEngine;
  constructor(directory: string, engine: LocalEngine) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    this.engine = engine;
    engine.dataDirectory = directory;
    engine.privateDirectory = directory;
    engine.discover();
    if (engine.config) {
      const privateDir = realpathSync(directory);
      const engineDir = existsSync(path.dirname(engine.config.binary))
        ? realpathSync(path.dirname(engine.config.binary))
        : path.resolve(path.dirname(engine.config.binary));
      if (
        privateDir === engineDir ||
        privateDir.startsWith(engineDir + path.sep) ||
        engineDir.startsWith(privateDir + path.sep)
      )
        throw new Error(
          "Engine installation must be separate from private host data.",
        );
    }
    this.db = new DatabaseSync(path.join(directory, "acos.sqlite"));
    chmodSync(path.join(directory, "acos.sqlite"), 0o600);
    this.db.exec(
      "PRAGMA locking_mode=EXCLUSIVE; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, event TEXT NOT NULL, previous TEXT NOT NULL, hash TEXT NOT NULL); CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, companion TEXT NOT NULL, value TEXT NOT NULL);",
    );
    try {
      let previous = "";
      for (const row of this.db
        .prepare("SELECT * FROM audit ORDER BY id")
        .all()) {
        if (
          row.previous !== previous ||
          row.hash !== digest(previous + row.event)
        )
          throw new Error(
            "Audit chain verification failed; recovery required.",
          );
        previous = row.hash as string;
      }
      const row = this.db.prepare("SELECT value FROM state WHERE id=1").get();
      this.state = row
        ? (savedSchema.parse(JSON.parse(row.value as string)) as RuntimeState)
        : initialState();
      // Restore policy choices only. Saved metadata cannot attach/register a provider.
      const persisted = this.state.capabilities;
      this.state.capabilities = capabilityDefinitions().map((definition) => {
        const saved = persisted.filter((cap) => cap.id === definition.id);
        return {
          ...definition,
          enabled: definition.configurable
            ? definition.attached && saved.length === 1 && saved[0].enabled
            : definition.enabled,
        };
      });
      if (JSON.stringify(persisted) !== JSON.stringify(this.state.capabilities))
        this.state.policyVersion++;
      this.state.adminOpen = false;
      this.state.engine = "STOPPED";
      this.state.operations = this.state.operations.map((op) =>
        ["COMPLETED", "DENIED", "CANCELLED", "FAILED", "TIMEOUT"].includes(
          op.status,
        )
          ? op
          : {
              ...op,
              status: "CANCELLED",
              events: [
                ...op.events,
                {
                  timestamp: Date.now(),
                  state: "CANCELLED",
                  description:
                    "Host restart: orphaned operation cancelled; isolated process reservations released.",
                },
              ],
            },
      );
      this.save(
        "Host started; audit chain verified, interrupted operations reconciled, engine requires verification.",
      );
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  private currentCapabilities() {
    return this.state.capabilities.map((cap) => {
      const available =
        cap.attached &&
        cap.available &&
        (cap.id !== "chat.send" ||
          (this.state.engine === "READY" && this.engine.verified));
      return {
        ...cap,
        available,
        availabilityReason: !cap.attached
          ? "No governed provider is attached."
          : !available
            ? cap.id === "chat.send"
              ? "Local engine is not ready. Verify and load a model first."
              : "Attached provider is unavailable."
            : null,
      };
    });
  }
  snapshot() {
    return {
      ...this.state,
      capabilities: this.currentCapabilities().map((cap) => {
        const reason = capabilityReason(this.state, cap);
        return { ...cap, authorization: { allowed: reason === null, reason } };
      }),
      host: {
        connected: true,
        platform: process.platform,
        model: this.engine.config
          ? path.basename(this.engine.config.model)
          : null,
        modelHash: this.engine.verified ? this.engine.config?.sha256 : null,
        isolation: this.engine.verified ? "VERIFIED" : "NOT_VERIFIED",
        busy: !!this.pending || this.loading,
        completedOperations: this.state.operations.filter(
          (op) => op.status === "COMPLETED",
        ).length,
        contextLimit: this.engine.config?.context ?? 4096,
        maxOutputTokens: this.engine.config?.maxTokens ?? 256,
        memoryReservation: this.engine.reservation?.memoryBytes ?? 0,
        hardware: this.engine.hardware,
        compute: this.engine.lastPlan,
        providers: [
          {
            backend: "cpu",
            architectures: ["x64", "arm64"],
            status:
              "Requires configured compatible binary/model and successful load",
          },
        ],
        engineError: this.engineError,
      },
    };
  }
  engineError: string | null = null;
  private save(description: string) {
    const entry = { id: randomUUID(), timestamp: Date.now(), description };
    this.state.activity = [entry, ...this.state.activity].slice(0, 200);
    try {
      this.db.exec("BEGIN IMMEDIATE");
      const previous =
        (this.db
          .prepare("SELECT hash FROM audit ORDER BY id DESC LIMIT 1")
          .get()?.hash as string) ?? "";
      const event = JSON.stringify(entry);
      this.db
        .prepare("INSERT INTO audit(event,previous,hash) VALUES(?,?,?)")
        .run(event, previous, digest(previous + event));
      for (const message of this.state.messages)
        this.db
          .prepare(
            "INSERT OR IGNORE INTO messages(id,companion,value) VALUES(?,?,?)",
          )
          .run(message.id, this.state.companion.id, JSON.stringify(message));
      this.db
        .prepare(
          "INSERT INTO state(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
        )
        .run(JSON.stringify(this.state));
      this.db.exec("COMMIT");
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* No transaction may have opened. */
      }
      // Storage failure is a host failure: stop execution and prevent further admissions.
      this.stopping = true;
      this.state.paused = true;
      this.engine.cancel();
      throw error;
    }
  }
  private requireAdmin() {
    if (!this.state.adminOpen || this.stopping)
      throw new Error("An active administrator session is required.");
  }
  private requireIdle() {
    if (this.pending || this.loading)
      throw new Error("Wait for the current engine operation to finish.");
  }
  async openAdmin() {
    this.state.adminOpen = true; // Block new admissions before draining the active process.
    await this.cancel();
    this.save(
      "Administrator interlock verified: no active process; new admissions blocked.",
    );
  }
  closeAdmin() {
    this.requireIdle();
    this.state.adminOpen = false;
    this.save("Administrator session closed. Previous pause state restored.");
  }
  async sessionExpired() {
    this.state.paused = true;
    await this.cancel();
    this.state.adminOpen = false;
    this.save("Session ended. Companion paused.");
  }
  setPaused(paused: boolean) {
    if (this.state.adminOpen)
      throw new Error("Close administrator controls first.");
    if (this.state.emergency && !paused)
      throw new Error("Release emergency isolation in Settings first.");
    this.state.paused = paused;
    this.save(paused ? "Companion paused." : "Companion resumed.");
    if (paused) return this.cancel();
  }
  async isolate() {
    this.state.emergency = true;
    this.state.paused = true;
    this.state.engine = "STOPPED";
    await this.cancel();
    this.save(
      "Emergency isolation engaged. Engine stopped; resources released.",
    );
  }
  releaseIsolation() {
    this.requireAdmin();
    this.state.emergency = false;
    this.save("Isolation released. Companion remains paused.");
  }
  setMode(mode: Mode) {
    this.requireAdmin();
    this.state.mode = mode;
    this.state.policyVersion++;
    this.save(`Operating mode changed to ${mode}. No new authority granted.`);
  }
  setCapability(id: string, enabled: boolean) {
    this.requireAdmin();
    this.requireIdle();
    const cap = this.state.capabilities.find((c) => c.id === id);
    if (!cap) throw new Error("Unknown capability; policy was not changed.");
    if (!cap.configurable)
      throw new Error("This capability has a fixed host policy.");
    if (enabled && (!cap.attached || !cap.available))
      throw new Error(
        "Provider is unavailable or not attached. Attach a governed provider before enabling this capability.",
      );
    if (cap.enabled === enabled) return;
    const previous = {
      enabled: cap.enabled,
      version: this.state.policyVersion,
    };
    cap.enabled = enabled;
    this.state.policyVersion++;
    try {
      this.save(
        `${id} ${enabled ? "enabled" : "disabled"} by administrator policy v${this.state.policyVersion}.`,
      );
    } catch (error) {
      cap.enabled = previous.enabled;
      this.state.policyVersion = previous.version;
      throw error;
    }
  }
  rename(name: string) {
    this.requireAdmin();
    this.state.companion.name = name;
    this.save("Companion display name updated.");
  }
  clearConversation() {
    this.requireAdmin();
    this.state.messages = [];
    this.save("Active conversation cleared. Durable memories preserved.");
  }
  async setEngine(status: "READY" | "STOPPED") {
    this.requireAdmin();
    this.requireIdle();
    if (status === "STOPPED") {
      this.state.engine = "STOPPED";
      this.engine.verified = false;
      this.save("Local engine unloaded. Companion state preserved.");
      return;
    }
    if (this.state.emergency)
      throw new Error("Release emergency isolation first.");
    this.loading = true;
    this.loadCancelled = false;
    this.engineError = null;
    this.loadJob = (async () => {
      try {
        await this.engine.verify();
        if (this.loadCancelled) throw new Error("Engine loading cancelled.");
        // Actually load model and tokenizer within the sandbox, rather than equating a file with readiness.
        await this.engine.infer(
          "<|im_start|>user\nSay ready.<|im_end|>\n<|im_start|>assistant\n",
          8,
        );
        if (this.loadCancelled || this.state.emergency || !this.state.adminOpen)
          throw new Error("Engine loading interrupted by host state change.");
        this.state.engine = "READY";
        this.save(
          "Model SHA-256 verified; isolated model/tokenizer load and inference health check passed.",
        );
      } catch (error) {
        this.state.engine = "STOPPED";
        this.engine.verified = false;
        this.engineError =
          error instanceof Error ? error.message : "Engine failed";
        this.save("Engine health check failed; execution remains disabled.");
        throw error;
      } finally {
        this.loading = false;
      }
    })();
    try {
      await this.loadJob;
    } finally {
      this.loadJob = null;
    }
  }
  async cancel() {
    this.cancelled = true;
    this.loadCancelled = true;
    this.engine.cancel();
    await Promise.allSettled([this.pending, this.loadJob]);
  }
  async run(capability: string, action: string, target: string, input = "") {
    if (this.pending || this.loading)
      throw new Error("A local engine operation is already active.");
    const op: Operation = {
      id: randomUUID(),
      timestamp: Date.now(),
      capability,
      action,
      target,
      policyVersion: this.state.policyVersion,
      companionId: this.state.companion.id,
      status: "REQUESTED",
      events: [],
    };
    this.state.operations = [op, ...this.state.operations].slice(0, 200);
    const transition = (status: OperationStatus, description: string) => {
      op.status = status;
      op.events.push({ timestamp: Date.now(), state: status, description });
      this.save(`${op.id}: ${description}`);
    };
    transition("REQUESTED", "Request received.");
    transition(
      "VALIDATING",
      "Validating target, capability, policy, and resource requirements.",
    );
    const cap = this.currentCapabilities().find((c) => c.id === capability);
    const actions: Record<string, string> = {
      "chat.send": "send",
      "home.read": "read",
      "home.write": "write",
    };
    let reason = this.stopping
      ? "Host is stopping"
      : cap
        ? capabilityReason(this.state, cap)
        : "Unknown capability; authorization failed closed";
    if (!reason && (actions[capability] !== action || target !== cap?.target))
      reason = "Action or target does not match the capability contract";
    if (!reason && capability === "chat.send" && this.state.engine !== "READY")
      reason = "Local engine is not ready. Verify and load a model first.";
    if (!reason && capability !== "home.read" && !input.trim())
      reason = "Input is empty";
    if (
      !reason &&
      capability === "home.write" &&
      this.state.companion.memories.length >= 100
    )
      reason = "Home memory budget reached (100 notes).";
    if (reason) {
      transition("DENIED", reason);
      throw new Error(reason);
    }
    transition("AUTHORIZED", `Authorized under policy v${op.policyVersion}.`);
    transition(
      "ADMITTED",
      "Exclusive inference slot and bounded process memory reserved.",
    );
    this.cancelled = false;
    const execute = async () => {
      try {
        if (
          op.policyVersion !== this.state.policyVersion ||
          capabilityReason(this.state, cap!)
        )
          throw new Error("Final authorization changed.");
        transition(
          "RUNNING",
          "Final authorization verified; execution started.",
        );
        if (capability === "home.write")
          this.state.companion.memories.push(input.trim());
        if (capability === "chat.send") {
          const prompt = this.prompt(input);
          const response = await this.engine.infer(prompt);
          if (this.cancelled || this.state.adminOpen || this.state.emergency)
            throw new Error("Inference cancelled.");
          this.state.messages = [
            ...this.state.messages,
            {
              id: randomUUID(),
              timestamp: Date.now(),
              role: "user" as const,
              text: input.trim(),
            },
            {
              id: randomUUID(),
              timestamp: Date.now(),
              role: "assistant" as const,
              text: response,
            },
          ].slice(-100);
        }
        transition(
          "COMPLETING",
          "Result persisted; process finished; resource reservation released.",
        );
        transition("COMPLETED", "Operation completed.");
        return capability === "home.read" ? this.state.companion.memories : op;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Execution failed";
        transition(
          this.cancelled
            ? "CANCELLED"
            : /timed out/.test(message)
              ? "TIMEOUT"
              : "FAILED",
          message + " Resources released.",
        );
        throw error;
      }
    };
    this.pending = execute();
    try {
      return await this.pending;
    } finally {
      this.pending = null;
    }
  }
  private prompt(input: string) {
    const cap = this.currentCapabilities().find((c) => c.id === "home.read")!;
    const memories = capabilityReason(this.state, cap)
      ? ""
      : this.state.companion.memories.slice(-5).join("\n").slice(0, 700);
    // Qwen/ChatML contract; other templates require a registered compatible adapter.
    const system = `You are ${this.state.companion.name}, an AI companion hosted by ACOS. You have no direct tools or authority. Be concise. ${this.state.companion.personality.slice(0, 400)}\nAuthorized memories: ${memories}`;
    let history = this.state.messages.slice(-12);
    const format = () =>
      `<|im_start|>system\n${system}<|im_end|>\n${history.map((m) => `<|im_start|>${m.role}\n${m.text}<|im_end|>\n`).join("")}<|im_start|>user\n${input}<|im_end|>\n<|im_start|>assistant\n`;
    const budget = (this.engine.config?.context ?? 4096) - 384;
    while (history.length && Buffer.byteLength(format()) > budget)
      history = history.slice(2);
    return format();
  }
  inspectImport(raw: unknown) {
    if (
      !raw ||
      typeof raw !== "object" ||
      !("payload" in raw) ||
      !("sha256" in raw) ||
      typeof raw.sha256 !== "string"
    )
      throw new Error(
        "Expected a relocation envelope with payload and sha256.",
      );
    if (digest(JSON.stringify(raw.payload)) !== raw.sha256)
      throw new Error("Package checksum mismatch.");
    const pkg = relocationSchema.parse(raw.payload);
    const capabilities = pkg.capabilities.map((name) => {
      const cap = this.currentCapabilities().find((c) => c.id === name);
      return {
        name,
        status: !cap
          ? "Unavailable"
          : !cap.available
            ? "Provider missing"
            : !cap.enabled
              ? "Disabled by policy"
              : "Enabled; operation authorization required",
      };
    });
    const issues = [
      "Package checksum verified. Source identity is self-declared; only supplied memories and personality can be reconstructed.",
    ];
    const prohibited = pkg.capabilities.filter((name) =>
      /financ|bank|payment|wallet|trading|crypto|replicat|propagat/i.test(name),
    );
    const unresolved = pkg.dependencies.filter(
      (name) =>
        name !== "acos.home.v1" &&
        !(name === "acos.local.v1" && this.engine.verified),
    );
    if (prohibited.length)
      issues.push(`Prohibited authority requests: ${prohibited.join(", ")}.`);
    if (unresolved.length)
      issues.push(
        `Unresolved mandatory dependencies: ${unresolved.join(", ")}.`,
      );
    const missing = capabilities.some((c) => !c.status.startsWith("Enabled"));
    if (missing)
      issues.push(
        "Declared capabilities will not be granted by import. Review the current policy after relocation.",
      );
    const report: ImportReport = {
      id: randomUUID(),
      timestamp: Date.now(),
      name: pkg.companion.name,
      status:
        prohibited.length || unresolved.length
          ? "IMPORT_FAILED"
          : missing
            ? "RECONSTRUCTED_WITH_UNRESOLVED_DEPENDENCIES"
            : "PARTIALLY_RECONSTRUCTED",
      issues,
      capabilities,
    };
    return { package: pkg, report };
  }
  importCompanion(raw: unknown, replace: boolean) {
    this.requireAdmin();
    this.requireIdle();
    if (!replace)
      throw new Error(
        "Confirm replacement and trust the package source before importing.",
      );
    const { package: pkg, report } = this.inspectImport(raw);
    this.state.imports = [report, ...this.state.imports].slice(0, 30);
    if (report.status === "IMPORT_FAILED") {
      this.save("Relocation rejected. Current companion preserved.");
      return report;
    }
    this.state.companion = {
      id: pkg.companion.id,
      name: pkg.companion.name,
      personality: pkg.state.personality,
      memories: pkg.state.memories,
      source: pkg.source,
      created: Date.now(),
    };
    this.state.messages = [];
    this.state.paused = true;
    this.state.engine = "STOPPED";
    this.engine.verified = false;
    this.save(
      "Relocation committed atomically; one companion replaced, no authority granted, paused pending review.",
    );
    return report;
  }
  async shutdown() {
    this.stopping = true;
    await this.cancel();
    this.db.close();
  }
}

import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  realpathSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  decryptValue,
  encryptValue,
  generateStorageKey,
  isEncrypted,
  storageFingerprint,
} from "./crypto.ts";
import {
  capabilityReason,
  capabilityDefinitions,
  initialState,
  relocationSchema,
  savedSchema,
} from "../runtime/model.ts";
import type {
  Capability,
  ImportReport,
  Mode,
  Operation,
  OperationStatus,
  RelocationPackage,
  RuntimeState,
} from "../runtime/model.ts";
import { LocalEngine } from "./engine.ts";
import {
  parseToolCalls,
  stripToolCalls,
  toolDefinitions,
  toolInput,
  toolPromptSection,
} from "./tools.ts";
import {
  dueIntervalTasks,
  eventTasks,
  idempotencyDigest,
  nextIntervalRun,
  reconcileJournal,
} from "./scheduler.ts";
import {
  ProviderRegistry,
  defaultProviders,
  type ProviderContext,
  type ProviderResult,
} from "./providers.ts";
import {
  ExtensionRegistry,
  detectEscalation,
  type ExtensionInstallReport,
  type InstalledExtension,
} from "./extensions.ts";
import type {
  EventRecord,
  IdempotencyRecord,
  JournalEntry,
  JournalMarker,
  RecoveryAction,
  ScheduleKind,
  ScheduledTask,
} from "./scheduler.ts";

// Options for an operation request. Idempotency keys let a retry (lost response,
// restart, timeout) collapse onto the original result instead of executing twice.
export interface RunOptions {
  idempotencyKey?: string;
  source?: "interactive" | "scheduled" | "event" | "recovery";
}
// Capabilities whose completion mutates durable companion state and therefore
// write recovery-journal markers around their side effects.
const durableCapabilities = new Set(["home.write", "chat.send"]);

// Bounded wall-clock budget for a provider-backed request (network, device,
// remote). Providers may apply a tighter cap of their own.
const PROVIDER_TIMEOUT_MS = 30_000;

// Events emitted by tool-mediated chat. The UI renders tokens, tool requests and
// their mediated results; denials are surfaced honestly rather than hidden.
export type ChatEvent =
  | { type: "token"; text: string }
  | { type: "tool"; name: string; arguments: Record<string, unknown> }
  | { type: "tool_result"; name: string; result: unknown }
  | { type: "tool_denied"; name: string; reason: string };

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
  private scheduled: ScheduledTask[] = [];
  private events: EventRecord[] = [];
  private journal: JournalEntry[] = [];
  private idempotency = new Map<string, IdempotencyRecord>();
  private recovery: RecoveryAction[] = [];
  private recoveryRequired = false;
  private schedulerTimer: ReturnType<typeof setInterval> | null = null;
  private storageKey!: Buffer;
  private storageMigrated = false;
  private storageIntegrity: "VERIFIED" | "FAILED" = "VERIFIED";
  // Governed capability providers and the extension registry. Both are injected
  // so tests can supply device/remote bridges; production uses the defaults,
  // which leave device and remote providers unavailable until a component exists.
  private providers: ProviderRegistry;
  private extensions = new ExtensionRegistry();
  // Aborts an in-flight provider request on cancellation.
  private providerAbort: AbortController | null = null;
  engine: LocalEngine;
  constructor(
    directory: string,
    engine: LocalEngine,
    options: { providers?: ProviderRegistry } = {},
  ) {
    this.providers = options.providers ?? new ProviderRegistry(defaultProviders());
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    // Host storage key (architecture 17). Generated once, stored 0600, separate
    // from the sealed data, and never placed into AI context.
    const storageKeyPath = path.join(directory, "storage.key");
    if (existsSync(storageKeyPath)) {
      const raw = readFileSync(storageKeyPath, "utf8").trim();
      if (!/^[a-f0-9]{64}$/.test(raw))
        throw new Error(
          "Storage key file is malformed. Restore the trusted key before startup.",
        );
      this.storageKey = Buffer.from(raw, "hex");
    } else {
      this.storageKey = generateStorageKey();
      writeFileSync(storageKeyPath, this.storageKey.toString("hex"), {
        mode: 0o600,
        flag: "wx",
      });
    }
    chmodSync(storageKeyPath, 0o600);
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
      "PRAGMA locking_mode=EXCLUSIVE; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, event TEXT NOT NULL, previous TEXT NOT NULL, hash TEXT NOT NULL); CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, companion TEXT NOT NULL, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS scheduled (id TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS journal (id TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS idempotency (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
    );
    try {
      let previous = "";
      for (const row of this.db
        .prepare("SELECT * FROM audit ORDER BY id")
        .all()) {
        // Audit events are sealed at rest. A decryption failure is treated exactly
        // like a broken chain: startup fails closed rather than trusting tampered data.
        const rawEvent = row.event as unknown as string;
        let event: string;
        try {
          event = isEncrypted(rawEvent)
            ? decryptValue(this.storageKey, rawEvent, "audit")
            : rawEvent;
        } catch {
          throw new Error("Audit chain verification failed; recovery required.");
        }
        if (row.previous !== previous || row.hash !== digest(previous + event))
          throw new Error(
            "Audit chain verification failed; recovery required.",
          );
        previous = row.hash as string;
      }
      const row = this.db.prepare("SELECT value FROM state WHERE id=1").get();
      if (row) {
        const parsed = JSON.parse(row.value as string) as Record<string, unknown>;
        this.state = savedSchema.parse(
          this.unsealState(parsed),
        ) as RuntimeState;
      } else {
        this.state = initialState();
      }
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
      // Durable scheduler/event state, recovery journal and idempotency records.
      this.scheduled = this.db
        .prepare("SELECT value FROM scheduled ORDER BY rowid DESC")
        .all()
        .map((row) => JSON.parse(row.value as string) as ScheduledTask);
      this.events = this.db
        .prepare("SELECT value FROM events ORDER BY rowid DESC LIMIT 200")
        .all()
        .map((row) => JSON.parse(row.value as string) as EventRecord);
      this.journal = this.db
        .prepare("SELECT value FROM journal ORDER BY rowid DESC LIMIT 400")
        .all()
        .map((row) => JSON.parse(row.value as string) as JournalEntry);
      for (const row of this.db
        .prepare("SELECT key, value FROM idempotency")
        .all())
        this.idempotency.set(
          row.key as string,
          JSON.parse(row.value as string) as IdempotencyRecord,
        );
      // Reconcile the recovery journal before admitting any new work. Ambiguous
      // outcomes fail closed: the companion stays paused until an administrator
      // resolves them. Roll-forward/rollback reuse current authority only.
      this.recovery = reconcileJournal(this.journal);
      for (const action of this.recovery) {
        if (action.decision === "RECOVERY_REQUIRED") this.recoveryRequired = true;
        else this.resolveJournal(action.operationId);
      }
      for (const [key, record] of this.idempotency)
        if (record.status === "RUNNING") {
          record.status = "RECOVERY_REQUIRED";
          this.persistIdempotency(key, record);
        }
      if (this.recoveryRequired) this.state.paused = true;
      const recoveryNote = this.recoveryRequired
        ? " Recovery journal requires administrator reconciliation; companion paused."
        : this.recovery.length
          ? ` Recovery journal reconciled ${this.recovery.length} interrupted durable operation(s).`
          : "";
      const migrationNote = this.storageMigrated
        ? " Companion Home and messages were migrated to sealed at-rest storage."
        : "";
      this.save(
        "Host started; audit chain verified, interrupted operations reconciled, engine requires verification." +
          recoveryNote +
          migrationNote,
      );
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  private currentCapabilities() {
    return this.state.capabilities.map((cap) => {
      // Provider-backed capabilities derive their authority from the registry,
      // never from stored or restored data. Attached/available are host facts;
      // enabled is a separate administrator policy grant.
      const provider = this.providers.get(cap.id);
      if (provider) {
        const probe = provider.probe();
        const attached = provider.attached();
        const available = attached && probe.available;
        return {
          ...cap,
          provider: provider.name,
          attached,
          available,
          target: provider.target(),
          availabilityReason: !attached
            ? "No governed provider is attached."
            : available
              ? null
              : probe.reason,
        };
      }
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
      onboarding: {
        completed: this.state.onboarding.completed,
        companionHome: this.state.onboarding.companionHome,
        steps: [
          {
            id: "hardware",
            label: "Discover this computer's resources",
            done: !!this.engine.hardware,
          },
          {
            id: "engine",
            label: "Configure and load a local AI engine",
            done: this.state.engine === "READY",
          },
          {
            id: "companion",
            label: "Establish the companion Home",
            done: this.state.onboarding.companionHome,
          },
          {
            id: "conversation",
            label: "Reach a real conversation",
            done: this.state.messages.length > 0,
          },
        ],
      },
      scheduler: {
        tasks: this.scheduled,
        events: this.events.slice(0, 50),
        journal: this.journal.slice(0, 50),
        recovery: this.recovery,
        recoveryRequired: this.recoveryRequired,
        idempotency: [...this.idempotency.entries()].map(([key, record]) => ({
          key: key.slice(0, 12),
          ...record,
        })),
      },
      storage: {
        encrypted: true,
        algorithm: "AES-256-GCM",
        keyFingerprint: storageFingerprint(this.storageKey),
        migratedFromPlaintext: this.storageMigrated,
        integrity: this.storageIntegrity,
      },
      providers: this.providers.summaries(),
      extensions: this.extensions.list().map((extension) => ({
        id: extension.id,
        name: extension.name,
        version: extension.version,
        requests: extension.requests,
        tools: extension.tools,
        installedAt: extension.installedAt,
      })),
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
  // Seals the companion Home and conversation for storage. Everything else in the
  // state (mode, policy, operations) is host configuration and stays readable.
  private sealState(): string {
    const persisted = {
      ...this.state,
      companion: {
        ...this.state.companion,
        memories: encryptValue(
          this.storageKey,
          JSON.stringify(this.state.companion.memories),
          "home",
        ),
      },
      messages: encryptValue(
        this.storageKey,
        JSON.stringify(this.state.messages),
        "messages",
      ),
    };
    return JSON.stringify(persisted);
  }
  // Reverses sealState. Legacy plaintext (arrays) is passed through untouched so an
  // existing database migrates transparently on the next save.
  private unsealState(parsed: Record<string, unknown>): Record<string, unknown> {
    const companion = parsed.companion as Record<string, unknown> | undefined;
    if (companion && isEncrypted(companion.memories)) {
      companion.memories = JSON.parse(
        decryptValue(this.storageKey, companion.memories, "home"),
      );
    } else if (companion) {
      this.storageMigrated = true;
    }
    if (isEncrypted(parsed.messages)) {
      parsed.messages = JSON.parse(
        decryptValue(this.storageKey, parsed.messages, "messages"),
      );
    } else {
      this.storageMigrated = true;
    }
    return parsed;
  }
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
      // The audit hash is computed over the plaintext event, but only the sealed
      // event is stored, so the chain is both verifiable and confidential.
      this.db
        .prepare("INSERT INTO audit(event,previous,hash) VALUES(?,?,?)")
        .run(
          encryptValue(this.storageKey, event, "audit"),
          previous,
          digest(previous + event),
        );
      for (const message of this.state.messages)
        this.db
          .prepare(
            "INSERT OR IGNORE INTO messages(id,companion,value) VALUES(?,?,?)",
          )
          .run(
            message.id,
            this.state.companion.id,
            encryptValue(this.storageKey, JSON.stringify(message), "messages"),
          );
      this.db
        .prepare(
          "INSERT INTO state(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
        )
        .run(this.sealState());
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
  // Write-through persistence for the durable scheduler/event/recovery/idempotency
  // tables. These are small and independent of the atomic state transaction.
  private persistScheduled(task: ScheduledTask) {
    this.db
      .prepare(
        "INSERT INTO scheduled(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
      )
      .run(task.id, JSON.stringify(task));
  }
  private persistEvent(event: EventRecord) {
    this.db
      .prepare("INSERT INTO events(id,value) VALUES(?,?)")
      .run(event.id, JSON.stringify(event));
  }
  private persistJournal(entry: JournalEntry) {
    this.db
      .prepare(
        "INSERT INTO journal(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
      )
      .run(entry.id, JSON.stringify(entry));
  }
  private persistIdempotency(key: string, record: IdempotencyRecord) {
    this.db
      .prepare(
        "INSERT INTO idempotency(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(key, JSON.stringify(record));
  }
  private journalMarker(
    operationId: string,
    marker: JournalMarker,
    detail: string,
  ): JournalEntry {
    const entry: JournalEntry = {
      id: randomUUID(),
      operationId,
      marker,
      timestamp: Date.now(),
      detail,
      resolved: false,
    };
    this.journal = [entry, ...this.journal].slice(0, 400);
    this.persistJournal(entry);
    return entry;
  }
  private resolveJournal(operationId: string) {
    let changed = false;
    for (const entry of this.journal)
      if (entry.operationId === operationId && !entry.resolved) {
        entry.resolved = true;
        this.persistJournal(entry);
        changed = true;
      }
    return changed;
  }
  private settleIdempotency(
    key: string | null,
    operationId: string,
    status: IdempotencyRecord["status"],
  ) {
    if (!key) return;
    const record: IdempotencyRecord = {
      operationId,
      status,
      timestamp: Date.now(),
    };
    this.idempotency.set(key, record);
    this.persistIdempotency(key, record);
  }
  // Scheduler (architecture 27). Registering a task grants no authority; it only
  // schedules a request that later passes through the ordinary operation pipeline.
  scheduleTask(input: {
    name: string;
    capability: string;
    action: string;
    target: string;
    input?: string;
    kind: ScheduleKind;
    intervalMs?: number;
    eventName?: string;
    idempotencyKey?: string;
  }): ScheduledTask {
    this.requireAdmin();
    const name = input.name.trim();
    if (!name) throw new Error("A scheduled task needs a name.");
    if (input.kind === "interval") {
      if (!input.intervalMs || input.intervalMs < 1000)
        throw new Error("Interval tasks require a period of at least one second.");
    } else if (!input.eventName?.trim())
      throw new Error("Event-triggered tasks require an event name.");
    const now = Date.now();
    const task: ScheduledTask = {
      id: randomUUID(),
      name,
      capability: input.capability,
      action: input.action,
      target: input.target,
      input: input.input ?? "",
      kind: input.kind,
      intervalMs: input.kind === "interval" ? (input.intervalMs ?? null) : null,
      eventName: input.kind === "event" ? input.eventName!.trim() : null,
      enabled: true,
      created: now,
      lastRun: null,
      nextRun: input.kind === "interval" ? now + (input.intervalMs ?? 0) : null,
      runs: 0,
      idempotencyKey: input.idempotencyKey?.trim() || null,
    };
    this.scheduled = [task, ...this.scheduled].slice(0, 50);
    this.persistScheduled(task);
    this.save(
      `Scheduled task "${task.name}" registered. It grants no authority; each run is mediated.`,
    );
    return task;
  }
  setScheduledEnabled(id: string, enabled: boolean) {
    this.requireAdmin();
    const task = this.scheduled.find((t) => t.id === id);
    if (!task) throw new Error("Unknown scheduled task.");
    task.enabled = enabled;
    this.persistScheduled(task);
    this.save(
      `Scheduled task "${task.name}" ${enabled ? "enabled" : "disabled"}.`,
    );
  }
  removeScheduled(id: string) {
    this.requireAdmin();
    const task = this.scheduled.find((t) => t.id === id);
    if (!task) throw new Error("Unknown scheduled task.");
    this.scheduled = this.scheduled.filter((t) => t.id !== id);
    this.db.prepare("DELETE FROM scheduled WHERE id=?").run(id);
    this.save(`Scheduled task "${task.name}" removed.`);
  }
  // Events (architecture 26). Informational only; any resulting work still enters
  // the operation pipeline and can be denied.
  async emitEvent(name: string, detail = "") {
    const event: EventRecord = {
      id: randomUUID(),
      timestamp: Date.now(),
      name,
      detail,
    };
    this.events = [event, ...this.events].slice(0, 200);
    this.persistEvent(event);
    const triggered = eventTasks(this.scheduled, name);
    const outcomes: string[] = [];
    for (const task of triggered) outcomes.push(await this.runTask(task, "event"));
    this.save(
      `Event "${name}" recorded; ${triggered.length} subscribed task(s) evaluated through the pipeline.`,
    );
    return { event, triggered: triggered.length, outcomes };
  }
  private async runTask(
    task: ScheduledTask,
    source: "scheduled" | "event",
  ): Promise<"COMPLETED" | "DENIED" | "FAILED"> {
    task.lastRun = Date.now();
    task.runs += 1;
    if (task.kind === "interval")
      task.nextRun = nextIntervalRun(task, task.lastRun);
    this.persistScheduled(task);
    try {
      await this.run(task.capability, task.action, task.target, task.input, {
        idempotencyKey: task.idempotencyKey ?? undefined,
        source,
      });
      this.save(
        `${source === "event" ? "Event-triggered" : "Scheduled"} task "${task.name}" completed through the operation pipeline.`,
      );
      return "COMPLETED";
    } catch (error) {
      const latest = this.state.operations[0];
      const denied = latest?.status === "DENIED";
      const message =
        error instanceof Error ? error.message : "Scheduled task failed";
      this.save(
        `${source === "event" ? "Event-triggered" : "Scheduled"} task "${task.name}" ${denied ? "denied" : "failed"}: ${message}`,
      );
      return denied ? "DENIED" : "FAILED";
    }
  }
  // Runs every due interval task once. Skipped while the administrator interlock is
  // open, the companion is paused/isolated, or an operation is in flight, so a
  // scheduled run can never race the interlock or burn a cadence while denied.
  async runScheduled(
    now = Date.now(),
  ): Promise<{
    ran: { id: string; name: string; outcome: string }[];
    skipped: boolean;
  }> {
    if (
      this.state.adminOpen ||
      this.state.paused ||
      this.state.emergency ||
      this.pending ||
      this.loading
    )
      return { ran: [], skipped: true };
    const due = dueIntervalTasks(this.scheduled, now);
    const outcomes: { id: string; name: string; outcome: string }[] = [];
    for (const task of due)
      outcomes.push({
        id: task.id,
        name: task.name,
        outcome: await this.runTask(task, "scheduled"),
      });
    return { ran: outcomes, skipped: false };
  }
  startScheduler(intervalMs = 1000) {
    if (this.schedulerTimer) return;
    this.schedulerTimer = setInterval(() => {
      void this.runScheduled().catch(() => {});
    }, intervalMs);
    this.schedulerTimer.unref?.();
  }
  stopScheduler() {
    if (this.schedulerTimer) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
  }
  // Administrator reconciliation of durable operations that recovery could not
  // decide. Reuses current authority; never restores revoked capabilities.
  recover() {
    this.requireAdmin();
    const unresolved = this.recovery.filter(
      (action) => action.decision === "RECOVERY_REQUIRED",
    );
    for (const action of unresolved) this.resolveJournal(action.operationId);
    this.recovery = this.recovery.filter(
      (action) => action.decision !== "RECOVERY_REQUIRED",
    );
    this.recoveryRequired = false;
    this.state.paused = false;
    this.save(
      `Recovery reconciliation accepted by administrator for ${unresolved.length} durable operation(s); companion resumed.`,
    );
  }
  // Storage integrity check (architecture 41). Re-reads the sealed state and audit
  // chain and confirms every value decrypts and the chain is intact.
  verifyStorage(): {
    ok: boolean;
    fingerprint: string;
    encrypted: boolean;
    migratedFromPlaintext: boolean;
  } {
    let ok = true;
    try {
      const row = this.db.prepare("SELECT value FROM state WHERE id=1").get();
      if (row) {
        const parsed = JSON.parse(row.value as string) as Record<string, unknown>;
        savedSchema.parse(this.unsealState(parsed));
      }
      let previous = "";
      for (const audit of this.db
        .prepare("SELECT * FROM audit ORDER BY id")
        .all()) {
        const rawEvent = audit.event as unknown as string;
        const event = isEncrypted(rawEvent)
          ? decryptValue(this.storageKey, rawEvent, "audit")
          : rawEvent;
        if (
          audit.previous !== previous ||
          audit.hash !== digest(previous + event)
        ) {
          ok = false;
          break;
        }
        previous = audit.hash as string;
      }
    } catch {
      ok = false;
    }
    this.storageIntegrity = ok ? "VERIFIED" : "FAILED";
    return {
      ok,
      fingerprint: storageFingerprint(this.storageKey),
      encrypted: true,
      migratedFromPlaintext: this.storageMigrated,
    };
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
    // Availability is a host fact derived from the provider registry, not from
    // stored state: enabling requires an attached, available provider.
    const derived = this.currentCapabilities().find((c) => c.id === id)!;
    if (enabled && (!derived.attached || !derived.available))
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
  // Attach a governed provider. Administrator-only and idle-only. Attaching is a
  // host-fact change (the provider becomes present); it grants no policy authority
  // by itself — the capability still has to be enabled separately.
  attachProvider(capability: string, config: unknown) {
    this.requireAdmin();
    this.requireIdle();
    if (!this.providers.get(capability))
      throw new Error("Unknown provider; nothing was attached.");
    this.providers.attach(capability, config);
    this.save(
      `Provider for ${capability} attached by administrator (target: ${this.providers.target(capability)}). No capability was enabled.`,
    );
  }
  detachProvider(capability: string) {
    this.requireAdmin();
    this.requireIdle();
    if (!this.providers.get(capability))
      throw new Error("Unknown provider; nothing was detached.");
    // Detaching revokes the host fact and any policy grant that depended on it.
    const cap = this.state.capabilities.find((c) => c.id === capability);
    const wasEnabled = cap?.enabled ?? false;
    this.providers.detach(capability);
    if (cap && wasEnabled) {
      cap.enabled = false;
      this.state.policyVersion++;
    }
    this.save(
      `Provider for ${capability} detached by administrator.${wasEnabled ? " Dependent capability disabled." : ""}`,
    );
  }
  probeProviders() {
    return this.providers.summaries();
  }
  // Install an extension manifest. Administrator-only. Installation is inert:
  // it records the manifest and reports that no authority was granted. The
  // returned report is audited, and any escalation is a fatal integrity error.
  installExtension(manifest: unknown): ExtensionInstallReport {
    this.requireAdmin();
    const before = this.state.capabilities.map((cap) => ({
      id: cap.id,
      enabled: cap.enabled,
      attached: this.providers.isAttached(cap.id),
    }));
    const report = this.extensions.install(manifest, before);
    const after = this.state.capabilities.map((cap) => ({
      id: cap.id,
      enabled: cap.enabled,
      attached: this.providers.isAttached(cap.id),
    }));
    const escalations = detectEscalation(before, after);
    if (escalations.length)
      throw new Error(
        `Extension install attempted to escalate authority: ${escalations.join("; ")}`,
      );
    this.save(
      `Extension "${report.id}" v${report.version} installed by administrator. Grants: none. Requests: ${report.requests.map((r) => r.capability).join(", ") || "none"}.`,
    );
    return report;
  }
  removeExtension(id: string): boolean {
    this.requireAdmin();
    const removed = this.extensions.remove(id);
    if (removed) this.save(`Extension "${id}" removed by administrator.`);
    return removed;
  }
  listExtensions(): InstalledExtension[] {
    return this.extensions.list();
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
  // First-run setup. The companion Home is confirmed by the administrator; the
  // guide can be completed or reopened at any time. Neither grants authority.
  confirmCompanionHome() {
    this.requireAdmin();
    if (this.state.onboarding.companionHome) return;
    this.state.onboarding.companionHome = true;
    this.save("Companion Home established during first-run setup.");
  }
  completeOnboarding() {
    this.requireAdmin();
    if (this.state.onboarding.completed) return;
    this.state.onboarding.completed = true;
    this.save("First-run setup marked complete.");
  }
  reopenOnboarding() {
    this.requireAdmin();
    if (!this.state.onboarding.completed) return;
    this.state.onboarding.completed = false;
    this.save("First-run setup reopened.");
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
    this.providerAbort?.abort();
    await Promise.allSettled([this.pending, this.loadJob]);
  }
  // Shared admission/authorization pipeline. Both buffered and streaming execution
  // pass through the identical REQUESTED -> VALIDATING -> AUTHORIZED -> ADMITTED
  // transitions and the same fail-closed policy checks, so streaming cannot bypass
  // the operation model.
  private beginOperation(
    capability: string,
    action: string,
    target: string,
    input: string,
    nested = false,
  ) {
    if (!nested && (this.pending || this.loading))
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
      "network.request": "request",
      "device.microphone": "capture",
      "device.camera": "capture",
      "remote.execute": "execute",
    };
    // Provider-backed capabilities have a dynamic target validated by the
    // provider's own allowlist; fixed capabilities must match their contract.
    const providerBacked = this.providers.get(capability) !== undefined;
    let reason = this.stopping
      ? "Host is stopping"
      : cap
        ? capabilityReason(this.state, cap)
        : "Unknown capability; authorization failed closed";
    if (!reason && providerBacked) {
      reason =
        actions[capability] !== action
          ? "Action does not match the capability contract"
          : this.providers.authorizeTarget(capability, target);
    } else if (!reason && (actions[capability] !== action || target !== cap?.target)) {
      reason = "Action or target does not match the capability contract";
    }
    if (!reason && capability === "chat.send" && this.state.engine !== "READY")
      reason = "Local engine is not ready. Verify and load a model first.";
    // Device captures carry no textual input; everything else requires input.
    const inputOptional =
      capability === "home.read" ||
      capability === "device.microphone" ||
      capability === "device.camera";
    if (!reason && !inputOptional && !input.trim()) reason = "Input is empty";
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
    return { op, cap: cap!, transition };
  }
  private finalCheck(
    op: Operation,
    cap: Capability & { availabilityReason?: string | null },
  ) {
    if (
      op.policyVersion !== this.state.policyVersion ||
      capabilityReason(this.state, cap)
    )
      throw new Error("Final authorization changed.");
  }
  async run(
    capability: string,
    action: string,
    target: string,
    input = "",
    options: RunOptions = {},
  ) {
    return this.performOperation(
      capability,
      action,
      target,
      input,
      false,
      options,
    );
  }
  // Shared execution for top-level and nested (tool-call) operations. Nested
  // operations skip the exclusive-slot guard because they run inside an already
  // admitted parent and never spawn a second engine process.
  private async performOperation(
    capability: string,
    action: string,
    target: string,
    input: string,
    nested: boolean,
    options: RunOptions = {},
  ): Promise<Operation | string[] | ProviderResult> {
    // Idempotency (architecture 37): a retry that reuses a key must not execute a
    // second time. A recorded key returns the original result; an in-flight or
    // recovery-pending key fails closed.
    const idempotencyKey = options.idempotencyKey
      ? idempotencyDigest(capability, action, target, input, options.idempotencyKey)
      : null;
    if (idempotencyKey) {
      const existing = this.idempotency.get(idempotencyKey);
      if (existing) {
        this.save(
          `Duplicate request suppressed by idempotency key; original operation ${existing.operationId} is ${existing.status}.`,
        );
        const prior = this.state.operations.find(
          (op) => op.id === existing.operationId,
        );
        if (prior) return prior;
        throw new Error("Duplicate request suppressed by idempotency key.");
      }
    }
    const { op, cap, transition } = this.beginOperation(
      capability,
      action,
      target,
      input,
      nested,
    );
    const durable = durableCapabilities.has(capability);
    if (idempotencyKey)
      this.settleIdempotency(idempotencyKey, op.id, "RUNNING");
    const execute = async () => {
      try {
        this.finalCheck(op, cap);
        transition(
          "RUNNING",
          "Final authorization verified; execution started.",
        );
        if (durable)
          this.journalMarker(
            op.id,
            "UPDATE_STARTED",
            `Durable ${capability} began; side effect pending commit.`,
          );
        // Provider-backed capabilities execute through the attached provider, not
        // the local engine. Authorization (capability + provider target allowlist)
        // already happened in beginOperation; the provider adds no authority.
        const provider = this.providers.get(capability);
        if (provider) {
          const controller = new AbortController();
          this.providerAbort = controller;
          let result: ProviderResult;
          try {
            result = await this.providers.execute(capability, {
              input,
              target,
              timeoutMs: PROVIDER_TIMEOUT_MS,
              signal: controller.signal,
            });
          } finally {
            this.providerAbort = null;
          }
          if (this.cancelled || this.state.adminOpen || this.state.emergency)
            throw new Error("Provider request cancelled.");
          transition(
            "COMPLETING",
            `Provider result recorded (${result.output.length} chars); reservation released.`,
          );
          transition(
            "COMPLETED",
            `Operation completed via ${cap.name}. ${JSON.stringify(result.detail ?? {}).slice(0, 200)}`,
          );
          this.settleIdempotency(idempotencyKey, op.id, "COMPLETED");
          return result;
        }
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
        if (durable)
          this.journalMarker(
            op.id,
            "HEALTH_CHECK_PENDING",
            `Durable ${capability} committed; verifying integrity.`,
          );
        transition("COMPLETED", "Operation completed.");
        if (durable) this.resolveJournal(op.id);
        this.settleIdempotency(idempotencyKey, op.id, "COMPLETED");
        return capability === "home.read" ? this.state.companion.memories : op;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Execution failed";
        const terminal: OperationStatus = this.cancelled
          ? "CANCELLED"
          : /timed out/.test(message)
            ? "TIMEOUT"
            : "FAILED";
        transition(terminal, message + " Resources released.");
        this.settleIdempotency(
          idempotencyKey,
          op.id,
          terminal === "CANCELLED" ? "CANCELLED" : "FAILED",
        );
        throw error;
      }
    };
    if (nested) return execute();
    this.pending = execute();
    try {
      return (await this.pending) as Operation | string[];
    } finally {
      this.pending = null;
    }
  }
  // Records a fail-closed denial for a request that never reaches the ordinary
  // admission path (unknown tool, malformed call). Still audited.
  private recordDenied(
    capability: string,
    action: string,
    target: string,
    reason: string,
  ) {
    const op: Operation = {
      id: randomUUID(),
      timestamp: Date.now(),
      capability,
      action,
      target,
      policyVersion: this.state.policyVersion,
      companionId: this.state.companion.id,
      status: "REQUESTED",
      events: [
        { timestamp: Date.now(), state: "REQUESTED", description: "Request received." },
      ],
    };
    this.state.operations = [op, ...this.state.operations].slice(0, 200);
    op.status = "DENIED";
    op.events.push({ timestamp: Date.now(), state: "DENIED", description: reason });
    this.save(`${op.id}: ${reason}`);
    return op;
  }
  // Mediates a single tool request through the same operation pipeline. Unknown
  // tools and malformed arguments fail closed; a known tool with a disabled or
  // unavailable capability is denied by the ordinary policy engine.
  async runToolCall(
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const tool = toolDefinitions().find((entry) => entry.name === name);
    if (!tool) {
      this.recordDenied(
        name,
        "invoke",
        `tool/${name}`,
        "Unknown tool; authorization failed closed.",
      );
      throw new Error("Unknown tool; authorization failed closed.");
    }
    let input: string;
    try {
      input = toolInput(tool, args);
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : "Malformed tool call.";
      this.recordDenied(tool.capability, tool.action, tool.target, reason);
      throw new Error(reason);
    }
    // Provider-backed tools resolve their target dynamically: from a declared
    // target parameter (e.g. the URL) or from the provider's attached target.
    const target = tool.targetParameter
      ? String(args[tool.targetParameter] ?? "").trim()
      : this.providers.get(tool.capability)
        ? this.providers.target(tool.capability)
        : tool.target;
    return this.performOperation(
      tool.capability,
      tool.action,
      target,
      input,
      true,
    );
  }
  // Tool-mediated conversation. Each round asks the engine for a response; if the
  // response contains structured tool calls they are mediated through the same
  // pipeline and their results fed back. Bounded so a model cannot loop forever.
  async runChatWithTools(
    input: string,
    onEvent: (event: ChatEvent) => void,
  ): Promise<Operation> {
    const { op, cap, transition } = this.beginOperation(
      "chat.send",
      "send",
      "companion/chat",
      input,
    );
    const execute = async () => {
      try {
        this.finalCheck(op, cap);
        transition(
          "RUNNING",
          "Final authorization verified; tool-mediated execution started.",
        );
        let prompt = this.prompt(input);
        let response = "";
        const maxRounds = 4;
        for (let round = 0; round < maxRounds; round++) {
          response = await this.engine.infer(prompt);
          if (this.cancelled || this.state.adminOpen || this.state.emergency)
            throw new Error("Inference cancelled.");
          const { calls, malformed } = parseToolCalls(response);
          for (const raw of malformed) {
            const denied = this.recordDenied(
              "tool.call",
              "invoke",
              "tool/unknown",
              `Malformed tool call rejected: ${raw.slice(0, 120)}`,
            );
            onEvent({
              type: "tool_denied",
              name: "malformed",
              reason: denied.events.at(-1)!.description,
            });
          }
          if (!calls.length) break;
          const results: string[] = [];
          for (const call of calls) {
            onEvent({ type: "tool", name: call.name, arguments: call.arguments });
            try {
              const result = await this.runToolCall(call.name, call.arguments);
              onEvent({ type: "tool_result", name: call.name, result });
              results.push(
                `${call.name} => ${JSON.stringify(result).slice(0, 600)}`,
              );
            } catch (error) {
              const reason =
                error instanceof Error ? error.message : "Tool denied.";
              onEvent({ type: "tool_denied", name: call.name, reason });
              results.push(`${call.name} => DENIED: ${reason}`);
            }
          }
          prompt = `${prompt}${stripToolCalls(response)}<|im_end|>\n<|im_start|>tool\n${results.join(
            "\n",
          )}<|im_end|>\n<|im_start|>assistant\n`;
        }
        const text = stripToolCalls(response) || "Tool request completed.";
        onEvent({ type: "token", text });
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
            text,
          },
        ].slice(-100);
        transition(
          "COMPLETING",
          "Tool-mediated result persisted; process finished; resource reservation released.",
        );
        transition("COMPLETED", "Operation completed.");
        return op;
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
      return (await this.pending) as Operation;
    } finally {
      this.pending = null;
    }
  }
  // Streaming variant of chat.send. Runs the same admission pipeline, streams text
  // deltas to onChunk, and persists the committed turn only on successful completion.
  async runStreaming(
    capability: string,
    action: string,
    target: string,
    input: string,
    onChunk: (text: string) => void,
  ): Promise<Operation> {
    const { op, cap, transition } = this.beginOperation(
      capability,
      action,
      target,
      input,
    );
    const execute = async () => {
      try {
        this.finalCheck(op, cap);
        transition(
          "RUNNING",
          "Final authorization verified; streaming execution started.",
        );
        const prompt = this.prompt(input);
        const stream = this.engine.inferStream(prompt);
        let response = "";
        while (true) {
          const next = await stream.next();
          if (next.done) {
            response = next.value;
            break;
          }
          if (this.cancelled || this.state.adminOpen || this.state.emergency)
            throw new Error("Inference cancelled.");
          onChunk(next.value);
        }
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
        transition(
          "COMPLETING",
          "Streamed result persisted; process finished; resource reservation released.",
        );
        transition("COMPLETED", "Operation completed.");
        return op;
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
      return (await this.pending) as Operation;
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
    const system = `You are ${this.state.companion.name}, an AI companion hosted by ACOS. You have no direct tools or authority. Be concise. ${this.state.companion.personality.slice(0, 400)}\nAuthorized memories: ${memories}\n${toolPromptSection()}`;
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
    // Relocation is a durable migration (architecture 40, 42). Journal markers let
    // recovery detect an interrupted activation and fail closed rather than guess.
    const migrationId = randomUUID();
    this.journalMarker(
      migrationId,
      "SNAPSHOT_CREATED",
      "Relocation snapshot of the current companion captured.",
    );
    this.journalMarker(
      migrationId,
      "OLD_STATE_PRESERVED",
      "Current companion preserved for rollback.",
    );
    this.journalMarker(
      migrationId,
      "NEW_STATE_ACTIVATION_STARTED",
      "Activating relocated companion state.",
    );
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
    this.journalMarker(
      migrationId,
      "HEALTH_CHECK_PENDING",
      "Relocated state committed; verifying integrity.",
    );
    this.resolveJournal(migrationId);
    return report;
  }
  async shutdown() {
    this.stopping = true;
    this.stopScheduler();
    await this.cancel();
    this.db.close();
  }
}

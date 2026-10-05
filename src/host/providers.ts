// Governed capability providers (architecture: every capability is provided by an
// explicitly attached provider and executed through the same versioned
// operation/admission/authorization/audit pipeline as the rest of ACOS).
//
// Design rules, enforced here and by the runtime:
//
//   * Default-deny. A provider starts unattached and unavailable. Nothing is
//     attached by inference from a device name, a GPU, or restored companion
//     data.
//   * Attachment is an administrator action. The companion/model can never attach
//     a provider; it may only *request* a capability that the administrator has
//     already attached and enabled.
//   * Providers hold no authority of their own. The runtime authorizes the
//     specific target and only then calls `execute`. A provider's `authorizeTarget`
//     is a second, provider-specific constraint (an allowlist), never a grant.
//   * Results are bounded and secret-free so they can be recorded in the audit
//     journal.

import { promises as dns } from "node:dns";
import net from "node:net";

export interface ProviderContext {
  // The validated operation input (e.g. the URL or the remote command).
  input: string;
  // The specific requested target, already checked by authorizeTarget.
  target: string;
  // Bounded execution budget.
  timeoutMs: number;
  signal: AbortSignal;
}

export interface ProviderResult {
  // Human/model-readable summary.
  output: string;
  // Structured, secret-free detail for the audit trail.
  detail?: Record<string, unknown>;
}

export interface ProviderProbe {
  available: boolean;
  reason: string | null;
}

export interface Provider {
  // Capability id this provider supplies (e.g. "network.request").
  readonly capability: string;
  // Display name shown in the capability registry.
  readonly name: string;
  readonly description: string;
  // Whether the mechanism exists on this host right now.
  probe(): ProviderProbe;
  // Attach with an administrator-supplied configuration. Throws if the provider
  // is unavailable or the configuration is invalid.
  attach(config: unknown): void;
  detach(): void;
  attached(): boolean;
  // Human-readable description of the currently attached target.
  target(): string;
  // Provider-specific constraint on a requested target. Returns a denial reason
  // or null when the target is within the attached allowlist.
  authorizeTarget(target: string): string | null;
  // Execute an already-authorized request. Only the runtime calls this.
  execute(context: ProviderContext): Promise<ProviderResult>;
}

// --- Address safety ---------------------------------------------------------

// True for loopback, link-local, private and unique-local addresses. Used to
// refuse outbound requests that would reach the host's own network unless the
// administrator explicitly opts in (tests, lab deployments).
export function isPrivateAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) {
    const parts = address.split(".").map((n) => Number(n));
    const [a, b] = parts;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  if (family === 6) {
    const lower = address.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("fe80")) return true; // link-local
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA
    // IPv4-mapped ::ffff:a.b.c.d
    const mapped = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }
  return false;
}

export function isPrivateHost(host: string): boolean {
  const lower = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (lower === "localhost" || lower.endsWith(".localhost")) return true;
  if (net.isIP(lower)) return isPrivateAddress(lower);
  return false;
}

// --- Network provider -------------------------------------------------------

export interface NetworkAttachConfig {
  // Exact hostnames permitted (lower-cased). No wildcards.
  hosts: string[];
  // Permit loopback/private targets. Default false; only for lab/test use.
  allowPrivate?: boolean;
  // Response size cap in bytes. Default 256 KiB.
  maxBytes?: number;
  // Per-request timeout. Default 15 s.
  timeoutMs?: number;
}

const DEFAULT_NETWORK_MAX_BYTES = 256 * 1024;
const DEFAULT_NETWORK_TIMEOUT_MS = 15_000;

export class NetworkProvider implements Provider {
  readonly capability = "network.request";
  readonly name = "ACOS network gateway";
  readonly description = "Target-constrained outbound HTTP(S) requests.";

  private hosts = new Set<string>();
  private allowPrivate = false;
  private maxBytes = DEFAULT_NETWORK_MAX_BYTES;
  private timeoutMs = DEFAULT_NETWORK_TIMEOUT_MS;
  private isAttached = false;

  probe(): ProviderProbe {
    if (typeof fetch !== "function")
      return { available: false, reason: "This runtime has no fetch implementation." };
    return { available: true, reason: null };
  }

  attach(config: unknown): void {
    if (!this.probe().available)
      throw new Error("Network provider is unavailable on this runtime.");
    const parsed = config as NetworkAttachConfig | undefined;
    const hosts = (parsed?.hosts ?? [])
      .map((h) => String(h).trim().toLowerCase())
      .filter(Boolean);
    if (!hosts.length)
      throw new Error("Attaching the network provider requires at least one allowed host.");
    for (const host of hosts)
      if (!/^[a-z0-9.-]+$/.test(host))
        throw new Error(`Invalid allowlist host "${host}".`);
    this.hosts = new Set(hosts);
    this.allowPrivate = parsed?.allowPrivate === true;
    this.maxBytes = Math.max(1, Math.min(parsed?.maxBytes ?? DEFAULT_NETWORK_MAX_BYTES, 8 * 1024 * 1024));
    this.timeoutMs = Math.max(1000, Math.min(parsed?.timeoutMs ?? DEFAULT_NETWORK_TIMEOUT_MS, 60_000));
    this.isAttached = true;
  }

  detach(): void {
    this.isAttached = false;
    this.hosts = new Set();
    this.allowPrivate = false;
  }

  attached(): boolean {
    return this.isAttached;
  }

  target(): string {
    if (!this.isAttached) return "None configured";
    const hosts = [...this.hosts];
    return hosts.length === 1 ? hosts[0] : `${hosts.length} hosts allowed`;
  }

  authorizeTarget(target: string): string | null {
    if (!this.isAttached) return "No governed provider is attached.";
    let url: URL;
    try {
      url = new URL(target);
    } catch {
      return "Target is not a valid absolute URL.";
    }
    if (url.protocol !== "http:" && url.protocol !== "https:")
      return "Only http and https targets are permitted.";
    if (url.username || url.password)
      return "Credentials embedded in the URL are not permitted.";
    const host = url.hostname.toLowerCase();
    if (!this.hosts.has(host))
      return `Host "${host}" is not in the attached allowlist.`;
    if (!this.allowPrivate && isPrivateHost(host))
      return `Host "${host}" is a private or loopback address and is not permitted.`;
    return null;
  }

  async execute(context: ProviderContext): Promise<ProviderResult> {
    if (!this.isAttached) throw new Error("Network provider is not attached.");
    const url = new URL(context.target);
    // Re-check the resolved address to defeat DNS rebinding: the allowlist check
    // above is on the name, this is on the address the name resolves to.
    if (!this.allowPrivate) {
      const records = await dns.lookup(url.hostname, { all: true });
      for (const record of records)
        if (isPrivateAddress(record.address))
          throw new Error(
            `Host "${url.hostname}" resolves to a private address (${record.address}); request refused.`,
          );
    }
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    context.signal.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: { "user-agent": "ACOS/0.1 (+local)" },
      });
      const body = await readCapped(response, this.maxBytes);
      return {
        output: body.text,
        detail: {
          status: response.status,
          host: url.hostname,
          bytes: body.bytes,
          truncated: body.truncated,
        },
      };
    } finally {
      clearTimeout(timer);
      context.signal.removeEventListener("abort", onAbort);
    }
  }
}

async function readCapped(
  response: Response,
  maxBytes: number,
): Promise<{ text: string; bytes: number; truncated: boolean }> {
  if (!response.body) return { text: "", bytes: 0, truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    const remaining = maxBytes - bytes;
    if (value.byteLength >= remaining) {
      chunks.push(value.subarray(0, remaining));
      bytes += remaining;
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
    bytes += value.byteLength;
  }
  const merged = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  return { text: merged.toString("utf8"), bytes, truncated };
}

// --- Device providers (microphone / camera) ---------------------------------

// The host never captures audio or video itself. A device bridge is an explicit,
// separately-installed component; without one the capability stays unavailable.
export interface DeviceBridge {
  capture(context: {
    device: "microphone" | "camera";
    timeoutMs: number;
    signal: AbortSignal;
  }): Promise<{ summary: string; detail?: Record<string, unknown> }>;
}

export class DeviceProvider implements Provider {
  readonly capability: string;
  readonly name: string;
  readonly description: string;
  private readonly device: "microphone" | "camera";
  private readonly bridge: DeviceBridge | null;
  private isAttached = false;

  constructor(device: "microphone" | "camera", bridge: DeviceBridge | null) {
    this.device = device;
    this.bridge = bridge;
    this.capability = device === "microphone" ? "device.microphone" : "device.camera";
    this.name = device === "microphone" ? "ACOS microphone bridge" : "ACOS camera bridge";
    this.description =
      device === "microphone"
        ? "Audio input through an authorized device service."
        : "Visual input through an authorized device service.";
  }

  probe(): ProviderProbe {
    if (!this.bridge)
      return {
        available: false,
        reason: `No ${this.device} bridge is configured on this host.`,
      };
    return { available: true, reason: null };
  }

  attach(): void {
    if (!this.probe().available)
      throw new Error(this.probe().reason ?? "Device provider is unavailable.");
    this.isAttached = true;
  }

  detach(): void {
    this.isAttached = false;
  }

  attached(): boolean {
    return this.isAttached;
  }

  target(): string {
    return this.isAttached ? `${this.device} (authorized bridge)` : "None configured";
  }

  authorizeTarget(target: string): string | null {
    if (!this.isAttached) return "No governed provider is attached.";
    if (target !== this.device)
      return `Target "${target}" does not match the attached ${this.device} device.`;
    return null;
  }

  async execute(context: ProviderContext): Promise<ProviderResult> {
    if (!this.isAttached || !this.bridge)
      throw new Error(`${this.device} bridge is not attached.`);
    const result = await this.bridge.capture({
      device: this.device,
      timeoutMs: context.timeoutMs,
      signal: context.signal,
    });
    return { output: result.summary, detail: result.detail };
  }
}

// --- Remote execution provider ----------------------------------------------

// Remote execution is a separate, independently-authorized capability. The host
// never opens a remote session itself; a transport is an explicit component.
export interface RemoteTransport {
  execute(context: {
    target: string;
    command: string;
    timeoutMs: number;
    signal: AbortSignal;
  }): Promise<{ output: string; exitCode: number }>;
}

export interface RemoteAttachConfig {
  target: string;
}

export class RemoteProvider implements Provider {
  readonly capability = "remote.execute";
  readonly name = "ACOS remote transport";
  readonly description = "Independent authorization for a remote target.";

  private readonly transport: RemoteTransport | null;
  private endpoint: string | null = null;

  constructor(transport: RemoteTransport | null) {
    this.transport = transport;
  }

  probe(): ProviderProbe {
    if (!this.transport)
      return { available: false, reason: "No remote transport is configured on this host." };
    return { available: true, reason: null };
  }

  attach(config: unknown): void {
    if (!this.probe().available)
      throw new Error(this.probe().reason ?? "Remote provider is unavailable.");
    const target = String((config as RemoteAttachConfig | undefined)?.target ?? "").trim();
    if (!target) throw new Error("Attaching the remote provider requires a target.");
    this.endpoint = target;
  }

  detach(): void {
    this.endpoint = null;
  }

  attached(): boolean {
    return this.endpoint !== null;
  }

  target(): string {
    return this.endpoint ?? "None configured";
  }

  authorizeTarget(target: string): string | null {
    if (!this.endpoint) return "No governed provider is attached.";
    if (target !== this.endpoint)
      return `Target "${target}" does not match the attached remote endpoint.`;
    return null;
  }

  async execute(context: ProviderContext): Promise<ProviderResult> {
    if (!this.endpoint || !this.transport)
      throw new Error("Remote transport is not attached.");
    const result = await this.transport.execute({
      target: this.endpoint,
      command: context.input,
      timeoutMs: context.timeoutMs,
      signal: context.signal,
    });
    return { output: result.output, detail: { exitCode: result.exitCode } };
  }
}

// --- Registry ---------------------------------------------------------------

export interface ProviderSummary {
  capability: string;
  name: string;
  description: string;
  attached: boolean;
  available: boolean;
  availabilityReason: string | null;
  target: string;
}

export class ProviderRegistry {
  private providers = new Map<string, Provider>();

  constructor(providers: Provider[]) {
    for (const provider of providers) this.providers.set(provider.capability, provider);
  }

  get(capability: string): Provider | undefined {
    return this.providers.get(capability);
  }

  isAttached(capability: string): boolean {
    return this.providers.get(capability)?.attached() ?? false;
  }

  isAvailable(capability: string): boolean {
    const provider = this.providers.get(capability);
    return !!provider && provider.attached() && provider.probe().available;
  }

  target(capability: string): string {
    return this.providers.get(capability)?.target() ?? "None configured";
  }

  // Attach/detach are administrator actions. They only change provider state;
  // they never change a capability's enabled flag (that is a separate policy act).
  attach(capability: string, config: unknown): void {
    const provider = this.providers.get(capability);
    if (!provider) throw new Error(`Unknown provider for capability "${capability}".`);
    provider.attach(config);
  }

  detach(capability: string): void {
    const provider = this.providers.get(capability);
    if (!provider) throw new Error(`Unknown provider for capability "${capability}".`);
    provider.detach();
  }

  // Provider-specific target constraint, called by the runtime during admission.
  authorizeTarget(capability: string, target: string): string | null {
    const provider = this.providers.get(capability);
    if (!provider) return "Unknown capability; authorization failed closed";
    return provider.authorizeTarget(target);
  }

  async execute(capability: string, context: ProviderContext): Promise<ProviderResult> {
    const provider = this.providers.get(capability);
    if (!provider) throw new Error(`Unknown provider for capability "${capability}".`);
    return provider.execute(context);
  }

  summaries(): ProviderSummary[] {
    return [...this.providers.values()].map((provider) => {
      const probe = provider.probe();
      const attached = provider.attached();
      return {
        capability: provider.capability,
        name: provider.name,
        description: provider.description,
        attached,
        available: attached && probe.available,
        availabilityReason: !attached
          ? "No governed provider is attached."
          : probe.available
            ? null
            : probe.reason,
        target: provider.target(),
      };
    });
  }
}

// The providers this build ships. Network uses the runtime's fetch; device and
// remote providers have no bridge/transport by default, so they stay unavailable
// until a component is explicitly supplied.
export function defaultProviders(): Provider[] {
  return [
    new NetworkProvider(),
    new DeviceProvider("microphone", null),
    new DeviceProvider("camera", null),
    new RemoteProvider(null),
  ];
}

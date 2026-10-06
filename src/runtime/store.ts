import type { HardwareReport, ComputePlan } from "./hardware";
import { useSyncExternalStore } from "react";
import type { RuntimeState, CapabilityView } from "./model";
export type HostState = Omit<RuntimeState, "capabilities" | "onboarding"> & {
  capabilities: CapabilityView[];
  onboarding: {
    completed: boolean;
    companionHome: boolean;
    steps: { id: string; label: string; done: boolean }[];
  };
  scheduler: {
    tasks: {
      id: string;
      name: string;
      capability: string;
      action: string;
      target: string;
      input: string;
      kind: string;
      intervalMs: number | null;
      eventName: string | null;
      enabled: boolean;
      lastRun: number | null;
      nextRun: number | null;
      runs: number;
      idempotencyKey: string | null;
    }[];
    events: { id: string; timestamp: number; name: string; detail: string }[];
    journal: {
      id: string;
      operationId: string;
      marker: string;
      timestamp: number;
      detail: string;
      resolved: boolean;
    }[];
    recovery: {
      operationId: string;
      lastMarker: string;
      decision: string;
      reason: string;
    }[];
    recoveryRequired: boolean;
    idempotency: {
      key: string;
      operationId: string;
      status: string;
      timestamp: number;
    }[];
  };
  migration: { retired: boolean; publicKey: string };
  storage: {
    encrypted: boolean;
    algorithm: string;
    keyFingerprint: string;
    migratedFromPlaintext: boolean;
    integrity: string;
  };
  host: {
    connected: boolean;
    platform: string;
    model: string | null;
    modelHash: string | null;
    modelAdapter: string;
    modelRegistry: {
      id: string;
      families: readonly string[];
      format: string;
      tokenizer: string;
      template: string;
    }[];
    isolation: string;
    busy: boolean;
    contextLimit: number;
    maxOutputTokens: number;
    completedOperations: number;
    memoryReservation: number;
    hardware: HardwareReport | null;
    compute: ComputePlan | null;
    providers: { backend: string; architectures: string[]; status: string }[];
    engineError: string | null;
  };
};
interface Connection {
  data: HostState | null;
  error: string | null;
  authRequired: boolean;
  connected: boolean;
}
let snapshot: Connection = {
  data: null,
  error: null,
  authRequired: false,
  connected: false,
};
const listeners = new Set<() => void>();
const publish = (next: Connection) => {
  snapshot = next;
  listeners.forEach((fn) => fn());
};
let generation = 0;
async function request(path: string, body?: unknown) {
  const response = await fetch(`/api/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.headers.get("content-type")?.includes("application/json"))
    throw new Error("Host API is unavailable. Start the ACOS host service.");
  const data = await response.json();
  if (response.status === 401)
    publish({ data: null, connected: true, authRequired: true, error: null });
  if (!response.ok) throw new Error(data.error ?? "Host request failed");
  return data;
}
export async function refresh() {
  const id = ++generation;
  try {
    const data = await request("state");
    if (id === generation)
      publish({ data, error: null, authRequired: false, connected: true });
  } catch (error) {
    if (id === generation && !snapshot.authRequired)
      publish({
        ...snapshot,
        connected: false,
        error: error instanceof Error ? error.message : "Host disconnected",
      });
  }
}
export async function command(
  type: string,
  args: Record<string, unknown> = {},
) {
  generation++;
  try {
    const response = await request("command", { type, ...args });
    generation++;
    publish({
      data: response.state,
      error: null,
      authRequired: false,
      connected: true,
    });
    return response.result;
  } finally {
    void refresh();
  }
}
export async function login(key: string, otp = "") {
  await request("login", { key, otp });
  await refresh();
}
// Streams a chat.send operation over Server-Sent Events. Tokens are delivered to
// onToken as they arrive; the committed host state is published on completion.
// When options.tools is set, the host mediates structured tool calls and reports
// them through options.onTool.
export interface ToolEvent {
  type: "tool" | "tool_result" | "tool_denied";
  name: string;
  arguments?: Record<string, unknown>;
  result?: unknown;
  reason?: string;
}
export async function streamChat(
  input: string,
  onToken: (text: string) => void,
  onStatus?: (status: string) => void,
  options?: { tools?: boolean; onTool?: (event: ToolEvent) => void },
): Promise<void> {
  onStatus?.("requesting");
  const response = await fetch("/api/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      capability: "chat.send",
      action: "send",
      target: "companion/chat",
      input,
      tools: options?.tools ?? false,
    }),
  });
  if (!response.ok || !response.body) {
    let message = "Streaming request failed";
    try {
      const data = (await response.json()) as { error?: string };
      message = data.error ?? message;
    } catch {
      /* Non-JSON error body. */
    }
    if (response.status === 401)
      publish({ data: null, connected: true, authRequired: true, error: null });
    throw new Error(message);
  }
  onStatus?.("streaming");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let nextState: HostState | null = null;
  let streamError: string | null = null;
  const handle = (event: string, data: string) => {
    if (!data) return;
    const parsed = JSON.parse(data) as {
      text?: string;
      error?: string;
      state?: HostState;
      name?: string;
      arguments?: Record<string, unknown>;
      result?: unknown;
      reason?: string;
    };
    if (event === "token") onToken(parsed.text ?? "");
    else if (event === "done") nextState = parsed.state ?? null;
    else if (
      event === "tool" ||
      event === "tool_result" ||
      event === "tool_denied"
    )
      options?.onTool?.({
        type: event,
        name: parsed.name ?? "unknown",
        arguments: parsed.arguments,
        result: parsed.result,
        reason: parsed.reason,
      });
    else if (event === "error") {
      streamError = parsed.error ?? "Stream failed";
      if (parsed.state) nextState = parsed.state;
    }
  };
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      let event = "message";
      let data = "";
      for (const line of part.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7).trim();
        else if (line.startsWith("data: ")) data += line.slice(6);
      }
      handle(event, data);
    }
  }
  if (nextState)
    publish({
      data: nextState,
      error: null,
      authRequired: false,
      connected: true,
    });
  if (streamError) throw new Error(streamError);
  else void refresh();
}
export async function logout() {
  await request("logout", {});
  publish({ data: null, error: null, authRequired: true, connected: true });
}
export async function getSample() {
  return request("relocation-example");
}
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
export const useConnection = () =>
  useSyncExternalStore(subscribe, () => snapshot);
export function useRuntime(): HostState {
  return useConnection().data!;
}

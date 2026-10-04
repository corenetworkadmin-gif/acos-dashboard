import { useSyncExternalStore } from "react";
import type { RuntimeState } from "./model";
export type HostState = RuntimeState & {
  host: {
    connected: boolean;
    platform: string;
    model: string | null;
    modelHash: string | null;
    isolation: string;
    busy: boolean;
    contextLimit: number;
    maxOutputTokens: number;
    completedOperations: number;
    memoryReservation: number;
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
export async function login(key: string) {
  await request("login", { key });
  await refresh();
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

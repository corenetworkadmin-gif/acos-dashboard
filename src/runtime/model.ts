import { z } from "zod";
export const modes = ["SAFE", "INTERMEDIATE", "ADVANCED"] as const;
export type Mode = (typeof modes)[number];
export const statuses = [
  "REQUESTED",
  "VALIDATING",
  "AUTHORIZED",
  "ADMITTED",
  "RUNNING",
  "COMPLETING",
  "COMPLETED",
  "DENIED",
  "CANCELLED",
  "FAILED",
  "TIMEOUT",
] as const;
export type OperationStatus = (typeof statuses)[number];
export interface Capability {
  id: string;
  name: string;
  description: string;
  provider: string;
  enabled: boolean;
  available: boolean;
  attached: boolean;
  minimumMode: Mode;
  target: string;
  configurable: boolean;
}
export interface Operation {
  id: string;
  timestamp: number;
  capability: string;
  action: string;
  target: string;
  policyVersion: number;
  companionId: string;
  status: OperationStatus;
  events: { timestamp: number; state: OperationStatus; description: string }[];
}
export interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: number;
}
export interface AdminEvent {
  id: string;
  timestamp: number;
  description: string;
}
export const relocationSchema = z
  .object({
    protocolVersion: z.literal("1.0"),
    companion: z
      .object({
        id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
        name: z.string().trim().min(1).max(80),
        version: z.string().min(1).max(32),
      })
      .strict(),
    state: z
      .object({
        memories: z.array(z.string().max(4000)).max(100),
        personality: z.string().max(4000),
      })
      .strict(),
    capabilities: z.array(z.string().min(1).max(80)).max(50),
    dependencies: z.array(z.string().min(1).max(80)).max(50),
    source: z.string().trim().min(1).max(200),
  })
  .strict();
export type RelocationPackage = z.infer<typeof relocationSchema>;
export interface ImportReport {
  id: string;
  timestamp: number;
  name: string;
  status:
    | "PARTIALLY_RECONSTRUCTED"
    | "RECONSTRUCTED_WITH_UNRESOLVED_DEPENDENCIES"
    | "IMPORT_FAILED";
  issues: string[];
  capabilities: { name: string; status: string }[];
}
export interface RuntimeState {
  version: 1;
  mode: Mode;
  policyVersion: number;
  adminOpen: boolean;
  paused: boolean;
  emergency: boolean;
  engine: "STOPPED" | "READY";
  companion: {
    id: string;
    name: string;
    personality: string;
    memories: string[];
    source: string;
    created: number;
  };
  capabilities: Capability[];
  operations: Operation[];
  messages: Message[];
  activity: AdminEvent[];
  imports: ImportReport[];
}
// This build's implemented provider contracts; never inferred from a GPU/device name
// or restored from companion data. Policy grants are persisted separately from these facts.
export function capabilityDefinitions(): Capability[] {
  return [
    {
      id: "chat.send",
      name: "Companion conversation",
      description: "Exchange text through the engine interface.",
      provider: "ACOS interaction",
      enabled: true,
      available: true,
      attached: true,
      minimumMode: "SAFE",
      target: "companion/chat",
      configurable: false,
    },
    {
      id: "home.read",
      name: "Read companion Home",
      description: "Read durable memories in the companion’s Home.",
      provider: "ACOS storage",
      enabled: false,
      available: true,
      attached: true,
      minimumMode: "SAFE",
      target: "companion/home",
      configurable: true,
    },
    {
      id: "home.write",
      name: "Write companion Home",
      description: "Save a note to persistent companion memory.",
      provider: "ACOS storage",
      enabled: false,
      available: true,
      attached: true,
      minimumMode: "SAFE",
      target: "companion/home",
      configurable: true,
    },
    {
      id: "network.request",
      name: "Internet access",
      description: "Target-constrained outbound requests.",
      provider: "Not attached",
      enabled: false,
      available: false,
      attached: false,
      minimumMode: "INTERMEDIATE",
      target: "None configured",
      configurable: true,
    },
    {
      id: "device.microphone",
      name: "Microphone",
      description: "Audio input through an authorized device service.",
      provider: "Not attached",
      enabled: false,
      available: false,
      attached: false,
      minimumMode: "ADVANCED",
      target: "None configured",
      configurable: true,
    },
    {
      id: "device.camera",
      name: "Camera",
      description: "Visual input through an authorized device service.",
      provider: "Not attached",
      enabled: false,
      available: false,
      attached: false,
      minimumMode: "ADVANCED",
      target: "None configured",
      configurable: true,
    },
    {
      id: "remote.execute",
      name: "Remote execution",
      description: "Independent authorization for a remote target.",
      provider: "Not attached",
      enabled: false,
      available: false,
      attached: false,
      minimumMode: "ADVANCED",
      target: "None configured",
      configurable: true,
    },
  ];
}
export interface CapabilityView extends Capability {
  availabilityReason: string | null;
  authorization: { allowed: boolean; reason: string | null };
}
export function initialState(): RuntimeState {
  return {
    version: 1,
    mode: "SAFE",
    policyVersion: 1,
    adminOpen: false,
    paused: false,
    emergency: false,
    engine: "STOPPED",
    companion: {
      id: "companion-001",
      name: "Atlas",
      personality: "",
      memories: [],
      source: "Local workspace",
      created: Date.now(),
    },
    capabilities: capabilityDefinitions(),
    operations: [],
    messages: [],
    imports: [],
    activity: [
      {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        description:
          "Workspace initialized in Safe mode. Configurable capabilities disabled.",
      },
    ],
  };
}
export function capabilityReason(
  state: RuntimeState,
  cap: Capability & { availabilityReason?: string | null },
): string | null {
  if (state.emergency) return "Emergency isolation is active";
  if (state.adminOpen) return "Administrator session is active";
  if (state.paused) return "Companion is paused";
  if (!cap.attached) return "Provider is not attached";
  if (!cap.available)
    return cap.availabilityReason ?? "Provider is unavailable";
  if (!cap.enabled) return "Capability is disabled";
  if (modes.indexOf(state.mode) < modes.indexOf(cap.minimumMode))
    return `Requires ${cap.minimumMode.toLowerCase()} mode`;
  return null;
}
export const savedSchema = z.object({
  version: z.literal(1),
  mode: z.enum(modes),
  policyVersion: z.number().int().positive(),
  adminOpen: z.boolean(),
  paused: z.boolean(),
  emergency: z.boolean(),
  engine: z.enum(["STOPPED", "READY"]),
  companion: z.object({
    id: z.string(),
    name: z.string().min(1).max(80),
    personality: z.string().max(4000),
    memories: z.array(z.string().max(4000)).max(100),
    source: z.string(),
    created: z.number(),
  }),
  capabilities: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      provider: z.string(),
      enabled: z.boolean(),
      available: z.boolean(),
      attached: z.boolean().default(false),
      minimumMode: z.enum(modes),
      target: z.string(),
      configurable: z.boolean(),
    }),
  ),
  messages: z
    .array(
      z.object({
        id: z.string(),
        role: z.enum(["user", "assistant"]),
        text: z.string(),
        timestamp: z.number(),
      }),
    )
    .max(100),
  operations: z
    .array(
      z.object({
        id: z.string(),
        timestamp: z.number(),
        capability: z.string(),
        action: z.string(),
        target: z.string(),
        policyVersion: z.number(),
        companionId: z.string(),
        status: z.enum(statuses),
        events: z.array(
          z.object({
            timestamp: z.number(),
            state: z.enum(statuses),
            description: z.string(),
          }),
        ),
      }),
    )
    .max(200),
  activity: z
    .array(
      z.object({
        id: z.string(),
        timestamp: z.number(),
        description: z.string(),
      }),
    )
    .max(200),
  imports: z
    .array(
      z.object({
        id: z.string(),
        timestamp: z.number(),
        name: z.string(),
        status: z.enum([
          "PARTIALLY_RECONSTRUCTED",
          "RECONSTRUCTED_WITH_UNRESOLVED_DEPENDENCIES",
          "IMPORT_FAILED",
        ]),
        issues: z.array(z.string()),
        capabilities: z.array(
          z.object({ name: z.string(), status: z.string() }),
        ),
      }),
    )
    .max(30),
});

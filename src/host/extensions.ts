import { verifyPayload } from "./trust.ts";
// Extension lifecycle (architecture: extensions may request capabilities and
// tools, but installing or enabling an extension never grants authority).
//
// An extension is data: a validated manifest describing what it would
// *like* to use. The non-escalation guarantee is structural:
//
//   * Installing an extension performs no policy change. It cannot attach a
//     provider, enable a capability, or add a tool to the mediation layer.
//   * A manifest may only *request* capability ids that already exist in the
//     build. Unknown requests are recorded as unresolved and grant nothing.
//   * Enabling a requested capability remains a separate administrator action
//     through the ordinary policy path, and still requires an attached provider.
//
// This module therefore returns an explicit, auditable report proving that an
// install granted nothing.

import { z } from "zod";

export const extensionManifestSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9._-]{1,63}$/),
    name: z.string().trim().min(1).max(80),
    version: z.string().trim().min(1).max(32),
    description: z.string().trim().max(400).default(""),
    // Capability ids the extension would like to use. Declaring is not granting.
    requests: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
    // Tool names the extension would like to expose. Declaring is not granting.
    tools: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
  })
  .strict();

export type ExtensionManifest = z.infer<typeof extensionManifestSchema>;

export interface ExtensionRequestStatus {
  capability: string;
  known: boolean;
  // Snapshot of the capability's authority at install time; installing must not
  // change either of these.
  enabled: boolean;
  attached: boolean;
}

export interface ExtensionInstallReport {
  id: string;
  name: string;
  version: string;
  // Every install reports an empty grant list: extensions never receive
  // authority as a side effect of installation.
  grants: [];
  requests: ExtensionRequestStatus[];
  tools: string[];
  installedAt: number;
}

export interface InstalledExtension extends ExtensionInstallReport {
  manifest: ExtensionManifest;
}

// A minimal view of a capability the registry needs to prove non-escalation.
export interface CapabilityFact {
  id: string;
  enabled: boolean;
  attached: boolean;
}

export class ExtensionRegistry {
  private installed = new Map<string, InstalledExtension>();

  list(): InstalledExtension[] {
    return [...this.installed.values()];
  }

  get(id: string): InstalledExtension | undefined {
    return this.installed.get(id);
  }

  // Validates and records a manifest. `capabilities` is the current capability
  // fact set; the returned report shows that installing changed nothing.
  install(
    manifestInput: unknown,
    capabilities: CapabilityFact[],
  ): ExtensionInstallReport {
    const manifest = extensionManifestSchema.parse(manifestInput);
    const byId = new Map(capabilities.map((cap) => [cap.id, cap]));
    const requests: ExtensionRequestStatus[] = manifest.requests.map(
      (capability) => {
        const fact = byId.get(capability);
        return {
          capability,
          known: !!fact,
          enabled: fact?.enabled ?? false,
          attached: fact?.attached ?? false,
        };
      },
    );
    const record: InstalledExtension = {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      grants: [],
      requests,
      tools: [...manifest.tools],
      installedAt: Date.now(),
      manifest,
    };
    this.installed.set(manifest.id, record);
    return record;
  }

  installSigned(
    envelope: unknown,
    trustedPublicKey: string,
    capabilities: CapabilityFact[],
  ) {
    // The trust anchor is host configuration, never a key supplied by the manifest.
    const payload = JSON.parse(verifyPayload(envelope, trustedPublicKey));
    const signed = z
      .object({
        purpose: z.literal("acos-extension-v1"),
        manifest: extensionManifestSchema,
      })
      .strict()
      .parse(payload);
    return this.install(signed.manifest, capabilities);
  }

  remove(id: string): boolean {
    return this.installed.delete(id);
  }
}

// Structural proof of the non-escalation guarantee: given the capability facts
// before and after an extension operation, assert that no authority changed.
// Returns the list of escalations (always empty in a correct build); the caller
// treats a non-empty list as a fatal integrity error.
export function detectEscalation(
  before: CapabilityFact[],
  after: CapabilityFact[],
): string[] {
  const escalations: string[] = [];
  const afterById = new Map(after.map((cap) => [cap.id, cap]));
  for (const prev of before) {
    const next = afterById.get(prev.id);
    if (!next) continue;
    if (!prev.enabled && next.enabled)
      escalations.push(`${prev.id}: capability enabled by extension`);
    if (!prev.attached && next.attached)
      escalations.push(`${prev.id}: provider attached by extension`);
  }
  return escalations;
}

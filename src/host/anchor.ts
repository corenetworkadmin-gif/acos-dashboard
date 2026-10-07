import { z } from "zod";
import { verifyPayload } from "./trust.ts";
const checkpointSchema = z
  .object({
    purpose: z.literal("acos-audit-anchor-v1"),
    companion: z.string().min(1).max(100),
    sequence: z.number().int().safe().nonnegative(),
    hash: z.string().regex(/^(?:[a-f0-9]{64})?$/),
    createdAt: z.number().int().safe().nonnegative(),
  })
  .strict()
  .refine((p) => (p.sequence === 0) === (p.hash === ""), "Invalid journal tip");
export function verifyCheckpoint(input: unknown, pinnedKey: string) {
  // Export includes a convenience key; it can never establish trust by itself.
  const value = z
    .object({
      payload: z.unknown(),
      signature: z.unknown(),
      publicKey: z.string().optional(),
    })
    .strict()
    .parse(input);
  return checkpointSchema.parse(
    JSON.parse(
      verifyPayload(
        { payload: value.payload, signature: value.signature },
        pinnedKey,
      ),
    ),
  );
}
export function compareCheckpoint(
  input: unknown,
  pinnedKey: string,
  journal: {
    companion: string;
    sequence: number;
    hashAt(sequence: number): string | null;
  },
) {
  const checkpoint = verifyCheckpoint(input, pinnedKey);
  if (checkpoint.companion !== journal.companion)
    throw new Error("Checkpoint belongs to a different companion.");
  if (checkpoint.sequence > journal.sequence)
    throw new Error(
      "Journal is older than the retained checkpoint: possible rollback or truncation.",
    );
  if (
    checkpoint.sequence > 0 &&
    journal.hashAt(checkpoint.sequence) !== checkpoint.hash
  )
    throw new Error(
      "Journal diverges from the independently retained checkpoint.",
    );
  return {
    verified: true as const,
    sequence: checkpoint.sequence,
    createdAt: checkpoint.createdAt,
    laterEntries: journal.sequence - checkpoint.sequence,
  };
}

import {
  createPublicKey,
  createPrivateKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomUUID,
} from "node:crypto";
import { z } from "zod";
import { decryptValue, encryptValue } from "./crypto.ts";
import { verifyPayload, type HostIdentity } from "./trust.ts";
export const offerSchema = z
  .object({
    purpose: z.literal("acos-migration-offer-v1"),
    id: z.string().uuid(),
    publicKey: z.string().max(200),
    expiresAt: z.number().int().positive(),
  })
  .strict();
export const ticketSchema = z
  .object({
    purpose: z.literal("acos-migration-ticket-v1"),
    offerId: z.string().uuid(),
    ephemeralKey: z.string().max(200),
    sealed: z.string().max(450_000),
  })
  .strict();
function transferKey(privateKey: string, publicKey: string, offerId: string) {
  const privateObject = createPrivateKey(privateKey),
    publicObject = createPublicKey(publicKey);
  if (
    privateObject.asymmetricKeyType !== "x25519" ||
    publicObject.asymmetricKeyType !== "x25519"
  )
    throw new Error("Migration requires X25519 keys.");
  return Buffer.from(
    hkdfSync(
      "sha256",
      diffieHellman({ privateKey: privateObject, publicKey: publicObject }),
      offerId,
      "acos-migration-v1",
      32,
    ),
  );
}
export function createMigrationOffer(identity: HostIdentity) {
  const keys = generateKeyPairSync("x25519");
  const offer = {
    purpose: "acos-migration-offer-v1" as const,
    id: randomUUID(),
    publicKey: keys.publicKey
      .export({ format: "pem", type: "spki" })
      .toString(),
    expiresAt: Date.now() + 86_400_000,
  };
  return {
    offer,
    signed: identity.sign(offer),
    privateKey: keys.privateKey
      .export({ format: "pem", type: "pkcs8" })
      .toString(),
  };
}
export function prepareTransfer(
  identity: HostIdentity,
  signedOffer: unknown,
  destinationKey: string,
  payload: unknown,
) {
  const offer = offerSchema.parse(
    JSON.parse(verifyPayload(signedOffer, destinationKey)),
  );
  if (offer.expiresAt <= Date.now())
    throw new Error("Migration offer expired.");
  const keys = generateKeyPairSync("x25519");
  const key = transferKey(
    keys.privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    offer.publicKey,
    offer.id,
  );
  const serialized = JSON.stringify(payload);
  if (Buffer.byteLength(serialized) > 300_000)
    throw new Error("Migration payload exceeds transfer limit.");
  return identity.sign({
    purpose: "acos-migration-ticket-v1",
    offerId: offer.id,
    ephemeralKey: keys.publicKey
      .export({ format: "pem", type: "spki" })
      .toString(),
    sealed: encryptValue(key, serialized, offer.id),
  });
}
export function openTransfer(
  signed: unknown,
  sourceKey: string,
  offer: z.infer<typeof offerSchema>,
  privateKey: string,
) {
  const ticket = ticketSchema.parse(
    JSON.parse(verifyPayload(signed, sourceKey)),
  );
  if (ticket.offerId !== offer.id || offer.expiresAt <= Date.now())
    throw new Error("Migration offer mismatch or expired.");
  return JSON.parse(
    decryptValue(
      transferKey(privateKey, ticket.ephemeralKey, offer.id),
      ticket.sealed,
      offer.id,
    ),
  );
}

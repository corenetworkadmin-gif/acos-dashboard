# Desktop recovery and trust

## Companion recovery

Settings → Recovery and audit checkpoints exports an AES-256-GCM encrypted backup
of the current companion and recent conversation. Restore requires an administrator
session and explicit replacement confirmation. It accepts only the same installation
storage key and current companion identity, preserves current policy and the existing
audit chain, and leaves the companion paused with its engine stopped.

This is companion recovery, not a complete installation backup: archived older turns,
scheduled tasks, host credentials and keys are not exported. Preserve the original
storage key separately. A lost key cannot be reconstructed from an export.

## Authenticated migration

Settings → Authenticated migration implements an offline, two-host protocol:

1. The destination creates an Ed25519-signed, expiring offer with an X25519 public key.
2. The source administrator independently verifies the destination identity key.
3. The source encrypts companion state for that offer, commits a permanent retirement
   marker together with its audit/state transaction, and only then releases its signed ticket.
4. The destination independently verifies the source key, decrypts the ticket and
   consumes the offer in the same transaction that replaces its companion.

Destination policy is retained; source permissions are never imported. Tickets are
bound to a single offer. Retry downloads from a retired source return the same ticket.
Source retirement blocks operations after restart and cannot be undone by companion
backup restore. Keep both installations intact until destination acceptance succeeds.

This assumes trusted host administrators. It does not defeat disk cloning or rollback
by an administrator who controls the OS and signing keys. Hardware-backed identity and
anti-rollback protection remain necessary for that stronger requirement. Existing legacy
JSON relocation imports remain reconstruction, not proof of source retirement.

## Signed audit checkpoints

Download a signed checkpoint from Settings. Retain it outside the ACOS data directory,
with its signing public key independently pinned. Verify it with:

```bash
node --experimental-strip-types src/host/release-cli.ts audit CHECKPOINT.json PINNED_PUBLIC.pem
```

The signature binds companion ID, journal sequence, chain hash and timestamp. A signature
proves possession of the pinned signing key. Settings now accepts an independently retained checkpoint
and pinned key, verifies the current chain and compares the signed sequence/hash with it.
This detects truncation or divergence through that checkpoint; later entries are not covered.
No trusted timestamp or managed external anchoring service is supplied. Retain the file
and its pinned key outside the installation (for example, owner-managed immutable storage).
The host's Ed25519 identity key is an owner-only file, not a TPM/Secure Enclave key.

## Optional authenticator factor

Provision an owner-only JSON file outside the checkout containing a random 20-byte
secret encoded as 32 uppercase Base32 characters and an initial counter:

```json
{"secret":"<32 uppercase Base32 characters>","lastCounter":-1}
```

Enroll the same secret in an authenticator configured for TOTP, SHA-1, six digits,
30-second periods. Set `ACOS_MFA_FILE` to the file and restart the host. Do not use the
placeholder literally. Unlock now requires both the administrator key and the code.
The host accepts one step of clock skew and records the consumed counter before
issuing a session; replay is rejected across restarts. Missing/malformed configured
files fail closed. Protect the parent directory and preserve the updated counter.
There is no web enrollment/reset route: recovery is a trusted local administrator
operation. This software factor is not hardware-backed identity.

## Signed release verification

`releases.ts` validates Ed25519 signatures against an independently pinned key, target
platform/architecture, expiry, increasing release sequence and artifact size/SHA-256.
`release-cli.ts` can sign or verify a prepared release manifest:

```bash
ACOS_RELEASE_SIGNING_KEY_FILE=/private/release.pem node --experimental-strip-types src/host/release-cli.ts sign manifest.json acos-release.tar.gz signed-manifest.json
ACOS_RELEASE_PUBLIC_KEY_FILE=/trusted/release-public.pem ACOS_RELEASE_CURRENT_SEQUENCE=0 node --experimental-strip-types src/host/release-cli.ts verify signed-manifest.json acos-release.tar.gz
```

The manifest schema is exported from `releases.ts`. Signing refuses an artifact that
does not match it. Verification performs no installation. The update CLI adds HTTPS download, staged activation, health checks, rollback and a
persistent sequence high-water mark; see [desktop releases](desktop-releases.md). Production signing identities and OS certificate
signing must be supplied by the owner. Test-generated keys do not establish release trust.

## Signed extension manifests

Set `ACOS_EXTENSION_PUBLIC_KEY_FILE` to a pinned Ed25519 public key to require signed
installation requests. Sign JSON with purpose `acos-extension-v1` and a `manifest` field
matching the existing manifest schema. The existing install API accepts the signed
`{payload, signature}` envelope in its `manifest` field. Installation remains inert and
grants no capabilities. Without a configured key, legacy unsigned inert manifests are
still accepted. Isolated extension execution is not implemented.

## Desktop keystore

Set `ACOS_STORAGE_KEY_PROVIDER=secret-service` on Linux with `/usr/bin/secret-tool`
and an unlocked Secret Service session. Existing file keys are migrated only after
a successful store and matching lookup; failures preserve the file and refuse startup.
Keep the same data-directory path because it identifies the keyring item. This is a
desktop keyring integration, not a claim of TPM-backed storage. Real-session validation
is outstanding in this sandbox. The default remains owner-only file storage.

## Optional TPM administrator proof

See [administrator identity](admin-identity.md) for the Linux TPM signing helper and single-use
login challenges. This can be combined with the existing admin key and TOTP. Hardware
provisioning and real TPM verification are outstanding; software test keys do not prove hardware trust.

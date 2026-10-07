# Administrator identity and MFA

ACOS can require three independent checks at unlock: the installation administrator key,
a signature from a provisioned RSA identity, and an authenticator TOTP code. The signature
factor is optional; without its configuration, existing key/TOTP behavior is unchanged.

## TPM signing path (Linux; hardware verification outstanding)

`identity.ts` verifies expiring, single-use RSA/SHA-256 proofs. `identity-cli.ts` signs
challenges using tpm2-tools and `/dev/tpmrm0`. The private key stays in the TPM. The helper
checks the independently pinned public key and the `fixedtpm`, `fixedparent`,
`sensitivedataorigin` and signing attributes before signing. It uses an explicit device
TCTI, fixed executable paths, cleared environment, bounded output and a timeout.

Provision an **unrestricted RSA signing key, 2048 bits or greater**, with those attributes,
using your platform administrator's TPM procedure. Persist it at an unused owner-selected
handle. Export its public key with `tpm2_readpublic -c HANDLE -f pem -o admin-public.pem`.
Protect the handle with suitable TPM authorization and OS device permissions. Do not
replace or evict an existing handle. This task does not provision or change a machine's TPM.

Configure the host with `ACOS_ADMIN_IDENTITY_PUBLIC_KEY_FILE` pointing to an independently
verified public PEM file owned by the ACOS account and not writable by group/others.
A missing or invalid configured key refuses startup. Restart the host. Also configure
`ACOS_MFA_FILE` as described in [lifecycle trust](lifecycle-trust.md) when TOTP is required.

On the operator's TPM machine, set:

```dotenv
ACOS_TPM_HANDLE=0x81010001
ACOS_ADMIN_IDENTITY_PUBLIC_KEY_FILE=/trusted/admin-public.pem
ACOS_IDENTITY_INSTALLATION=<SHA-256 SPKI fingerprint of the installation identity key>
ACOS_IDENTITY_HOST=localhost:8080
ACOS_TPM_AUTH_FILE=/private/tpm-auth
```

These are examples; choose the actual handle, paths and host. Obtain the installation's
public key from Settings → Authenticated migration and independently pin its SPKI
fingerprint. It is separate from the administrator's TPM public key. The host value must
match the dashboard's HTTP Host header, including its port. The optional authorization
file must be owned by the operator with mode 0600; its contents never go on the command
line. tpm2-tools must be installed at `/usr/bin/tpm2_readpublic` and `/usr/bin/tpm2_sign`.

1. Enter the administrator key in the unlock screen. Expand Hardware identity and request
   a challenge. Save its exact text to a local file.
2. Run `node --experimental-strip-types src/host/identity-cli.ts /private/challenge.txt`.
3. Paste the resulting signature into Device signature, enter the TOTP code if enabled,
   and unlock within two minutes. A failed proof consumes the challenge; obtain a new one.

The server caps outstanding challenges, binds them to installation/key/host, expires them,
rejects replay and forgets them on restart. A signing request is never automatically
approved by the host process. This manual proof flow is not WebAuthn or a claim of phishing
resistance. Anyone able to use the TPM key and obtain the other factors can authenticate.

## Verification and limits

Unit and HTTP tests use synthetic software RSA keys to test challenge boundaries. They
**do not establish TPM execution or hardware provenance**. This sandbox has no TPM, so
provisioning, signing, authorization failures and non-exportability must be verified on
the target machine. The server trusts local public-key provisioning; remote attestation
and manufacturer trust-chain verification are not implemented. A software-generated key
can be pinned, in which case the factor must not be described as hardware-backed.

Secure Enclave and native Windows TPM adapters remain open. The existing Linux Secret
Service option moves `storage.key` into an unlocked desktop keyring after read-back
verification; it does not imply TPM sealing. Host journal/migration signing still uses
the separate Ed25519 installation key. TPM admin login does not prevent an OS administrator
from cloning or rolling back the installation, or establish hardware anti-replication.

Implementation follows [tpm2_sign](https://github.com/tpm2-software/tpm2-tools/blob/5.7/man/tpm2_sign.1.md)
and [tpm2_readpublic](https://github.com/tpm2-software/tpm2-tools/blob/5.7/man/tpm2_readpublic.1.md).

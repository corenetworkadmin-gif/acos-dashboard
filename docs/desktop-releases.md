# Signed desktop releases and rollback

The current packaged target is Linux with Node 24+, Bubblewrap and util-linux. The
portable archive embeds the host dependencies and built UI. It contains no host keys,
model, configuration, companion database or signing secrets.

```bash
bash src/host/package-release.sh /absolute/output/directory
```

This creates `acos-linux-x64.tar.gz` (or the actual architecture) and its `.sha256` file.
Create a manifest matching `releaseManifestSchema` in `src/host/releases.ts`:

```json
{
  "purpose": "acos-release-v1",
  "stateSchema": 1,
  "version": "0.2.0",
  "sequence": 1,
  "platform": "linux",
  "architecture": "x64",
  "expiresAt": 1800000000000,
  "artifact": { "name": "acos-linux-x64.tar.gz", "bytes": 123, "sha256": "<actual 64-character SHA-256>" }
}
```

Replace sample size, digest, sequence and expiry with actual release values. Only
releases supporting lifecycle state schema 1 may be signed for this update path;
rollback must preserve its retirement markers and authority semantics. The signer
is responsible for that compatibility contract. Sign using the offline owner key:

```bash
ACOS_RELEASE_SIGNING_KEY_FILE=/private/release.pem node --experimental-strip-types src/host/release-cli.ts sign manifest.json acos-linux-x64.tar.gz signed-manifest.json
```

Pin the corresponding public key independently of the download. Keep configuration,
`ACOS_DATA_DIR` and `ACOS_UPDATE_ROOT` outside the release directories. Load your existing
host configuration through an explicit absolute `--env-file` path. Stop the running
app before switching releases; an existing process continues running its old code.

```bash
export ACOS_RELEASE_PUBLIC_KEY_FILE=/trusted/release-public.pem
# Optional: defaults to ~/.local/share/acos-updates
export ACOS_UPDATE_ROOT=/private/acos-updates
node --experimental-strip-types src/host/update-cli.ts apply signed-manifest.json acos-linux-x64.tar.gz
node --env-file=/private/acos.env --experimental-strip-types src/host/update-cli.ts launch
```

Open `http://localhost:8080`. Host and built UI share the loopback entry point. The
updater verifies signature, expiry, target, increasing sequence, size and checksum;
extracts only bounded regular files/directories from USTAR; and starts the staged host
with disposable data to check its API and UI. Failure leaves the current pointer intact.
Application activation changes one atomic pointer; no companion policy or data is copied.

For a channel, publish the signed manifest and its named archive alongside one another
on an owner-controlled HTTPS endpoint:

```bash
node --experimental-strip-types src/host/update-cli.ts update https://your-release-host/path/signed-manifest.json
node --experimental-strip-types src/host/update-cli.ts rollback
```

Channel downloads reject redirects, URL credentials, excess size and expired manifests.
Rollback health-checks the previous accepted release and preserves the sequence high-water
mark, preventing replay of an old channel manifest. It switches code, not data: database
schema compatibility remains mandatory. These are explicit commands, not background updates.
After a crashed update, inspect the staging directory and `update.lock`; only remove the
lock after confirming its recorded process is gone. The updater fails closed on a stale lock.

Production trust keys, OS signing certificates, hosted distribution and independent review
are not supplied by this implementation. Generated task artifacts are unsigned development
packages. Never use a self-generated test key as evidence of an owner-authenticated release.

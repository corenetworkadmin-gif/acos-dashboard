# Run ACOS on macOS

ACOS runs natively on macOS (Apple silicon and Intel). The host, the dashboard
and the offline AI engine all run locally; nothing is sent to a network. The
engine is confined with the macOS **Seatbelt** sandbox (`sandbox-exec`) plus
`ulimit` resource caps, selected by the same `IsolationAdapter` the Linux and
Windows builds use.

> **Status (honest).** The macOS installer, the app bundle and the Darwin
> isolation adapter are **implemented and unit-tested** in this Linux sandbox
> (argv, Seatbelt profile and limit mapping are asserted by the host test suite).
> The actual macOS build, the `sandbox-exec` enforcement and the LaunchAgent have
> **not** been executed on a Mac here, so they are **unverified on target
> hardware**. `sandbox-exec` is deprecated by Apple but remains functional; ACOS
> fails closed (disables inference) if it is unavailable rather than running the
> engine unconfined.

## Requirements

- macOS 13 (Ventura) or newer.
- Node.js 24+ and pnpm 10 (`corepack enable pnpm`, or `brew install node@24`).
- Xcode command-line tools are **not** required for the default path; they are
  only needed if you build a CPU engine from source.

## 1. Get the source

```bash
cd ~
git clone https://github.com/corenetworkadmin-gif/acos-dashboard.git acos-dashboard
cd ~/acos-dashboard
```

## 2. Install dependencies and build

```bash
corepack enable pnpm      # provides pnpm 10
pnpm install
pnpm build
```

## 3. Install the desktop app

```bash
bash src/macos/install-macos.sh
```

This is idempotent (re-running is an upgrade). It installs, per user, with no
root:

- `~/Applications/ACOS.app` — a double-clickable bundle (shows in Launchpad).
- `~/.local/bin/acos` — a CLI launcher (add `~/.local/bin` to `PATH`).
- With `--login-item`, a LaunchAgent at
  `~/Library/LaunchAgents/com.acos.host.plist` so ACOS starts at login.

Useful flags:

```bash
bash src/macos/install-macos.sh --dry-run       # print actions, change nothing
bash src/macos/install-macos.sh --login-item    # also start ACOS at login
bash src/macos/install-macos.sh --build         # force a dashboard rebuild
bash src/macos/install-macos.sh --uninstall     # remove bundle, launcher, login item
bash src/macos/install-macos.sh --uninstall --purge   # also delete companion data
```

## 4. Install the offline engine (optional)

The dashboard and companion Home work without a model. To enable local
inference, install the reference engine and model:

```bash
pnpm setup:engine
```

On Apple silicon the reference engine download is x64; configure a matching
`arm64` `llama.cpp` build and model via `.env.local` (see `.env.example`) if the
reference binary does not run under Rosetta. Model execution is offline after
installation.

## 5. Launch

Open **ACOS** from Launchpad/Applications, or run:

```bash
~/.local/bin/acos
```

When the terminal says **ACOS is ready**, open **http://localhost:8080** in
Safari, Chrome or Firefox. Keep the terminal open; **Ctrl-C stops the host and
dashboard together**. Closing the terminal also stops ACOS.

## 6. Unlock and optionally load the model

Read the administrator key **locally**:

```bash
cat ~/.local/share/acos/admin.key
```

Paste it into the dashboard's Administrator key field. Do not send this key in
chat or commit it to GitHub. Then: **Local engine** → **Open administrator
session** → **Verify & load model**; optionally enable **Read/Write companion
Home**; **Close administrator session**; **Resume companion**; open
**Companion** and send a message.

## Isolation on macOS

The Darwin adapter builds a deny-by-default Seatbelt profile that permits reading
only the system libraries and the engine/model paths, executing only the engine
binary, and writing only to declared scratch — with `(deny network*)`. It wraps
the engine in `bash -c 'ulimit -t … -n … -f …; exec "$@"'` for CPU, file-size and
open-file caps. The address-space cap (`ulimit -v`) is best-effort on Darwin; the
wall-clock deadline in the host remains the primary limit.

If `sandbox-exec` is missing, discovery reports isolation unavailable and the
host **refuses to run inference** rather than run it unconfined. Run
`pnpm run check:host` to see the detected isolation mechanism and resources.

## If startup fails

- **Port already in use:** close the earlier ACOS launcher. For intentional
  custom ports set `ACOS_PORT` / `ACOS_DASHBOARD_PORT` in `.env.local`.
- **Isolation unavailable:** confirm `/usr/bin/sandbox-exec` exists. If it is
  missing, inference stays disabled by design.
- **Gatekeeper warning on first open:** the bundle is unsigned; right-click the
  app and choose **Open**, or run the CLI launcher.
- **Model not ready after restart:** verify/load again in Local engine. Identity,
  memories and conversations persist in the host database.

## Verification scope

The Darwin adapter's pure logic, the installer's dry-run behaviour and the host
test suite are verified in the development sandbox. The actual macOS build, the
app bundle, the LaunchAgent and Seatbelt enforcement require verification on a
Mac; this repository cannot exercise them remotely.

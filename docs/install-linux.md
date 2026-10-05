# Install ACOS on Linux

ACOS installs as a normal per-user desktop application. No root is required and
your shell profile is never modified. The installer adds a launcher on your
`PATH`, a freedesktop `.desktop` entry, and an icon, then leaves the companion
database and administrator key in `~/.local/share/acos`.

## Prerequisites

Run the setup once from the checkout so the pinned toolchain and dependencies are
present:

```bash
cd ~/acos-dashboard
bash src/host/setup-wsl.sh      # works on any Ubuntu 24.04 host, not just WSL
```

`setup-wsl.sh` installs Ubuntu prerequisites (including Bubblewrap and
`util-linux`), the checksum-pinned Node.js 24 and pnpm 10 into
`~/.local/share/acos-tools`, and the locked dependencies. It does not install an
AI engine by default; see the optional engine section below.

## Install

```bash
cd ~/acos-dashboard
bash src/host/install-linux.sh
```

Or, equivalently, `pnpm install:linux`. Useful options:

| Option | Effect |
| --- | --- |
| `--prefix DIR` | Install under `DIR` instead of `~/.local`. |
| `--build` | Force a dashboard rebuild even if `dist/` already exists. |
| `--uninstall` | Remove the launcher, desktop entry and icon. |
| `--purge` | With `--uninstall`, also delete the companion data directory. |

The installer is idempotent: running it again is an in-place upgrade and leaves a
valid launcher, entry and icon.

## Launch

Open **ACOS** from your application menu, or run the launcher directly:

```bash
~/.local/bin/acos
```

The launcher starts the private host API and the dashboard, checks readiness, and
binds both to loopback. Keep the terminal open; **Ctrl-C stops both services**.

## Unlock and load the model

Read your administrator key locally (never paste it into chat):

```bash
cat ~/.local/share/acos/admin.key
```

Then, in the dashboard: **Local engine → Open administrator session → Verify &
load model**. Optionally enable the Home read/write capabilities, close the
administrator session, and start chatting.

## Optional AI engine

On x64, install the pinned offline engine and model (~510 MB):

```bash
cd ~/acos-dashboard
pnpm setup:engine
```

On other architectures, configure an engine and model matching your hardware as
described in `.env.example`. ACOS starts and runs without a model; only inference
requires one.

## Uninstall

```bash
bash src/host/install-linux.sh --uninstall          # keep companion data
bash src/host/install-linux.sh --uninstall --purge  # delete companion data too
```

## Verification scope

The installer, launcher generation, desktop entry, upgrade and uninstall are
tested automatically in the development sandbox (`src/host/packaging.test.ts`).
Menu integration depends on your desktop environment indexing
`~/.local/share/applications`; run `update-desktop-database` if your menu does not
refresh immediately.

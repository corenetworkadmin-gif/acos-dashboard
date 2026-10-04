#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == "--help" ]]; then
  echo 'ACOS setup for Windows 11: run this script inside Ubuntu 24.04 on WSL2.'
  echo 'Installs Ubuntu prerequisites, pinned user-local Node/pnpm, dependencies, and the reference AI model.'
  echo 'Keeps existing .env.local and companion data. Run bash src/host/start-local.sh afterwards.'
  exit 0
fi
if [[ "$(uname -s)" != Linux || "$(uname -m)" != x86_64 ]]; then
  echo 'This reference installer requires an Intel/AMD x64 computer running WSL2. ARM is not supported by the pinned engine.' >&2
  exit 1
fi
if ! grep -qi 'microsoft.*WSL2' /proc/sys/kernel/osrelease; then
  echo 'Run this installer inside WSL2. In Windows PowerShell, check: wsl --list --verbose' >&2
  exit 1
fi
if [[ "$EUID" -eq 0 ]]; then
  echo 'Use your normal Ubuntu account, not root. The script requests sudo only for Ubuntu packages.' >&2
  exit 1
fi
source /etc/os-release
if [[ "$ID" != ubuntu || "$VERSION_ID" != 24.04 ]]; then
  echo 'Use Ubuntu-24.04. Older Bubblewrap versions lack the required temporary-filesystem size limit.' >&2
  exit 1
fi
repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
cd "$repo_dir"
case "$(findmnt -n -o FSTYPE --target "$repo_dir")" in
  9p|drvfs|ntfs|fuseblk) echo 'Clone ACOS inside your Linux home (~/acos-dashboard), not a Windows drive.' >&2; exit 1 ;;
esac
sudo apt-get update
sudo apt-get install -y ca-certificates curl git xz-utils bubblewrap util-linux
source src/host/toolchain.sh
mkdir -p "$acos_tools_root"
node_dir="$acos_tools_root/node-v24.14.1-linux-x64"
if [[ ! -x "$node_dir/bin/node" ]] || [[ "$("$node_dir/bin/node" --version)" != v24.14.1 ]]; then
  node_stage="$(mktemp -d "$acos_tools_root/.node.XXXXXX")"
  trap 'rm -r -- "$node_stage"' EXIT
  curl --fail --location --retry 2 --connect-timeout 15 --max-time 300 https://nodejs.org/dist/v24.14.1/node-v24.14.1-linux-x64.tar.xz -o "$node_stage/node.tar.xz"
  echo "84d38715d449447117d05c3e71acd78daa49d5b1bfa8aacf610303920c3322be  $node_stage/node.tar.xz" | sha256sum --check
  tar -xJf "$node_stage/node.tar.xz" -C "$node_stage"
  mkdir -p "$node_dir"
  cp -a "$node_stage/node-v24.14.1-linux-x64/." "$node_dir/"
fi
source src/host/toolchain.sh
if [[ ! -x "$acos_tools_root/pnpm/node_modules/.bin/pnpm" ]] || [[ "$("$acos_tools_root/pnpm/node_modules/.bin/pnpm" --version)" != 10.34.5 ]]; then
  npm install --prefix "$acos_tools_root/pnpm" --ignore-scripts --no-audit --no-fund pnpm@10.34.5
fi
source src/host/toolchain.sh
pnpm install --frozen-lockfile
pnpm run check:host
if [[ -f .env.local ]]; then
  echo 'Keeping existing .env.local. Model configuration will be verified when loading the engine.'
else
  pnpm setup:engine
fi
pnpm build
printf '\nSetup complete. Start ACOS with: bash src/host/start-local.sh\n'
printf 'Keep the launcher terminal open while using http://localhost:8080 from Windows.\n'

#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == "--help" ]]; then
  echo 'ACOS setup for Windows 11: run this script inside Ubuntu 24.04 on WSL2.'
  echo 'Installs Ubuntu prerequisites, pinned user-local Node/pnpm, and dependencies. Set ACOS_INSTALL_REFERENCE_ENGINE=1 to add the optional x64 CPU model.'
  echo 'Keeps existing .env.local and companion data. Run bash src/host/start-local.sh afterwards.'
  exit 0
fi
[[ "$(uname -s)" == Linux ]] || { echo 'Run inside Ubuntu on WSL2.' >&2; exit 1; }
case "$(uname -m)" in
  x86_64) node_arch=x64; node_hash=84d38715d449447117d05c3e71acd78daa49d5b1bfa8aacf610303920c3322be ;;
  aarch64|arm64) node_arch=arm64; node_hash=71e427e28b78846f201d4d5ecc30cb13d1508ca099ef3871889a1256c7d6f67e ;;
  *) echo 'This installer provides Node builds for x64 and ARM64. Supply a compatible Node 24+ build for other architectures.' >&2; exit 1 ;;
esac
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
node_dir="$acos_tools_root/node-v24.14.1-linux-$node_arch"
if [[ ! -x "$node_dir/bin/node" ]] || [[ "$("$node_dir/bin/node" --version)" != v24.14.1 ]]; then
  node_stage="$(mktemp -d "$acos_tools_root/.node.XXXXXX")"
  trap 'rm -r -- "$node_stage"' EXIT
  curl --fail --location --retry 2 --connect-timeout 15 --max-time 300 "https://nodejs.org/dist/v24.14.1/node-v24.14.1-linux-$node_arch.tar.xz" -o "$node_stage/node.tar.xz"
  echo "$node_hash  $node_stage/node.tar.xz" | sha256sum --check
  tar -xJf "$node_stage/node.tar.xz" -C "$node_stage"
  mkdir -p "$node_dir"
  cp -a "$node_stage/node-v24.14.1-linux-$node_arch/." "$node_dir/"
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
elif [[ "${ACOS_INSTALL_REFERENCE_ENGINE:-0}" == 1 ]]; then
  if ! pnpm setup:engine; then
    echo 'Optional engine installation failed. ACOS will start without inference; inspect the error and configure a compatible engine later.' >&2
  fi
else
  echo 'ACOS installed without an AI engine. Optionally run pnpm setup:engine on x64, or configure a compatible local CPU engine.'
fi
pnpm build
printf '\nSetup complete. Start ACOS with: bash src/host/start-local.sh\n'
printf 'Keep the launcher terminal open while using http://localhost:8080 from Windows.\n'

#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == "--help" ]]; then
  echo 'Start the built ACOS dashboard and host together. Ctrl-C stops both.'
  echo 'Requires Linux/WSL2, Node 24+, installed dependencies, and pnpm build.'
  exit 0
fi
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
source src/host/toolchain.sh
exec node --env-file-if-exists=.env.local --experimental-strip-types src/host/launch.ts

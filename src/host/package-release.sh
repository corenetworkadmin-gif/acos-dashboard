#!/usr/bin/env bash
set -euo pipefail
# Build an unsigned portable desktop archive. Sign its manifest separately with
# the owner's offline release key. No host configuration or data enters it.
output="${1:?Usage: package-release.sh ABSOLUTE_OUTPUT_DIRECTORY}"
[[ "$output" = /* ]] || { echo 'Output directory must be absolute.' >&2; exit 1; }
pnpm build
pnpm exec vite build --config vite.release.config.ts
staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT
mkdir -p "$output" "$staging/web"
cp .release-build/server.mjs "$staging/server.mjs"
cp -R dist/. "$staging/web/"
artifact="acos-$(node -p 'process.platform + "-" + process.arch').tar.gz"
tar --format=ustar -czf "$output/$artifact" -C "$staging" server.mjs web
(cd "$output" && sha256sum "$artifact" > "$artifact.sha256")
echo "Unsigned release: $output/$artifact"

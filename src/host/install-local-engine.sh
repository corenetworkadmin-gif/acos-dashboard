#!/usr/bin/env bash
# Pinned CPU-only reference provider. No root or provider credentials required.
set -euo pipefail
if [[ "${1:-}" == "--help" ]]; then
  echo 'Install pinned llama.cpp b11392 and Qwen2.5-0.5B-Instruct Q4_K_M (~510 MB download).'
  echo 'Optional: ACOS_ENGINE_DIR for installation root; ACOS_ENGINE_ENV_FILE for environment file.'
  exit 0
fi
[[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]] || { echo 'Reference installer requires Linux x86_64.' >&2; exit 1; }
command -v bwrap >/dev/null || { echo 'Install bubblewrap with your system package manager first.' >&2; exit 1; }
command -v prlimit >/dev/null
node -e 'if (Number(process.versions.node.split(".")[0]) < 24) throw Error("Node 24+ required")'
install_dir="${ACOS_ENGINE_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/acos-engine}"
config_file="${ACOS_ENGINE_ENV_FILE:-.env.local}"
mkdir -p "$install_dir"
install_dir="$(cd "$install_dir" && pwd)"
staging_dir="$(mktemp -d "$install_dir/.download.XXXXXX")"
trap 'rm -r -- "$staging_dir"' EXIT
curl --fail --location --retry 2 'https://github.com/ggml-org/llama.cpp/releases/download/b11392/llama-b11392-bin-ubuntu-x64.tar.gz' -o "$staging_dir/engine.tar.gz"
echo "8a034f0dc51b2dcf7d491f89015fbaccd7a03f5657dd9da2c96620a42940efeb  $staging_dir/engine.tar.gz" | sha256sum --check
model_name=qwen2.5-0.5b-instruct-q4_k_m.gguf
model_hash=74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db
if ! echo "$model_hash  $install_dir/$model_name" | sha256sum --check --status 2>/dev/null; then
  curl --fail --location --retry 2 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf' -o "$staging_dir/$model_name"
  echo "$model_hash  $staging_dir/$model_name" | sha256sum --check
  mv "$staging_dir/$model_name" "$install_dir/$model_name"
fi
tar -xzf "$staging_dir/engine.tar.gz" -C "$staging_dir"
# Versioned destination is only replaced by this exact verified archive.
mkdir -p "$install_dir/llama-b11392"
cp -a "$staging_dir/llama-b11392/." "$install_dir/llama-b11392/"
"$install_dir/llama-b11392/llama-completion" --version
node --input-type=module - "$install_dir" "$config_file" "$model_hash" <<'JS'
import fs from 'node:fs';
import path from 'node:path';
const [root, file, hash] = process.argv.slice(2);
const text = `ACOS_ENGINE_BINARY=${JSON.stringify(path.join(root, 'llama-b11392/llama-completion'))}\nACOS_MODEL_PATH=${JSON.stringify(path.join(root, 'qwen2.5-0.5b-instruct-q4_k_m.gguf'))}\nACOS_MODEL_SHA256=${hash}\n`;
// Do not overwrite an existing administrator configuration.
if (fs.existsSync(file)) throw new Error(`${file} already exists. Set ACOS_ENGINE_ENV_FILE to a new path or update your configuration manually.`);
fs.writeFileSync(file, text, { mode: 0o600, flag: 'wx' });
console.log(`Engine installed. Host configuration written to ${file}. Run pnpm host, then verify and load the model in Local engine.`);
JS

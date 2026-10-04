# Sourced by the WSL setup and local launcher; no shell profile changes.
acos_tools_root="${XDG_DATA_HOME:-$HOME/.local/share}/acos-tools"
if [[ -x "$acos_tools_root/node-v24.14.1-linux-x64/bin/node" ]]; then
  export PATH="$acos_tools_root/node-v24.14.1-linux-x64/bin:$PATH"
fi
if [[ -x "$acos_tools_root/pnpm/node_modules/.bin/pnpm" ]]; then
  export PATH="$acos_tools_root/pnpm/node_modules/.bin:$PATH"
fi

# Sourced by the WSL setup and local launcher; no shell profile changes.
acos_tools_root="${XDG_DATA_HOME:-$HOME/.local/share}/acos-tools"
case "$(uname -m)" in
  x86_64) acos_node_arch=x64 ;;
  aarch64|arm64) acos_node_arch=arm64 ;;
  *) acos_node_arch="$(uname -m)" ;;
esac
if [[ -x "$acos_tools_root/node-v24.14.1-linux-$acos_node_arch/bin/node" ]]; then
  export PATH="$acos_tools_root/node-v24.14.1-linux-$acos_node_arch/bin:$PATH"
fi
if [[ -x "$acos_tools_root/pnpm/node_modules/.bin/pnpm" ]]; then
  export PATH="$acos_tools_root/pnpm/node_modules/.bin:$PATH"
fi

#!/bin/bash
# Finder starts Terminal with a different PATH from many development shells.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
node_bin="$(command -v node 2>/dev/null || true)"
if [ -z "$node_bin" ] || ! "$node_bin" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' 2>/dev/null; then
  for candidate in "$HOME"/.nvm/versions/node/*/bin/node "$HOME"/.local/share/fnm/node-versions/*/installation/bin/node; do
    if [ -x "$candidate" ] && "$candidate" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' 2>/dev/null; then
      node_bin="$candidate"
      break
    fi
  done
fi
if [ -z "$node_bin" ] || ! "$node_bin" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' 2>/dev/null; then
  echo '请先安装 Node.js 22 或更新版本：https://nodejs.org/'
  echo '安装后重新双击启动文件；离线使用也可直接用浏览器打开独立网页版 HTML。'
  read -r -p '按回车关闭…' _
  exit 1
fi
"$node_bin" "$project_root/scripts/launcher.mjs" "$1"
result=$?
if [ "$result" -ne 0 ]; then read -r -p '按回车关闭…' _; fi
exit "$result"

#!/bin/bash
# Open the shipped page; no Node.js, terminal service, or network is required.
project_root="$(cd -- "$(dirname -- "$0")" && pwd)"
page="$project_root/浙里寻-独立网页版.html"
if [ ! -f "$page" ]; then
  echo '未找到独立网页版，请先完整解压文件包。'
  read -r -p '按回车关闭…' _
  exit 1
fi
exec /usr/bin/open -a "${ZLX_BROWSER:-Safari}" "$page"

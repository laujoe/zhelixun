@echo off
chcp 65001 >nul
if not exist "%~dp0浙里寻-独立网页版.html" (
  echo 未找到独立网页版，请先完整解压文件包。
  pause
  exit /b 1
)
start "" msedge "%~dp0浙里寻-独立网页版.html"

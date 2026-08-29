@echo off
cd /d %~dp0

if not exist node_modules (
  echo 初回セットアップをしています。少々お待ちください...
  call npm install
)

call npm run generate

echo.
echo 終了しました。何かキーを押すとこの画面を閉じます。
pause >nul

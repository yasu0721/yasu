@echo off
cd /d "%~dp0"

if not exist node_modules (
  echo 初回セットアップ中です。少しお待ちください...
  call npm install
  if errorlevel 1 (
    echo セットアップに失敗しました。インターネット接続、またはNode.jsのインストール状況を確認してください。
    pause
    exit /b 1
  )
)

echo ChatGPT Loop Runner を起動します。
call npx electron .

pause

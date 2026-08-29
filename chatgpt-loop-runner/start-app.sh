#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  echo "初回セットアップ中です。少しお待ちください..."
  npm install
fi

echo "ChatGPTを操作するための部品を確認しています(初回や更新後は少し時間がかかります)..."
npx playwright install chromium

echo "ChatGPT Loop Runner を起動します。"
npx electron .

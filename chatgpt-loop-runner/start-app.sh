#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  echo "初回セットアップ中です。少しお待ちください..."
  npm install
fi

echo "ChatGPT Loop Runner を起動します。ブラウザが自動で開きます。"
node src/server/index.js

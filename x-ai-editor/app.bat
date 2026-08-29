@echo off
cd /d %~dp0

if not exist node_modules (
  echo 初回セットアップをしています。少々お待ちください...
  call npm install
)

start "" http://localhost:3300
call npm run app

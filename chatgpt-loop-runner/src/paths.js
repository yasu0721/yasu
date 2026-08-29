// プロジェクト内の各ディレクトリパスを一元管理する。
// 実行場所に依存しないよう、すべて __dirname からの相対で解決する。
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');

const PATHS = {
  root: ROOT,
  config: path.join(ROOT, 'config'),
  configFile: path.join(ROOT, 'config', 'config.json'),
  state: path.join(ROOT, 'state'),
  runsDir: path.join(ROOT, 'state', 'runs'),
  logs: path.join(ROOT, 'logs'),
  outputs: path.join(ROOT, 'outputs'),
  browserProfile: path.join(ROOT, '.browser-profile'),
  public: path.join(ROOT, 'public'),
};

function ensureDirs() {
  for (const key of ['config', 'state', 'runsDir', 'logs', 'outputs']) {
    fs.mkdirSync(PATHS[key], { recursive: true });
  }
}

module.exports = { PATHS, ensureDirs };

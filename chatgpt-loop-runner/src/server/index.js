const http = require('http');
const fs = require('fs');
const path = require('path');
const { PATHS, ensureDirs } = require('../paths');
const { loadConfig, saveConfig, validateRunParams } = require('../config/configStore');
const { launchBrowserContext, getContext } = require('../automation/browser');
const { listChatGPTTabs } = require('../automation/tabs');
const { toTargetInfo, matchesTarget } = require('../automation/target');
const runManager = require('../automation/runManager');
const outputStore = require('../outputs/outputStore');
const logger = require('../logger');
const { openExternally } = require('./opener');

const PORT = Number(process.env.PORT) || 4173;

ensureDirs();

async function ensureBrowser() {
  try {
    await launchBrowserContext({ headless: process.env.CHATGPT_LOOP_RUNNER_HEADLESS === '1' });
  } catch (err) {
    if (/Executable doesn't exist/i.test(err.message)) {
      throw new Error(
        'ChatGPTを操作するためのブラウザ部品がまだ準備できていません。フォルダの中の node_modules というフォルダを削除してから、start-app.bat をもう一度実行してください(自動で再ダウンロードされます)。'
      );
    }
    throw err;
  }
  return getContext();
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data) });
  res.end(data);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 5 * 1024 * 1024) req.destroy(); // 5MB超は異常とみなす
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.join(PATHS.public, rel);
  if (!filePath.startsWith(PATHS.public)) {
    res.writeHead(403);
    return res.end('forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('not found');
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// ------- API handlers -------

async function handleGetTabs(req, res) {
  const context = await ensureBrowser();
  const tabs = await listChatGPTTabs(context);
  sendJson(res, 200, { tabs });
}

async function handleGetConfig(req, res) {
  sendJson(res, 200, loadConfig());
}

async function handlePostConfig(req, res) {
  const body = await readJsonBody(req);
  const next = saveConfig(body);
  sendJson(res, 200, next);
}

async function handlePostTarget(req, res) {
  const body = await readJsonBody(req);
  const context = await ensureBrowser();
  const tabs = await listChatGPTTabs(context);
  const tab = tabs.find((t) => (body.conversationId && t.conversationId === body.conversationId) || t.index === body.index);
  if (!tab) return sendJson(res, 404, { error: '指定されたChatGPTタブが見つかりません' });
  const config = saveConfig({ target_chat: toTargetInfo(tab) });
  sendJson(res, 200, config);
}

async function handleRunStart(req, res) {
  const config = loadConfig();
  const errors = validateRunParams(config);
  if (errors.length > 0) return sendJson(res, 400, { error: errors.join(' / ') });

  const context = await ensureBrowser();
  // 開始直前に対象チャットがまだ存在するか確認する(勝手に別チャットへは進まない)。
  const tabs = await listChatGPTTabs(context);
  const stillThere = tabs.some((t) => matchesTarget(t.url, config.target_chat));
  if (!stillThere) {
    return sendJson(res, 409, { error: '対象チャットのタブが見つかりません。ChatGPTで対象チャットを開いてから、チャット一覧を更新してください。' });
  }

  try {
    const run = await runManager.startNewRun(context, config);
    sendJson(res, 200, run);
  } catch (err) {
    sendJson(res, err.code === 'BUSY' ? 409 : 400, { error: err.message });
  }
}

async function handleRunStop(req, res) {
  const body = await readJsonBody(req);
  try {
    const run = runManager.requestStop(body.run_id, body.mode || 'safe');
    sendJson(res, 200, run);
  } catch (err) {
    sendJson(res, err.code === 'NOT_FOUND' ? 404 : 400, { error: err.message });
  }
}

async function handleGetActiveRun(req, res) {
  sendJson(res, 200, { run: runManager.getActiveRun() });
}

async function handleGetRun(req, res, runId) {
  const run = runManager.loadRun(runId);
  if (!run) return sendJson(res, 404, { error: '指定した実行が見つかりません' });
  sendJson(res, 200, run);
}

async function handleListRuns(req, res) {
  const runs = runManager.listRuns().map((r) => ({
    run_id: r.run_id,
    target_chat: r.target_chat,
    send_text: r.send_text,
    repeat_count: r.repeat_count,
    current_count: r.current_count,
    status: r.status,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
  sendJson(res, 200, { runs });
}

async function handleResumeSummary(req, res, runId) {
  sendJson(res, 200, runManager.getResumeSummary(runId));
}

async function handleResume(req, res, runId) {
  const body = await readJsonBody(req);
  const context = await ensureBrowser();
  try {
    const result = await runManager.resumeRunById(runId, context, { humanDecision: body.humanDecision });
    sendJson(res, 200, result);
  } catch (err) {
    sendJson(res, err.code === 'BUSY' ? 409 : 400, { error: err.message });
  }
}

async function handleAllResponses(req, res, runId) {
  const run = runManager.loadRun(runId);
  if (!run) return sendJson(res, 404, { error: '指定した実行が見つかりません' });
  const filePath = path.join(runManager.runOutputsDir(runId), 'all_responses.txt');
  if (!fs.existsSync(filePath)) return sendJson(res, 404, { error: 'まだ回答が保存されていません' });
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  fs.createReadStream(filePath).pipe(res);
}

async function handleOpenOutputsFolder(req, res, runId) {
  const dir = runManager.runOutputsDir(runId);
  fs.mkdirSync(dir, { recursive: true });
  const ok = openExternally(dir);
  sendJson(res, 200, { ok, path: dir });
}

const routes = [
  ['GET', /^\/api\/tabs$/, (req, res) => handleGetTabs(req, res)],
  ['GET', /^\/api\/config$/, (req, res) => handleGetConfig(req, res)],
  ['POST', /^\/api\/config$/, (req, res) => handlePostConfig(req, res)],
  ['POST', /^\/api\/target$/, (req, res) => handlePostTarget(req, res)],
  ['POST', /^\/api\/run\/start$/, (req, res) => handleRunStart(req, res)],
  ['POST', /^\/api\/run\/stop$/, (req, res) => handleRunStop(req, res)],
  ['GET', /^\/api\/run\/active$/, (req, res) => handleGetActiveRun(req, res)],
  ['GET', /^\/api\/runs$/, (req, res) => handleListRuns(req, res)],
  ['GET', /^\/api\/run\/([^/]+)$/, (req, res, m) => handleGetRun(req, res, m[1])],
  ['GET', /^\/api\/runs\/([^/]+)\/resume-summary$/, (req, res, m) => handleResumeSummary(req, res, m[1])],
  ['POST', /^\/api\/runs\/([^/]+)\/resume$/, (req, res, m) => handleResume(req, res, m[1])],
  ['GET', /^\/api\/runs\/([^/]+)\/all-responses$/, (req, res, m) => handleAllResponses(req, res, m[1])],
  ['POST', /^\/api\/runs\/([^/]+)\/open-folder$/, (req, res, m) => handleOpenOutputsFolder(req, res, m[1])],
];

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (pathname.startsWith('/api/')) {
    for (const [method, pattern, handler] of routes) {
      if (req.method !== method) continue;
      const m = pathname.match(pattern);
      if (!m) continue;
      Promise.resolve(handler(req, res, m)).catch((err) => {
        logger.error('APIエラー', { pathname, error: err.message, stack: err.stack });
        sendJson(res, 500, { error: `うまくいきませんでした: ${err.message}` });
      });
      return;
    }
    return sendJson(res, 404, { error: 'not found' });
  }

  serveStatic(req, res, pathname);
});

// CLI(start-app.sh等)からは自動でブラウザタブを開き、
// Electronデスクトップアプリからはウィンドウ側で表示するのでopenBrowser:falseで呼ぶ。
// 前回起動したアプリがまだ裏で動いている等でPORTが使用中の場合は、
// エラーで止めずに次の番号を自動で試す(最大20回)。
function startServer({ openBrowser = true, port = PORT, attemptsLeft = 20 } = {}) {
  return new Promise((resolve, reject) => {
    // server.listen(port, callback)のcallback引数は失敗時に自動では外れず、
    // 再試行のたびに'listening'リスナーが積み重なってしまう(次のポートで成功した瞬間、
    // 古い試行のコールバックも一緒に呼ばれ、誤ったポート番号でログが出る)。
    // そのため'error'/'listening'を自前で登録し、結果が出たら必ず両方外す。
    const cleanup = () => {
      server.removeListener('error', onError);
      server.removeListener('listening', onListening);
    };
    const onError = (err) => {
      cleanup();
      if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
        logger.warn('ポートが使用中のため次の番号を試します', { port, nextPort: port + 1 });
        resolve(startServer({ openBrowser, port: port + 1, attemptsLeft: attemptsLeft - 1 }));
        return;
      }
      reject(err);
    };
    const onListening = () => {
      cleanup();
      const url = `http://localhost:${port}`;
      // eslint-disable-next-line no-console
      console.log(`ChatGPT Loop Runner を起動しました: ${url}`);
      if (openBrowser) openExternally(url);
      resolve({ server, port, url });
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port);
  });
}

module.exports = { startServer };

if (require.main === module) {
  startServer({ openBrowser: true });
}

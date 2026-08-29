const http = require('http');
const fs = require('fs');
const path = require('path');
const { runPipeline, INPUT_FILE } = require('./pipeline');

const FINAL_DIR = path.join(__dirname, '..', 'final');
const PORT = process.env.PORT || 3300;

let isRunning = false;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 2_000_000) req.destroy(); // 素材が巨大すぎる場合の簡易的な保護
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function listHistory() {
  if (!fs.existsSync(FINAL_DIR)) return [];
  return fs
    .readdirSync(FINAL_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .reverse()
    .slice(0, 20);
}

const HTML_PAGE = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<title>x-ai-editor</title>
<style>
  body { font-family: system-ui, -apple-system, "Hiragino Sans", sans-serif; max-width: 760px; margin: 40px auto; padding: 0 16px; color: #222; }
  h1 { font-size: 20px; }
  textarea { width: 100%; box-sizing: border-box; height: 200px; font-size: 14px; padding: 8px; }
  button { font-size: 15px; padding: 8px 20px; margin-top: 10px; cursor: pointer; }
  button:disabled { cursor: not-allowed; opacity: 0.6; }
  #progress { white-space: pre-wrap; background: #f4f4f4; padding: 12px; margin-top: 16px; border-radius: 6px; min-height: 20px; font-size: 13px; }
  #result { white-space: pre-wrap; background: #eef7ee; padding: 12px; margin-top: 16px; border-radius: 6px; display: none; font-size: 14px; }
  #error { white-space: pre-wrap; background: #fdeaea; padding: 12px; margin-top: 16px; border-radius: 6px; display: none; font-size: 14px; }
  select, .history-item { font-size: 13px; }
  .history-item { cursor: pointer; color: #06c; text-decoration: underline; }
  hr { margin: 30px 0; }
</style>
</head>
<body>
  <h1>x-ai-editor</h1>
  <p>ニュースやX投稿の素材を貼って「実行」を押すと、振り分けGPT→専門GPT→編集長GPTが自動で動き、最終案が表示されます。</p>

  <textarea id="material" placeholder="ここに素材を貼ってください"></textarea>
  <br />
  <button id="runBtn">実行</button>

  <div id="progress"></div>
  <div id="result"></div>
  <div id="error"></div>

  <hr />
  <h2>過去の結果</h2>
  <div id="history"></div>

<script>
async function loadMaterial() {
  const res = await fetch('/api/material');
  const data = await res.json();
  document.getElementById('material').value = data.content || '';
}

async function loadHistory() {
  const res = await fetch('/api/history');
  const data = await res.json();
  const el = document.getElementById('history');
  if (!data.runs || data.runs.length === 0) {
    el.textContent = 'まだありません。';
    return;
  }
  el.innerHTML = '';
  data.runs.forEach((runId) => {
    const div = document.createElement('div');
    div.className = 'history-item';
    div.textContent = runId;
    div.onclick = async () => {
      const r = await fetch('/api/final/' + encodeURIComponent(runId));
      const d = await r.json();
      showResult(d.text || '(内容を読み込めませんでした)');
    };
    el.appendChild(div);
  });
}

function showResult(text) {
  const resultEl = document.getElementById('result');
  resultEl.style.display = 'block';
  resultEl.textContent = text;
  resultEl.scrollIntoView({ behavior: 'smooth' });
}

function showError(text) {
  const errEl = document.getElementById('error');
  errEl.style.display = 'block';
  errEl.textContent = text;
}

document.getElementById('runBtn').addEventListener('click', async () => {
  const btn = document.getElementById('runBtn');
  const progressEl = document.getElementById('progress');
  const resultEl = document.getElementById('result');
  const errEl = document.getElementById('error');
  resultEl.style.display = 'none';
  errEl.style.display = 'none';
  progressEl.textContent = '実行中です。しばらくお待ちください...';
  btn.disabled = true;

  try {
    const material = document.getElementById('material').value;
    await fetch('/api/material', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: material }),
    });

    const res = await fetch('/api/run', { method: 'POST' });
    const data = await res.json();

    progressEl.textContent = (data.steps || []).join('\\n');

    if (data.status === 'success') {
      showResult(data.finalText);
    } else if (data.status === 'busy') {
      showError('現在すでに処理中です。完了までお待ちください。');
    } else if (data.message) {
      showError(data.message);
    }
    loadHistory();
  } catch (err) {
    showError('通信エラーが発生しました: ' + err.message);
  } finally {
    btn.disabled = false;
  }
});

loadMaterial();
loadHistory();
</script>
</body>
</html>
`;

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(HTML_PAGE);
      return;
    }

    if (req.method === 'GET' && req.url === '/api/material') {
      const content = fs.existsSync(INPUT_FILE) ? fs.readFileSync(INPUT_FILE, 'utf8') : '';
      sendJson(res, 200, { content });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/material') {
      const body = await readBody(req);
      const { content } = JSON.parse(body || '{}');
      fs.writeFileSync(INPUT_FILE, content ?? '', 'utf8');
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/run') {
      if (isRunning) {
        sendJson(res, 409, { status: 'busy', message: '現在すでに処理中です。' });
        return;
      }
      isRunning = true;
      const steps = [];
      try {
        const result = await runPipeline({ onProgress: (msg) => steps.push(msg) });
        sendJson(res, 200, { ...result, steps });
      } catch (err) {
        sendJson(res, 500, { status: 'error', message: err.message, steps });
      } finally {
        isRunning = false;
      }
      return;
    }

    if (req.method === 'GET' && req.url === '/api/history') {
      sendJson(res, 200, { runs: listHistory() });
      return;
    }

    if (req.method === 'GET' && req.url.startsWith('/api/final/')) {
      const runId = decodeURIComponent(req.url.slice('/api/final/'.length));
      // run_idはmakeRunIdが生成する "数字_数字" 形式のみを許可し、
      // パス外のファイルを読み取れないようにする。
      if (!/^[0-9]{8}_[0-9]{6}$/.test(runId)) {
        sendJson(res, 400, { message: '不正なrun_idです' });
        return;
      }
      const finalFile = path.join(FINAL_DIR, runId, 'final.txt');
      if (!fs.existsSync(finalFile)) {
        sendJson(res, 404, { message: '見つかりませんでした' });
        return;
      }
      sendJson(res, 200, { text: fs.readFileSync(finalFile, 'utf8') });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  } catch (err) {
    sendJson(res, 500, { message: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`x-ai-editor アプリを起動しました: http://localhost:${PORT}`);
  console.log('ブラウザで上記アドレスを開いてください。終了するには Ctrl+C を押してください。');
});

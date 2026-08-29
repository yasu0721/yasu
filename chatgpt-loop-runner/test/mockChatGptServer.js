// 実際のChatGPTには接続できないため、DOM構造(data-message-author-role等)を模した
// ローカルページを用意し、検知ロジック(composer/domSignals/send/waitForAnswer)を検証する。
const http = require('http');
const { URL } = require('url');

function pageHtml(conversationId, title) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title></head>
<body>
<nav id="sidebar">
  <a href="/c/conv-a">Xバズ企画の相談</a>
  <a href="/c/conv-b">副業アイデア</a>
  <a href="/c/${conversationId}">${title}</a>
</nav>
<div id="messages"></div>
<div id="composer" contenteditable="true" role="textbox" aria-label="Send a message" data-composer></div>
<button data-testid="send-button" aria-label="Send message" id="sendBtn">Send</button>
<div id="controls"></div>
<script>
(function () {
  const qs = new URLSearchParams(location.search);
  const cfg = {
    startDelayMs: Number(qs.get('startDelayMs') || 300),
    streamMs: Number(qs.get('streamMs') || 800),
    forceNoStart: qs.get('forceNoStart') === '1',
    forceError: qs.get('forceError') === '1',
  };
  let sendCounter = 0;
  const messagesEl = document.getElementById('messages');
  const composerEl = document.getElementById('composer');
  const sendBtnEl = document.getElementById('sendBtn');

  function addMessage(role, text) {
    const div = document.createElement('div');
    div.setAttribute('data-message-author-role', role);
    div.innerText = text;
    messagesEl.appendChild(div);
    return div;
  }

  function removeStopButton() {
    const b = document.getElementById('stopBtn');
    if (b) b.remove();
  }
  function showStopButton() {
    if (document.getElementById('stopBtn')) return;
    const b = document.createElement('button');
    b.id = 'stopBtn';
    b.setAttribute('aria-label', 'Stop generating');
    b.innerText = 'Stop';
    document.getElementById('controls').appendChild(b);
  }
  function showError() {
    const d = document.createElement('div');
    d.id = 'errorBanner';
    d.innerText = 'Something went wrong. Please try again.';
    document.getElementById('controls').appendChild(d);
  }

  function doSend() {
    const text = composerEl.innerText.trim();
    if (!text) return;
    addMessage('user', text);
    composerEl.innerText = '';
    sendBtnEl.disabled = true;
    sendCounter += 1;
    const finalText = 'モック回答' + sendCounter;

    if (cfg.forceNoStart) {
      // 回答開始しないケース(タイムアウトのテスト用)
      return;
    }
    setTimeout(() => {
      showStopButton();
      if (cfg.forceError) {
        setTimeout(() => {
          removeStopButton();
          showError();
          sendBtnEl.disabled = false;
        }, 200);
        return;
      }
      const assistantEl = addMessage('assistant', '');
      let i = 0;
      const step = Math.max(1, Math.floor(finalText.length / 5));
      const timer = setInterval(() => {
        i += step;
        assistantEl.innerText = finalText.slice(0, i);
        if (i >= finalText.length) {
          clearInterval(timer);
          assistantEl.innerText = finalText;
          removeStopButton();
          sendBtnEl.disabled = false;
        }
      }, cfg.streamMs / 5);
    }, cfg.startDelayMs);
  }

  sendBtnEl.addEventListener('click', doSend);
  composerEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  });

  // テストコードから直接メッセージを注入するためのフック(割り込みシミュレーション用)。
  window.__mockInjectUserMessage = (text) => addMessage('user', text);
})();
</script>
</body></html>`;
}

function startMockServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://localhost');
      const m = u.pathname.match(/^\/c\/([a-zA-Z0-9-]+)$/);
      const id = m ? m[1] : 'new';
      const title = u.searchParams.get('title') || `Mock Chat ${id}`;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(pageHtml(id, title));
    });
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        port,
        urlFor(conversationId, params = {}) {
          const usp = new URLSearchParams(params);
          const q = usp.toString();
          return `http://localhost:${port}/c/${conversationId}${q ? '?' + q : ''}`;
        },
        close() {
          return new Promise((r) => server.close(r));
        },
      });
    });
  });
}

module.exports = { startMockServer };

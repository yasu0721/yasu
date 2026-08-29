(function () {
  const root = document.getElementById('root');

  let config = null;
  let tabs = [];
  let view = 'setup'; // 'setup' | 'confirm' | 'running' | 'history' | 'history-detail'
  let activeRun = null;
  let detailOpen = false;
  let errorMessage = '';
  let historyRuns = [];
  let historyDetailRun = null;
  let pollTimer = null;
  let unknownDecisionInfo = null;

  const STATUS_LABEL = {
    pending: '待機中',
    running: '実行中',
    paused: '一時停止',
    stopped: '停止しました',
    timeout: 'タイムアウトしました',
    unknown: '要確認(送信結果不明)',
    failed: '失敗しました',
    completed: '完了しました',
    interrupted: '割り込みを検知しました',
    login_required: 'ログインが必要です',
    needs_review: '要確認(整合性エラー)',
  };
  const ITER_LABEL = {
    pending: '待機中',
    sending: '送信準備中',
    sent: '送信しました',
    answering: 'ChatGPTが回答中です',
    answer_completed: '回答完了を確認しました',
    saved: '保存しました',
    unknown: '送信結果を確認できません',
    failed: '失敗しました',
    error: 'エラーが発生しました',
    interrupted: '割り込みを検知しました',
    timeout: 'タイムアウトしました',
  };

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `リクエストに失敗しました(${res.status})`);
    return data;
  }

  async function loadConfig() {
    config = await api('GET', '/api/config');
  }

  async function refreshTabs() {
    try {
      const data = await api('GET', '/api/tabs');
      tabs = data.tabs;
    } catch (err) {
      errorMessage = `ChatGPTタブの取得に失敗しました: ${err.message}`;
    }
  }

  function isSelectedTab(t) {
    if (!config.target_chat) return false;
    return config.target_chat.conversationId ? t.conversationId === config.target_chat.conversationId : t.normalizedUrl === config.target_chat.normalizedUrl;
  }

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  function startPolling(runId) {
    stopPolling();
    pollTimer = setInterval(async () => {
      try {
        activeRun = await api('GET', `/api/run/${runId}`);
        render();
      } catch (err) {
        // 一時的な取得失敗は無視して次回ポーリングに任せる
      }
    }, 1000);
  }

  // ---------- render: setup ----------
  function renderSetup() {
    const dryRunBanner = config.dry_run ? `<div class="banner-dryrun">DRY RUN：実際には送信しません</div>` : '';
    const chatItems = tabs.length
      ? tabs
          .map(
            (t, i) => `<li data-conv="${escapeHtml(t.conversationId || '')}" data-idx="${t.index}" class="tabItem ${isSelectedTab(t) ? 'selected' : ''}">
              ○ ${escapeHtml(t.title)}<span class="url">${escapeHtml(t.url)}</span>
            </li>`
          )
          .join('')
      : '<li>ChatGPTのタブが見つかりません。ChatGPTを開いてから更新してください。</li>';

    root.innerHTML = `
      ${dryRunBanner}
      ${errorMessage ? `<div class="error-box">${escapeHtml(errorMessage)}</div>` : ''}
      <div class="card">
        <h2>対象ChatGPTチャット</h2>
        <div>対象：<strong>${config.target_chat ? escapeHtml(config.target_chat.title) : '未選択'}</strong></div>
        <ul class="chat-list" id="chatList">${chatItems}</ul>
        <button class="btn" id="refreshTabsBtn">チャット一覧を更新</button>
      </div>
      <div class="card">
        <h2>送る文字・回数</h2>
        <label>送る文字</label>
        <input type="text" id="sendText" value="${escapeHtml(config.send_text)}" />
        <label>繰り返し回数(安全上限: ${config.max_repeat_count}回)</label>
        <input type="number" id="repeatCount" min="1" max="${config.max_repeat_count}" value="${config.repeat_count}" />
        <div class="detail-toggle" id="toggleDetail">詳細設定を${detailOpen ? '閉じる ▲' : '開く ▼'}</div>
        <div class="detail-body ${detailOpen ? 'open' : ''}">
          <label><input type="checkbox" id="dryRunCk" ${config.dry_run ? 'checked' : ''}/> DRY RUN(実際には送信しない)</label>
          <div class="row">
            <div><label>回答開始タイムアウト(秒)</label><input type="number" id="startTimeout" value="${config.answer_start_timeout_sec}"/></div>
            <div><label>回答完了タイムアウト(秒)</label><input type="number" id="completeTimeout" value="${config.answer_complete_timeout_sec}"/></div>
          </div>
          <div class="row">
            <div><label>回答安定確認秒数</label><input type="number" id="stableSec" value="${config.answer_stable_sec}"/></div>
            <div><label>完了後の追加待機(秒)</label><input type="number" id="betweenDelay" value="${config.between_iterations_delay_sec}"/></div>
          </div>
          <label>安全上限(max_repeat_count)</label>
          <input type="number" id="maxRepeat" value="${config.max_repeat_count}"/>
        </div>
      </div>
      <button class="btn btn-primary" id="startBtn">開始</button>
      <div class="footer-nav"><span class="small-link" id="gotoHistory">履歴を見る</span></div>
    `;

    document.getElementById('refreshTabsBtn').onclick = async () => {
      errorMessage = '';
      await refreshTabs();
      render();
    };
    document.querySelectorAll('.tabItem').forEach((el) => {
      el.onclick = async () => {
        const idx = Number(el.dataset.idx);
        try {
          config = await api('POST', '/api/target', { index: idx, conversationId: el.dataset.conv || undefined });
          errorMessage = '';
        } catch (err) {
          errorMessage = err.message;
        }
        render();
      };
    });
    document.getElementById('toggleDetail').onclick = () => {
      detailOpen = !detailOpen;
      render();
    };
    document.getElementById('gotoHistory').onclick = () => openHistory();
    document.getElementById('startBtn').onclick = () => onClickStart();
  }

  function collectFormConfig() {
    return {
      send_text: document.getElementById('sendText').value,
      repeat_count: Number(document.getElementById('repeatCount').value),
      dry_run: document.getElementById('dryRunCk') ? document.getElementById('dryRunCk').checked : config.dry_run,
      answer_start_timeout_sec: numOr('startTimeout', config.answer_start_timeout_sec),
      answer_complete_timeout_sec: numOr('completeTimeout', config.answer_complete_timeout_sec),
      answer_stable_sec: numOr('stableSec', config.answer_stable_sec),
      between_iterations_delay_sec: numOr('betweenDelay', config.between_iterations_delay_sec),
      max_repeat_count: numOr('maxRepeat', config.max_repeat_count),
    };
  }
  function numOr(id, fallback) {
    const el = document.getElementById(id);
    return el ? Number(el.value) : fallback;
  }

  async function onClickStart() {
    const formConfig = collectFormConfig();
    try {
      config = await api('POST', '/api/config', formConfig);
      errorMessage = '';
      view = 'confirm';
      render();
    } catch (err) {
      errorMessage = err.message;
      render();
    }
  }

  // ---------- confirm modal ----------
  function renderConfirmModal() {
    renderSetup();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <h3>連続実行を開始します</h3>
        <div>対象：<strong>${escapeHtml(config.target_chat ? config.target_chat.title : '未選択')}</strong></div>
        <div>送信：<strong>${escapeHtml(config.send_text)}</strong></div>
        <div>回数：<strong>${config.repeat_count}回</strong></div>
        ${config.dry_run ? '<div class="banner-dryrun" style="margin-top:10px;">DRY RUN：実際には送信しません</div>' : ''}
        <div class="actions">
          <button class="btn btn-secondary" id="confirmBack">戻る</button>
          <button class="btn btn-primary" id="confirmGo">開始する</button>
        </div>
      </div>`;
    root.appendChild(overlay);
    document.getElementById('confirmBack').onclick = () => {
      view = 'setup';
      render();
    };
    document.getElementById('confirmGo').onclick = async () => {
      try {
        activeRun = await api('POST', '/api/run/start', {});
        errorMessage = '';
        view = 'running';
        startPolling(activeRun.run_id);
        render();
      } catch (err) {
        errorMessage = err.message;
        view = 'setup';
        render();
      }
    };
  }

  // ---------- running / result view ----------
  function currentIterationOf(run) {
    return run.iterations.find((it) => !['saved'].includes(it.status)) || run.iterations[run.iterations.length - 1];
  }

  function renderRunning() {
    const run = activeRun;
    if (!run) {
      view = 'setup';
      return render();
    }
    const pct = Math.round((run.current_count / run.repeat_count) * 100);
    const cur = currentIterationOf(run);
    const isTerminalGood = run.status === 'completed';
    const isTerminalBad = ['stopped', 'timeout', 'unknown', 'failed', 'paused', 'interrupted', 'login_required', 'needs_review'].includes(run.status);

    let body = '';
    if (isTerminalGood) {
      body = `
        <div class="card">
          <div class="status-text">完了しました</div>
          <div class="progress-num">${run.current_count} / ${run.repeat_count}</div>
          <div>回答：${run.current_count}件保存</div>
          <div>開始：${formatTime(run.started_at)} / 終了：${formatTime(run.finished_at)}</div>
          <div style="margin-top:14px; display:flex; gap:10px;">
            <button class="btn" id="openFolderBtn">回答フォルダを開く</button>
            <a class="btn" href="/api/runs/${run.run_id}/all-responses" target="_blank">全回答を見る</a>
          </div>
        </div>
        <button class="btn btn-secondary" id="backToSetup">最初の画面に戻る</button>
      `;
    } else {
      body = `
        <div class="card">
          <div class="status-text">実行中</div>
          <div class="progress-num">${run.current_count} / ${run.repeat_count}</div>
          <div class="progress-bar-outer"><div class="progress-bar-inner" style="width:${pct}%"></div></div>
          <div>送信：<strong>${escapeHtml(run.send_text)}</strong></div>
          <div class="status-text ${isTerminalBad ? 'error' : ''}">現在：${ITER_LABEL[cur ? cur.status : 'pending'] || run.status}</div>
          ${run.pause_reason ? `<div class="error-box">${escapeHtml(run.pause_reason)}</div>` : ''}
          ${!isTerminalBad ? '<button class="btn btn-danger" id="stopSafeBtn" style="width:100%;">安全に停止</button>' : ''}
        </div>
      `;
      if (isTerminalBad) {
        body += renderTerminalActions(run);
      }
    }

    root.innerHTML = body;
    if (document.getElementById('stopSafeBtn')) {
      document.getElementById('stopSafeBtn').onclick = async () => {
        await api('POST', '/api/run/stop', { run_id: run.run_id, mode: 'safe' });
      };
    }
    if (document.getElementById('backToSetup')) {
      document.getElementById('backToSetup').onclick = () => {
        stopPolling();
        view = 'setup';
        render();
      };
    }
    if (document.getElementById('openFolderBtn')) {
      document.getElementById('openFolderBtn').onclick = () => api('POST', `/api/runs/${run.run_id}/open-folder`, {});
    }
    wireTerminalActions(run);
  }

  function renderTerminalActions(run) {
    if (run.status === 'unknown') {
      return `<div class="card"><div id="unknownArea">確認しています…</div></div>`;
    }
    if (run.status === 'login_required') {
      return `<div class="card"><div>ChatGPTへログインしてください。ログイン後に再開できます。</div><button class="btn btn-primary" id="resumeBtn" style="margin-top:10px;">ログイン後に再開する</button></div>`;
    }
    return `<div class="card"><div>${escapeHtml(run.pause_reason || STATUS_LABEL[run.status] || run.status)}</div><button class="btn btn-primary" id="resumeBtn" style="margin-top:10px;">${run.current_count + 1}回目から再開</button></div>`;
  }

  async function wireTerminalActions(run) {
    if (run.status === 'unknown') {
      const summary = await api('GET', `/api/runs/${run.run_id}/resume-summary`).catch(() => null);
      const area = document.getElementById('unknownArea');
      if (!area) return;
      area.innerHTML = `
        <div class="error-box">${escapeHtml((summary && summary.detail) || `${run.current_count + 1}回目の送信結果を確認できません。重複送信防止のため自動再開を停止しました。`)}</div>
        <div style="display:flex; flex-direction:column; gap:8px; margin-top:10px;">
          <button class="btn" data-d="mark_sent_continue">送信済みとして続ける</button>
          <button class="btn" data-d="mark_unsent_retry">未送信として再実行</button>
          <button class="btn btn-danger" data-d="end_run">このrunを終了</button>
        </div>`;
      area.querySelectorAll('button[data-d]').forEach((btn) => {
        btn.onclick = async () => {
          try {
            await api('POST', `/api/runs/${run.run_id}/resume`, { humanDecision: btn.dataset.d });
            activeRun = await api('GET', `/api/run/${run.run_id}`);
            startPolling(run.run_id);
            render();
          } catch (err) {
            errorMessage = err.message;
            render();
          }
        };
      });
      return;
    }
    const resumeBtn = document.getElementById('resumeBtn');
    if (resumeBtn) {
      resumeBtn.onclick = async () => {
        try {
          await api('POST', `/api/runs/${run.run_id}/resume`, {});
          activeRun = await api('GET', `/api/run/${run.run_id}`);
          startPolling(run.run_id);
          render();
        } catch (err) {
          errorMessage = err.message;
          render();
        }
      };
    }
  }

  function formatTime(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    return d.toLocaleString('ja-JP');
  }

  // ---------- history ----------
  async function openHistory() {
    historyRuns = (await api('GET', '/api/runs')).runs;
    view = 'history';
    render();
  }

  function renderHistory() {
    const rows = historyRuns
      .map(
        (r) => `<tr data-id="${r.run_id}">
          <td>${formatTime(r.updated_at)}</td>
          <td>${escapeHtml(r.target_chat ? r.target_chat.title : '-')}</td>
          <td>${escapeHtml(r.send_text)}</td>
          <td>${r.current_count}/${r.repeat_count}</td>
          <td><span class="tag ${r.status}">${STATUS_LABEL[r.status] || r.status}</span></td>
        </tr>`
      )
      .join('');
    root.innerHTML = `
      <div class="card">
        <h2>履歴</h2>
        <table class="hist-table">
          <thead><tr><th>日時</th><th>対象チャット</th><th>送信文字</th><th>完了</th><th>状態</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="5">まだ実行履歴がありません</td></tr>'}</tbody>
        </table>
      </div>
      <button class="btn" id="backSetupFromHistory">戻る</button>
    `;
    document.getElementById('backSetupFromHistory').onclick = () => {
      view = 'setup';
      render();
    };
    root.querySelectorAll('tr[data-id]').forEach((row) => {
      row.onclick = async () => {
        historyDetailRun = await api('GET', `/api/run/${row.dataset.id}`);
        view = 'history-detail';
        render();
      };
    });
  }

  function renderHistoryDetail() {
    const run = historyDetailRun;
    const rows = run.iterations
      .map(
        (it) => `<tr>
          <td>${it.iteration}</td>
          <td><span class="tag ${it.status}">${ITER_LABEL[it.status] || it.status}</span></td>
          <td>${formatTime(it.sent_at)}</td>
          <td>${formatTime(it.answer_completed_at)}</td>
          <td>${it.output_file ? escapeHtml(it.output_file) : '-'}</td>
        </tr>`
      )
      .join('');
    root.innerHTML = `
      <div class="card">
        <h2>${escapeHtml(run.target_chat ? run.target_chat.title : run.run_id)}</h2>
        <div>送信文字：${escapeHtml(run.send_text)} / 回数：${run.repeat_count} / 状態：<span class="tag ${run.status}">${STATUS_LABEL[run.status] || run.status}</span></div>
        <table class="hist-table" style="margin-top:10px;">
          <thead><tr><th>#</th><th>状態</th><th>送信時刻</th><th>回答完了</th><th>保存先</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div style="margin-top:10px;"><a class="btn" href="/api/runs/${run.run_id}/all-responses" target="_blank">全回答を見る</a></div>
      </div>
      <button class="btn" id="backToHistory">履歴一覧へ戻る</button>
    `;
    document.getElementById('backToHistory').onclick = () => {
      view = 'history';
      render();
    };
  }

  function render() {
    if (view === 'setup') return renderSetup();
    if (view === 'confirm') return renderConfirmModal();
    if (view === 'running') return renderRunning();
    if (view === 'history') return renderHistory();
    if (view === 'history-detail') return renderHistoryDetail();
  }

  async function init() {
    await loadConfig();
    await refreshTabs();
    try {
      const activeRes = await api('GET', '/api/run/active');
      if (activeRes.run) {
        activeRun = activeRes.run;
        view = 'running';
        startPolling(activeRun.run_id);
      }
    } catch {
      // 無視: 実行中runなしとして扱う
    }
    render();
  }

  init();
})();

// 実ChatGPTには接続できない環境での検証用テスト。
// モックページ(data-message-author-role等、ChatGPTと同じDOMフックを持つ)を使って、
// タブ検出・対象固定・入力欄検出・送信・回答完了検知・ループ・停止・再開・unknown保護を確認する。
process.env.CHATGPT_LOOP_RUNNER_TEST_HOSTS = 'localhost';
process.env.CHATGPT_LOOP_RUNNER_HEADLESS = '1';

const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { startMockServer } = require('./mockChatGptServer');

// state/logs/outputsを本番と分けるため、テスト専用の一時ROOTへ差し替える。
const TEST_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'chatgpt-loop-runner-test-'));
const pathsModule = require('../src/paths');
pathsModule.PATHS.config = path.join(TEST_ROOT, 'config');
pathsModule.PATHS.configFile = path.join(TEST_ROOT, 'config', 'config.json');
pathsModule.PATHS.state = path.join(TEST_ROOT, 'state');
pathsModule.PATHS.runsDir = path.join(TEST_ROOT, 'state', 'runs');
pathsModule.PATHS.logs = path.join(TEST_ROOT, 'logs');
pathsModule.PATHS.outputs = path.join(TEST_ROOT, 'outputs');

const { listChatGPTTabs, listSidebarConversations } = require('../src/automation/tabs');
const { createTargetHandle, reconfirmTarget, toTargetInfo } = require('../src/automation/target');
const { findComposer, getComposerText } = require('../src/automation/composer');
const { sendOnce } = require('../src/automation/send');
const { waitForAnswerCompletion } = require('../src/automation/waitForAnswer');
const { countMessages } = require('../src/automation/domSignals');
const stateStore = require('../src/state/stateStore');
const outputStore = require('../src/outputs/outputStore');
const { runLoop } = require('../src/automation/loop');
const { resumeRun, getResumeSummary } = require('../src/automation/resume');

let passed = 0;
let failed = 0;
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`OK   - ${name}`);
    })
    .catch((err) => {
      failed++;
      console.log(`FAIL - ${name}`);
      console.log(`       ${err.message}`);
    });
}

const FAST_OPTIONS = {
  answer_start_timeout_sec: 3,
  answer_complete_timeout_sec: 15,
  answer_stable_sec: 1,
  poll_interval_ms: 150,
};

async function main() {
  const mock = await startMockServer();
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatgpt-loop-runner-profile-'));
  // このサンドボックス環境ではプリインストール済みChromiumのパスを明示する必要がある。
  // 実際のユーザーPCでは `npm install` 時にPlaywright標準の場所へ自動取得されるため不要。
  const launchOptions = { headless: true };
  if (process.env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync('/opt/pw-browsers/chromium')) {
    launchOptions.executablePath = '/opt/pw-browsers/chromium';
  }
  const context = await chromium.launchPersistentContext(profileDir, launchOptions);

  // --- 1. タブ検出: 複数のモックChatGPTタブを検出できるか ---
  await check('複数のChatGPTタブを検出できる(番号だけでなくconversationIdも保持)', async () => {
    const p1 = await context.newPage();
    await p1.goto(mock.urlFor('conv-a', { title: 'Xバズ企画の相談' }));
    const p2 = await context.newPage();
    await p2.goto(mock.urlFor('conv-b', { title: '副業アイデア' }));

    const tabs = await listChatGPTTabs(context);
    const a = tabs.find((t) => t.conversationId === 'conv-a');
    const b = tabs.find((t) => t.conversationId === 'conv-b');
    assert.ok(a && a.title === 'Xバズ企画の相談', 'conv-aが検出できていること');
    assert.ok(b && b.title === '副業アイデア', 'conv-bが検出できていること');
    await p1.close();
    await p2.close();
  });

  // --- 1.5 サイドバーの会話一覧: タブを開いていなくても選べるようにする ---
  await check('サイドバーの会話一覧を取得できる(タブとして開いていない会話も含む)', async () => {
    const page = await context.newPage();
    await page.goto(mock.urlFor('conv-current', { title: '現在の会話' }));
    const conversations = await listSidebarConversations(page);
    const ids = conversations.map((c) => c.conversationId);
    assert.ok(ids.includes('conv-a'), 'サイドバーのconv-aが取得できること(タブとしては開いていない)');
    assert.ok(ids.includes('conv-b'), 'サイドバーのconv-bが取得できること(タブとしては開いていない)');
    assert.ok(ids.includes('conv-current'), '現在表示中の会話も含まれること');
    await page.close();
  });

  // --- 2. 対象固定: 対象タブが別会話へ移動したらtarget_changedになる ---
  await check('対象タブが別会話へ移動した場合にtarget_changedを検知する', async () => {
    const page = await context.newPage();
    await page.goto(mock.urlFor('conv-fixed', { title: '固定対象テスト' }));
    const handle = createTargetHandle(toTargetInfo({ url: page.url(), title: '固定対象テスト' }), page);

    const ok1 = await reconfirmTarget(context, handle);
    assert.strictEqual(ok1.ok, true, '最初は対象一致するはず');

    await page.goto(mock.urlFor('conv-other', { title: '別会話' }));
    const ok2 = await reconfirmTarget(context, handle);
    assert.strictEqual(ok2.ok, false);
    assert.strictEqual(ok2.reason, 'target_changed');
    await page.close();
  });

  // --- 3. 入力欄検出 + DRY RUN(実際には入力しない) ---
  await check('DRY RUNでは入力欄に一切触れず、送信もしない', async () => {
    const page = await context.newPage();
    await page.goto(mock.urlFor('conv-dry', { title: 'DRY RUNテスト' }));
    const handle = createTargetHandle(toTargetInfo({ url: page.url(), title: 'DRY RUNテスト' }), page);

    const composer = await findComposer(page);
    assert.ok(composer, '入力欄が検出できること');

    const before = await countMessages(page);
    const result = await sendOnce({ context, handle, sendText: 'か', dryRun: true });
    assert.strictEqual(result.status, 'dry_run');
    const after = await countMessages(page);
    assert.strictEqual(before.user, after.user, 'DRY RUNではuserメッセージが増えないこと');
    await page.close();
  });

  // --- 4. 既存入力保護 ---
  await check('入力欄に未送信の文章がある場合は消さずに停止する', async () => {
    const page = await context.newPage();
    await page.goto(mock.urlFor('conv-existing', { title: '既存入力保護テスト' }));
    const handle = createTargetHandle(toTargetInfo({ url: page.url(), title: '既存入力保護テスト' }), page);
    await page.locator('#composer').click();
    await page.keyboard.type('書きかけの文章');

    const result = await sendOnce({ context, handle, sendText: 'か', dryRun: false });
    assert.strictEqual(result.status, 'blocked');
    assert.strictEqual(result.reason, 'composer_has_existing_text');
    const remaining = await getComposerText(await findComposer(page));
    assert.strictEqual(remaining.trim(), '書きかけの文章', '既存の文章が消されていないこと');
    await page.close();
  });

  // --- 5. 実送信 + 送信成功確認 + 二重送信防止(同時呼び出し) ---
  await check('1回だけ実送信でき、送信成功が確認できる。同時多重呼び出しはブロックされる', async () => {
    const page = await context.newPage();
    await page.goto(mock.urlFor('conv-send', { title: '送信テスト', streamMs: '200' }));
    const handle = createTargetHandle(toTargetInfo({ url: page.url(), title: '送信テスト' }), page);

    const [r1, r2] = await Promise.all([
      sendOnce({ context, handle, sendText: 'か', dryRun: false }),
      sendOnce({ context, handle, sendText: 'か', dryRun: false }),
    ]);
    const statuses = [r1.status, r2.status].sort();
    assert.deepStrictEqual(statuses, ['blocked', 'sent'], '片方はsent、もう片方は多重呼び出しでblockedになること');
    await page.close();
  });

  // --- 6. 回答開始→生成中→完了の検知(固定秒数ではなくDOM状態で判定) ---
  await check('waitForAnswerCompletionが回答完了を正しく検知し、本文を取得できる', async () => {
    const page = await context.newPage();
    await page.goto(mock.urlFor('conv-wait', { title: '回答完了検知テスト', startDelayMs: '200', streamMs: '600' }));
    const handle = createTargetHandle(toTargetInfo({ url: page.url(), title: '回答完了検知テスト' }), page);
    const before = await countMessages(page);
    const send = await sendOnce({ context, handle, sendText: 'テスト', dryRun: false });
    assert.strictEqual(send.status, 'sent');

    const result = await waitForAnswerCompletion({
      context,
      handle,
      baselineAssistantCount: before.assistant,
      expectedUserCount: before.user + 1,
      options: FAST_OPTIONS,
    });
    assert.strictEqual(result.status, 'answer_completed');
    assert.strictEqual(result.assistantText, 'モック回答1');
    await page.close();
  });

  // --- 7. タイムアウト検知(回答が開始しない場合) ---
  await check('回答が開始しない場合にanswer_start_timeoutで停止する(固定待ちではない)', async () => {
    const page = await context.newPage();
    await page.goto(mock.urlFor('conv-timeout', { title: 'タイムアウトテスト', forceNoStart: '1' }));
    const handle = createTargetHandle(toTargetInfo({ url: page.url(), title: 'タイムアウトテスト' }), page);
    const before = await countMessages(page);
    const send = await sendOnce({ context, handle, sendText: 'テスト', dryRun: false });
    assert.strictEqual(send.status, 'sent');

    const result = await waitForAnswerCompletion({
      context,
      handle,
      baselineAssistantCount: before.assistant,
      expectedUserCount: before.user + 1,
      options: { ...FAST_OPTIONS, answer_start_timeout_sec: 1 },
    });
    assert.strictEqual(result.status, 'timeout');
    assert.strictEqual(result.phase, 'start');
    await page.close();
  });

  // --- 8. エラー検知 ---
  await check('ChatGPT側エラー表示を正常完了と区別する', async () => {
    const page = await context.newPage();
    await page.goto(mock.urlFor('conv-error', { title: 'エラーテスト', forceError: '1', startDelayMs: '100' }));
    const handle = createTargetHandle(toTargetInfo({ url: page.url(), title: 'エラーテスト' }), page);
    const before = await countMessages(page);
    const send = await sendOnce({ context, handle, sendText: 'テスト', dryRun: false });
    assert.strictEqual(send.status, 'sent');

    const result = await waitForAnswerCompletion({
      context,
      handle,
      baselineAssistantCount: before.assistant,
      expectedUserCount: before.user + 1,
      options: FAST_OPTIONS,
    });
    assert.strictEqual(result.status, 'error');
    await page.close();
  });

  // --- 9. ユーザー割り込み検知 ---
  await check('待機中に想定外のユーザーメッセージが増えたらinterruptedにする', async () => {
    const page = await context.newPage();
    await page.goto(mock.urlFor('conv-interrupt', { title: '割り込みテスト', forceNoStart: '1' }));
    const handle = createTargetHandle(toTargetInfo({ url: page.url(), title: '割り込みテスト' }), page);
    const before = await countMessages(page);
    const send = await sendOnce({ context, handle, sendText: 'テスト', dryRun: false });
    assert.strictEqual(send.status, 'sent');

    setTimeout(() => {
      page.evaluate(() => window.__mockInjectUserMessage('横から手動送信')).catch(() => {});
    }, 300);

    const result = await waitForAnswerCompletion({
      context,
      handle,
      baselineAssistantCount: before.assistant,
      expectedUserCount: before.user + 1,
      options: FAST_OPTIONS,
    });
    assert.strictEqual(result.status, 'interrupted');
    await page.close();
  });

  // --- 10. DRY RUNループ(指定回数分シミュレーションし、実送信しない) ---
  await check('DRY RUNループは指定回数分シミュレーションし、DOMには一切触れない', async () => {
    const page = await context.newPage();
    await page.goto(mock.urlFor('conv-dryloop', { title: 'DRY RUNループ' }));
    const target = toTargetInfo({ url: page.url(), title: 'DRY RUNループ' });
    const before = await countMessages(page);

    const run = stateStore.createRun({
      target_chat: target,
      send_text: 'か',
      repeat_count: 5,
      max_repeat_count: 50,
      dry_run: true,
      options: FAST_OPTIONS,
    });
    await runLoop(run.run_id, { context });
    const finalRun = stateStore.loadRun(run.run_id);
    assert.strictEqual(finalRun.status, 'completed');
    assert.strictEqual(finalRun.current_count, 5);
    const after = await countMessages(page);
    assert.strictEqual(before.user, after.user, 'DRY RUNでは実際のuserメッセージが増えないこと');
    await page.close();
  });

  // --- 11. 実ループ(2回): 回答完了後にのみ次を送信し、両方保存される ---
  await check('実ループ2回: 各回とも回答完了を待ってから次を送信し、両方の回答が保存される', async () => {
    const page = await context.newPage();
    await page.goto(mock.urlFor('conv-loop2', { title: '実ループ2回テスト', startDelayMs: '100', streamMs: '400' }));
    const target = toTargetInfo({ url: page.url(), title: '実ループ2回テスト' });

    const run = stateStore.createRun({
      target_chat: target,
      send_text: 'か',
      repeat_count: 2,
      max_repeat_count: 50,
      dry_run: false,
      options: { ...FAST_OPTIONS, between_iterations_delay_sec: 0 },
    });
    await runLoop(run.run_id, { context });
    const finalRun = stateStore.loadRun(run.run_id);
    assert.strictEqual(finalRun.status, 'completed');
    assert.strictEqual(finalRun.current_count, 2);

    const it1 = stateStore.getIteration(finalRun, 1);
    const it2 = stateStore.getIteration(finalRun, 2);
    assert.strictEqual(it1.status, 'saved');
    assert.strictEqual(it2.status, 'saved');
    assert.ok(new Date(it1.answer_completed_at) <= new Date(it2.sent_at), '1回目の回答完了後に2回目が送信されていること');

    const out1 = outputStore.readIterationOutput(run.run_id, 1, 2);
    const out2 = outputStore.readIterationOutput(run.run_id, 2, 2);
    assert.ok(out1.includes('モック回答1'));
    assert.ok(out2.includes('モック回答2'));
    await page.close();
  });

  // --- 12. 安全停止→再開(7/18型シナリオを2/5で再現) ---
  await check('2/5完了→停止→3回目から再開して5回目まで完了する(完了済みは再送信しない)', async () => {
    const page = await context.newPage();
    await page.goto(mock.urlFor('conv-resume', { title: '再開テスト', startDelayMs: '80', streamMs: '300' }));
    const target = toTargetInfo({ url: page.url(), title: '再開テスト' });

    const run = stateStore.createRun({
      target_chat: target,
      send_text: 'か',
      repeat_count: 5,
      max_repeat_count: 50,
      dry_run: false,
      options: { ...FAST_OPTIONS, between_iterations_delay_sec: 0 },
    });
    // 「2回完了後に停止した」状態を作るため、まずrepeat_count=2として実際に2回分完了させ、
    // その後repeat_count=5に復元してから再開させる(3回目以降だけが新たに送信されることを確認する)。
    let r = stateStore.loadRun(run.run_id);
    r.repeat_count = 2;
    r.iterations = r.iterations.slice(0, 2);
    r.stop_requested = false;
    stateStore.saveRun(r);
    await runLoop(run.run_id, { context });
    r = stateStore.loadRun(run.run_id);
    assert.strictEqual(r.status, 'completed');
    assert.strictEqual(r.current_count, 2);

    // ここから「本来は5回のrunだった」状態に復元し、3回目から再開させる。
    r.repeat_count = 5;
    r.status = 'stopped';
    for (let i = 3; i <= 5; i++) {
      r.iterations.push({
        iteration: i,
        status: 'pending',
        sent_at: null,
        answer_started_at: null,
        answer_completed_at: null,
        saved_at: null,
        output_file: null,
        error_reason: null,
        before_assistant_count: null,
        expected_user_count: null,
      });
    }
    stateStore.saveRun(r);

    const beforeUserCount = (await countMessages(page)).user;
    const summary = getResumeSummary(run.run_id);
    assert.strictEqual(summary.nextIteration, 3, '3回目から再開すべきと判定されること');

    const resumeResult = await resumeRun(run.run_id, context);
    assert.strictEqual(resumeResult.status, 'resumed');
    // resumeRunはバックグラウンドでrunLoopを開始するため、完了するまで待つ。
    await waitUntil(() => stateStore.loadRun(run.run_id).status === 'completed', 15000);

    const finalRun = stateStore.loadRun(run.run_id);
    assert.strictEqual(finalRun.current_count, 5);
    for (let i = 1; i <= 5; i++) {
      assert.strictEqual(stateStore.getIteration(finalRun, i).status, 'saved', `${i}回目がsavedであること`);
    }
    const afterUserCount = (await countMessages(page)).user;
    assert.strictEqual(afterUserCount - beforeUserCount, 3, '再開後は3・4・5回目の3回だけ送信されること(1・2回目は再送信しない)');
    await page.close();
  });

  // --- 13. unknown状態は自動再送しない ---
  await check('unknown状態のiterationは人間の決定なしに自動再開しない', async () => {
    const page = await context.newPage();
    await page.goto(mock.urlFor('conv-unknown', { title: 'unknownテスト' }));
    const target = toTargetInfo({ url: page.url(), title: 'unknownテスト' });

    const run = stateStore.createRun({
      target_chat: target,
      send_text: 'か',
      repeat_count: 3,
      max_repeat_count: 50,
      dry_run: false,
      options: FAST_OPTIONS,
    });
    let r = stateStore.loadRun(run.run_id);
    stateStore.patchIteration(r, 1, { status: 'saved', saved_at: new Date().toISOString() });
    stateStore.patchIteration(r, 2, { status: 'unknown', sent_at: new Date().toISOString(), error_reason: 'send_confirmation_failed' });
    r.current_count = 1;
    r.status = 'unknown';
    stateStore.saveRun(r);
    outputStore.saveIterationOutput(r, { iteration: 1, sent_at: new Date().toISOString(), answer_text: 'モック回答1' });

    const beforeUserCount = (await countMessages(page)).user;
    const withoutDecision = await resumeRun(run.run_id, context);
    assert.strictEqual(withoutDecision.status, 'needs_human_decision');
    assert.strictEqual(withoutDecision.iteration, 2);
    const afterUserCount = (await countMessages(page)).user;
    assert.strictEqual(beforeUserCount, afterUserCount, '人間の決定なしには何も送信されないこと');
    await page.close();
  });

  // --- 14. completedなrunは再開しない ---
  await check('completed状態のrunはresumeRunで進めない', async () => {
    const page = await context.newPage();
    await page.goto(mock.urlFor('conv-completed', { title: '完了済みrunテスト' }));
    const target = toTargetInfo({ url: page.url(), title: '完了済みrunテスト' });
    const run = stateStore.createRun({
      target_chat: target,
      send_text: 'か',
      repeat_count: 1,
      max_repeat_count: 50,
      dry_run: false,
      options: FAST_OPTIONS,
    });
    let r = stateStore.loadRun(run.run_id);
    stateStore.patchIteration(r, 1, { status: 'saved' });
    r.current_count = 1;
    r.status = 'completed';
    stateStore.saveRun(r);

    const beforeUserCount = (await countMessages(page)).user;
    const result = await resumeRun(run.run_id, context);
    assert.strictEqual(result.status, 'already_completed');
    const afterUserCount = (await countMessages(page)).user;
    assert.strictEqual(beforeUserCount, afterUserCount, '完了済みrunでは追加送信されないこと');
    await page.close();
  });

  // --- 15. 対象チャットが見つからない場合は誤タブへ送らない ---
  await check('対象チャットのタブが存在しない場合はtarget_not_foundで停止する', async () => {
    const target = toTargetInfo({ url: mock.urlFor('conv-missing'), title: '存在しないチャット' });
    const run = stateStore.createRun({
      target_chat: target,
      send_text: 'か',
      repeat_count: 1,
      max_repeat_count: 50,
      dry_run: false,
      options: FAST_OPTIONS,
    });
    const result = await resumeRun(run.run_id, context);
    assert.strictEqual(result.status, 'target_not_found');
  });

  // --- 16. 出力ファイルが欠損している場合は進めない(整合性チェック) ---
  await check('保存済みのはずの出力ファイルが欠損していたら再開せずneeds_reviewとする', async () => {
    const page = await context.newPage();
    await page.goto(mock.urlFor('conv-integrity', { title: '整合性テスト' }));
    const target = toTargetInfo({ url: page.url(), title: '整合性テスト' });
    const run = stateStore.createRun({
      target_chat: target,
      send_text: 'か',
      repeat_count: 2,
      max_repeat_count: 50,
      dry_run: false,
      options: FAST_OPTIONS,
    });
    let r = stateStore.loadRun(run.run_id);
    stateStore.patchIteration(r, 1, { status: 'saved', output_file: 'outputs/does-not-exist/001.txt' });
    r.current_count = 1;
    r.status = 'stopped';
    stateStore.saveRun(r);

    const result = await resumeRun(run.run_id, context);
    assert.strictEqual(result.status, 'needs_review');
    await page.close();
  });

  await context.close();
  await mock.close();

  console.log(`\n合計: ${passed}件成功 / ${failed}件失敗`);
  if (failed > 0) process.exitCode = 1;
}

function waitUntil(predicate, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('waitUntil timeout'));
      setTimeout(tick, 100);
    };
    tick();
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

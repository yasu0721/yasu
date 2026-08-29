// STEP1の初期値。ユーザーが設定変更した内容は config/config.json に保存され、
// 次回起動時にはこのデフォルトとマージされる(保存値が優先)。
module.exports = {
  target_chat: null, // { url, conversationId, title } | null
  send_text: 'か',
  repeat_count: 1,
  max_repeat_count: 50,
  dry_run: true,
  answer_start_timeout_sec: 60,
  answer_complete_timeout_sec: 600,
  answer_stable_sec: 3,
  between_iterations_delay_sec: 3,
  poll_interval_ms: 800,
};

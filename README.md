# Xバズ乗り アシスタント(MVP)

バズっているX(旧Twitter)の投稿に対してAIがコメント・引用RT候補を生成し、
アプリ画面で人間が最終確認してワンクリック投稿する「半自動運用」アプリです。
仕様の詳細は [`spec/要件定義書.md`](./spec/要件定義書.md) を参照してください。

## スコープ(MVP)

- 取得 → 分類(通常/シリアス系/経験談内省系/ネタ系/広告) → 生成(セルフチェックループ付き)
  → 候補一覧 → 人間が確認して投稿、という一連の流れ。
- 動作モードは **半自動のみ実装**しています。完全自動投稿は、Xの自動化・スパムポリシー上の
  リスクと、要件定義書・README(`spec/README.md`)自身の推奨を踏まえてスコープ外としています
  (設定画面には将来拡張の余地として選択肢のみ残しています)。
- X APIキー・`ANTHROPIC_API_KEY`が未設定でも、モックデータ/モック生成で一連の流れを
  動作確認できます(それぞれ画面上に注記が出ます)。

## セットアップ

```bash
npm install
cp .env.example .env   # 必要な値を編集(未設定でもモックで動作します)
npx prisma migrate dev # 初回のみ。SQLite DB(prisma/dev.db)を作成
npm run dev
```

http://localhost:3000 を開いてください。

### 環境変数(`.env`)

`.env.example` を参照してください。

- `ANTHROPIC_API_KEY` — Claude APIキー。未設定時は生成候補が `[MOCK/...]` 付きのダミー文言になります。
- `ANTHROPIC_MODEL` — 既定値 `claude-opus-5`。
- `X_API_KEY` / `X_API_SECRET` / `X_ACCESS_TOKEN` / `X_ACCESS_SECRET` — X APIキー(4種)。
  いずれか未設定の場合、取得はモックのバズ投稿データ、投稿はモックのツイートIDを返す動作になります。
  取得方法は [`spec/README.md`](./spec/README.md) の「ステップ1」を参照してください。

## 構成

- `spec/` — 元となる要件定義書・共通ルール・パターン集・config.yaml(そのまま使用)。
- `lib/config.ts` — `spec/config.yaml` をデフォルトとし、設定画面からの変更をDB
  (`AppSettings`テーブル)に保存して即時反映する仕組み。
- `lib/rules.ts` — `spec/common_rules.txt` / `spec/prompts/*.txt` /
  `spec/influencer_addon.txt` の読み込み・パターン分割。
- `lib/xClient.ts` — X API v2クライアント(`twitter-api-v2`)。キー未設定時はモックにフォールバック。
- `lib/classify.ts` — ジャンル判定・分類(通常/シリアス/経験談/ネタ/広告)・除外判定・バズスコア計算。
- `lib/influencer.ts` — フォロワー数からの影響力ランク(S/A/B/C)判定とキャッシュ。
  > 実際の人物リサーチ(過去言動の裏取り)は本MVPでは未実装です。事実と異なる情報を
  > 断定的に書かないという共通ルール上、根拠のない生成を避けるため、検索ツールを
  > 実装するまでは著名人リスペクト型・いじり型パターンをリサーチなしで安全側に倒しています。
- `lib/generate.ts` — Claude APIでの生成。ドラフト作成→セルフチェック→書き直し(最大3回)を
  プログラム側のループとして実装(プロンプト任せにしない、という要件定義書§14の指示に対応)。
- `lib/pipeline.ts` / `lib/actions.ts` — 取得・生成・再生成・投稿・スキップのオーケストレーション。
- `app/` — Next.js App Router。ホーム(候補一覧)・ログ・設定の3画面 + `app/api/*` のAPIルート。
- `prisma/schema.prisma` — SQLiteスキーマ(Post/Candidate/ActionLog/InfluencerCache/AppSettings)。

## 未実装・今後の課題

要件定義書 §13 に準じます。

- ログ・分析画面のダッシュボード(インプレッション推移・パターン別成果比較等)
- 完全自動投稿モード
- 著名人の実リサーチ(検索ツール連携)
- 自分発信(オリジナルポスト)専用パターン、フォロワー化・収益化導線、返信への対応方針
- マルチアカウント対応
- センシティブ話題・低品質セールスコピーの除外判定は現状キーワードベースの簡易実装です。
  運用量が増える場合はより頑健な判定ロジックへの置き換えを推奨します。

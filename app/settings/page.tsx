"use client";

import { useEffect, useState } from "react";
import type { AppConfig } from "@/lib/types";

export default function SettingsPage() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [jsonDraft, setJsonDraft] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => {
        setConfig(d.config);
        setJsonDraft(JSON.stringify(d.config, null, 2));
      });
  }, []);

  async function save(next: AppConfig) {
    setStatus(null);
    setError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!res.ok) throw new Error(`保存に失敗しました (${res.status})`);
      const data = await res.json();
      setConfig(data.config);
      setJsonDraft(JSON.stringify(data.config, null, 2));
      setStatus("保存しました");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function saveJson() {
    try {
      const parsed = JSON.parse(jsonDraft);
      save(parsed);
    } catch {
      setError("JSONの形式が正しくありません");
    }
  }

  if (!config) return <div className="text-sm text-zinc-500">読み込み中…</div>;

  const update = (fn: (c: AppConfig) => AppConfig) => setConfig((prev) => (prev ? fn(prev) : prev));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">設定</h1>
      {status && <div className="rounded-md bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{status}</div>}
      {error && <div className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-800">{error}</div>}

      <Card title="運用スケジュール">
        <Field label="巡回・投稿間隔(分)">
          <select
            value={config.schedule.interval_minutes}
            onChange={(e) =>
              update((c) => ({
                ...c,
                schedule: { ...c.schedule, interval_minutes: Number(e.target.value) },
              }))
            }
            className="input"
          >
            {[10, 30, 60, 120, 180].map((v) => (
              <option key={v} value={v}>
                {v}分
              </option>
            ))}
          </select>
        </Field>
        <Field label="稼働時間帯">
          <div className="flex items-center gap-2">
            <input
              type="time"
              value={config.schedule.active_hours.start}
              onChange={(e) =>
                update((c) => ({
                  ...c,
                  schedule: {
                    ...c.schedule,
                    active_hours: { ...c.schedule.active_hours, start: e.target.value },
                  },
                }))
              }
              className="input"
            />
            <span>〜</span>
            <input
              type="time"
              value={config.schedule.active_hours.end}
              onChange={(e) =>
                update((c) => ({
                  ...c,
                  schedule: {
                    ...c.schedule,
                    active_hours: { ...c.schedule.active_hours, end: e.target.value },
                  },
                }))
              }
              className="input"
            />
          </div>
        </Field>
        <Field label="動作モード">
          <select
            value={config.schedule.mode}
            onChange={(e) =>
              update((c) => ({
                ...c,
                schedule: { ...c.schedule, mode: e.target.value as AppConfig["schedule"]["mode"] },
              }))
            }
            className="input"
          >
            <option value="手動">手動</option>
            <option value="半自動">半自動(要確認)</option>
            <option value="完全自動" disabled>
              完全自動(未実装・将来対応)
            </option>
          </select>
        </Field>
      </Card>

      <Card title="アクション内訳・モード">
        <Field label="1日の合計アクション数">
          <input
            type="number"
            min={10}
            max={20}
            value={config.schedule.daily_action_limit.total}
            onChange={(e) =>
              update((c) => ({
                ...c,
                schedule: {
                  ...c.schedule,
                  daily_action_limit: {
                    ...c.schedule.daily_action_limit,
                    total: Number(e.target.value),
                  },
                },
              }))
            }
            className="input"
          />
        </Field>
        <Field label="内訳比率(自分発信 / コメント / 引用RT)">
          <div className="flex gap-2">
            {(["own_post_ratio", "comment_ratio", "quote_retweet_ratio"] as const).map((key) => (
              <input
                key={key}
                type="number"
                step={0.1}
                min={0}
                max={1}
                value={config.schedule.daily_action_limit[key]}
                onChange={(e) =>
                  update((c) => ({
                    ...c,
                    schedule: {
                      ...c.schedule,
                      daily_action_limit: {
                        ...c.schedule.daily_action_limit,
                        [key]: Number(e.target.value),
                      },
                    },
                  }))
                }
                className="input w-20"
              />
            ))}
          </div>
        </Field>
      </Card>

      <Card title="ジャンル・バズ閾値">
        <Field label="対象ジャンル(カンマ区切り)">
          <input
            type="text"
            value={config.target_genres.join(", ")}
            onChange={(e) =>
              update((c) => ({
                ...c,
                target_genres: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
              }))
            }
            className="input w-full"
          />
        </Field>
        <Field label="最低いいね数 / 最低RT数 / 経過時間上限(h)">
          <div className="flex gap-2">
            <input
              type="number"
              value={config.buzz_threshold.min_likes}
              onChange={(e) =>
                update((c) => ({
                  ...c,
                  buzz_threshold: { ...c.buzz_threshold, min_likes: Number(e.target.value) },
                }))
              }
              className="input w-24"
            />
            <input
              type="number"
              value={config.buzz_threshold.min_retweets}
              onChange={(e) =>
                update((c) => ({
                  ...c,
                  buzz_threshold: { ...c.buzz_threshold, min_retweets: Number(e.target.value) },
                }))
              }
              className="input w-24"
            />
            <input
              type="number"
              value={config.buzz_threshold.max_hours_since_post}
              onChange={(e) =>
                update((c) => ({
                  ...c,
                  buzz_threshold: {
                    ...c.buzz_threshold,
                    max_hours_since_post: Number(e.target.value),
                  },
                }))
              }
              className="input w-24"
            />
          </div>
        </Field>
      </Card>

      <Card title="除外ルール">
        <Toggle
          label="広告(スポンサード)ラベル付き投稿を除外"
          checked={config.exclusion_rules.exclude_sponsored_ads}
          onChange={(v) =>
            update((c) => ({
              ...c,
              exclusion_rules: { ...c.exclusion_rules, exclude_sponsored_ads: v },
            }))
          }
        />
        <Toggle
          label="断定的な副業・稼げる系セールスコピーを除外"
          checked={config.exclusion_rules.exclude_low_quality_moneymaking}
          onChange={(v) =>
            update((c) => ({
              ...c,
              exclusion_rules: { ...c.exclusion_rules, exclude_low_quality_moneymaking: v },
            }))
          }
        />
      </Card>

      <Card title="著名人・インフルエンサー対応">
        <Toggle
          label="著名人モード有効"
          checked={config.influencer_mode.enabled}
          onChange={(v) =>
            update((c) => ({ ...c, influencer_mode: { ...c.influencer_mode, enabled: v } }))
          }
        />
        <Toggle
          label="自動リサーチ"
          checked={config.influencer_mode.auto_research}
          onChange={(v) =>
            update((c) => ({ ...c, influencer_mode: { ...c.influencer_mode, auto_research: v } }))
          }
        />
        <Field label="リスクフラグ済みアカウント(カンマ区切り)">
          <input
            type="text"
            value={config.influencer_mode.risk_flagged_accounts.join(", ")}
            onChange={(e) =>
              update((c) => ({
                ...c,
                influencer_mode: {
                  ...c.influencer_mode,
                  risk_flagged_accounts: e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                },
              }))
            }
            className="input w-full"
          />
        </Field>
      </Card>

      <div>
        <button
          onClick={() => save(config)}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white"
        >
          保存
        </button>
      </div>

      <Card title="詳細設定(JSON直接編集)">
        <p className="mb-2 text-xs text-zinc-500">
          上記フォームでカバーしていない項目(pattern_eligibility, sensitive_topics
          等)はここで直接編集できます。
        </p>
        <textarea
          value={jsonDraft}
          onChange={(e) => setJsonDraft(e.target.value)}
          rows={16}
          className="w-full rounded border border-zinc-300 p-2 font-mono text-xs"
        />
        <button
          onClick={saveJson}
          className="mt-2 rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium"
        >
          JSONを保存
        </button>
      </Card>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4">
      <h2 className="mb-3 font-semibold">{title}</h2>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 text-sm">
      <label className="text-zinc-600">{label}</label>
      {children}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

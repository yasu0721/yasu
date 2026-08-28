"use client";

import { useEffect, useState } from "react";

interface LogEntry {
  id: string;
  action: string;
  postedTweetId: string | null;
  postedAt: string;
  candidate: {
    type: string;
    patternName: string;
    content: string;
    post: {
      authorHandle: string;
      authorName: string;
      text: string;
    };
  };
}

export default function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);

  useEffect(() => {
    fetch("/api/logs")
      .then((r) => r.json())
      .then((d) => setLogs(d.logs));
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">ログ・分析</h1>
      <p className="text-sm text-zinc-500">
        インプレッション推移・フォロワー推移・パターン別成果比較などのダッシュボードは未実装です
        (要件定義書.md §12「未実装、今後設計」)。ここでは投稿・スキップの操作ログのみ表示します。
      </p>

      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs text-zinc-500">
            <tr>
              <th className="px-3 py-2">日時</th>
              <th className="px-3 py-2">操作</th>
              <th className="px-3 py-2">対象投稿</th>
              <th className="px-3 py-2">内容</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id} className="border-t border-zinc-100">
                <td className="px-3 py-2 whitespace-nowrap text-zinc-500">
                  {new Date(log.postedAt).toLocaleString("ja-JP")}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs ${
                      log.action === "posted"
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-zinc-100 text-zinc-600"
                    }`}
                  >
                    {log.action === "posted" ? "投稿" : "スキップ"}
                  </span>
                  <span className="ml-2 text-xs text-zinc-500">
                    {log.candidate.type} / {log.candidate.patternName}
                  </span>
                </td>
                <td className="px-3 py-2 text-zinc-500">@{log.candidate.post.authorHandle}</td>
                <td className="px-3 py-2">{log.candidate.content}</td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-zinc-400">
                  まだログがありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

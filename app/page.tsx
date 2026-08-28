"use client";

import { useCallback, useEffect, useState } from "react";

interface Candidate {
  id: string;
  type: "COMMENT" | "QUOTE" | "OWN_POST";
  patternId: number;
  patternName: string;
  content: string;
  status: "PENDING" | "POSTED" | "SKIPPED";
  createdAt: string;
}

interface Post {
  id: string;
  authorHandle: string;
  authorName: string;
  authorFollowers: number;
  text: string;
  likeCount: number;
  retweetCount: number;
  postedAt: string;
  genre: string | null;
  classification: "NORMAL" | "SERIOUS" | "EXPERIENCE" | "MEME" | "AD";
  influencerRank: "S" | "A" | "B" | "C" | null;
  excluded: boolean;
  exclusionReason: string | null;
  candidates: Candidate[];
}

interface PatternOption {
  id: number;
  name: string;
}

const CLASSIFICATION_LABEL: Record<Post["classification"], string> = {
  NORMAL: "通常投稿",
  SERIOUS: "シリアス系",
  EXPERIENCE: "経験談・内省系",
  MEME: "ネタ・ミーム系",
  AD: "広告",
};

const TYPE_LABEL: Record<Candidate["type"], string> = {
  COMMENT: "コメント",
  QUOTE: "引用RT",
  OWN_POST: "自分発信",
};

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `request failed: ${res.status}`);
  }
  return res.json();
}

export default function Home() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [patterns, setPatterns] = useState<{ comment: PatternOption[]; quote: PatternOption[] }>({
    comment: [],
    quote: [],
  });
  const [mode, setMode] = useState<string>("半自動");
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mockNotice, setMockNotice] = useState<string | null>(null);

  const loadPosts = useCallback(async () => {
    const res = await fetch("/api/posts");
    const data = await res.json();
    setPosts(data.posts);
  }, []);

  // Initial data load. loadPosts is reused by the action handlers below, so
  // it can't be restructured as a plain effect-local fetch.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    loadPosts();
    fetch("/api/patterns")
      .then((r) => r.json())
      .then(setPatterns);
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => setMode(d.config.schedule.mode));
  }, [loadPosts]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function handleFetch() {
    setLoading("fetch");
    setError(null);
    try {
      const data = await postJson("/api/fetch", { count: 10 });
      if (data.mock) setMockNotice("X APIキー未設定のため、モックデータで取得しました。");
      await loadPosts();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(null);
    }
  }

  async function handleGenerate() {
    setLoading("generate");
    setError(null);
    try {
      const data = await postJson("/api/generate");
      if (data.mock) setMockNotice("ANTHROPIC_API_KEY未設定のため、モック候補を生成しました。");
      await loadPosts();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(null);
    }
  }

  async function handleRegenerate(candidateId: string, override?: { type?: string; patternId?: number }) {
    setLoading(candidateId);
    setError(null);
    try {
      await postJson(`/api/candidates/${candidateId}/regenerate`, override);
      await loadPosts();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(null);
    }
  }

  async function handlePost(candidateId: string) {
    setLoading(candidateId);
    setError(null);
    try {
      await postJson(`/api/candidates/${candidateId}/post`);
      await loadPosts();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(null);
    }
  }

  async function handleSkip(candidateId: string) {
    setLoading(candidateId);
    setError(null);
    try {
      await postJson(`/api/candidates/${candidateId}/skip`);
      await loadPosts();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(null);
    }
  }

  const todayPosted = posts
    .flatMap((p) => p.candidates)
    .filter((c) => c.status === "POSTED" && isToday(c.createdAt));
  const summary = {
    total: todayPosted.length,
    comment: todayPosted.filter((c) => c.type === "COMMENT").length,
    quote: todayPosted.filter((c) => c.type === "QUOTE").length,
    own: todayPosted.filter((c) => c.type === "OWN_POST").length,
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm text-zinc-500">稼働モード</div>
            <div className="text-lg font-semibold">{mode}</div>
          </div>
          <div className="flex gap-6 text-sm">
            <Stat label="本日投稿数" value={summary.total} />
            <Stat label="コメント" value={summary.comment} />
            <Stat label="引用RT" value={summary.quote} />
            <Stat label="自分発信" value={summary.own} />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleFetch}
              disabled={loading === "fetch"}
              className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {loading === "fetch" ? "取得中…" : "取得"}
            </button>
            <button
              onClick={handleGenerate}
              disabled={loading === "generate"}
              className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {loading === "generate" ? "生成中…" : "ポスト作成"}
            </button>
          </div>
        </div>
      </section>

      {mockNotice && (
        <div className="rounded-md bg-amber-50 px-4 py-2 text-sm text-amber-800">
          {mockNotice}
        </div>
      )}
      {error && (
        <div className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-800">{error}</div>
      )}

      <section className="flex flex-col gap-4">
        {posts.length === 0 && (
          <div className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500">
            「取得」ボタンでバズ投稿を取得してください。
          </div>
        )}
        {posts.map((post) => (
          <PostRow
            key={post.id}
            post={post}
            patterns={patterns}
            loading={loading}
            onRegenerate={handleRegenerate}
            onPost={handlePost}
            onSkip={handleSkip}
          />
        ))}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}

function isToday(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function PostRow({
  post,
  patterns,
  loading,
  onRegenerate,
  onPost,
  onSkip,
}: {
  post: Post;
  patterns: { comment: PatternOption[]; quote: PatternOption[] };
  loading: string | null;
  onRegenerate: (id: string, override?: { type?: string; patternId?: number }) => void;
  onPost: (id: string) => void;
  onSkip: (id: string) => void;
}) {
  const pending = post.candidates.filter((c) => c.status === "PENDING");
  const decided = post.candidates.filter((c) => c.status !== "PENDING");

  return (
    <div
      className={`grid grid-cols-1 gap-4 rounded-lg border p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] ${
        post.excluded ? "border-zinc-200 bg-zinc-100 opacity-70" : "border-zinc-200 bg-white"
      }`}
    >
      <div>
        <div className="flex items-center gap-2 text-sm">
          <span className="font-semibold">{post.authorName}</span>
          <span className="text-zinc-500">@{post.authorHandle}</span>
          {post.influencerRank && (
            <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-xs text-indigo-700">
              {post.influencerRank}ランク
            </span>
          )}
        </div>
        <p className="mt-2 whitespace-pre-wrap text-sm">{post.text}</p>
        <div className="mt-2 flex flex-wrap gap-2 text-xs text-zinc-500">
          <span>♥ {post.likeCount.toLocaleString()}</span>
          <span>RT {post.retweetCount.toLocaleString()}</span>
          <span className="rounded bg-zinc-100 px-1.5 py-0.5">
            {CLASSIFICATION_LABEL[post.classification]}
          </span>
          {post.genre && <span className="rounded bg-zinc-100 px-1.5 py-0.5">{post.genre}</span>}
        </div>
        {post.excluded && (
          <div className="mt-2 text-xs font-medium text-red-600">
            除外理由: {post.exclusionReason}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3">
        {pending.length === 0 && decided.length === 0 && !post.excluded && (
          <div className="text-sm text-zinc-400">「ポスト作成」で候補を生成してください</div>
        )}
        {pending.map((c) => (
          <CandidateCard
            key={c.id}
            candidate={c}
            patterns={patterns}
            loading={loading === c.id}
            onRegenerate={onRegenerate}
            onPost={onPost}
            onSkip={onSkip}
          />
        ))}
        {decided.map((c) => (
          <div
            key={c.id}
            className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-500"
          >
            <span className="mr-2 font-medium">
              [{TYPE_LABEL[c.type]}/{c.patternName}]
            </span>
            {c.content}
            <span className="ml-2 rounded bg-zinc-200 px-1.5 py-0.5 text-xs">
              {c.status === "POSTED" ? "投稿済み" : "スキップ済み"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CandidateCard({
  candidate,
  patterns,
  loading,
  onRegenerate,
  onPost,
  onSkip,
}: {
  candidate: Candidate;
  patterns: { comment: PatternOption[]; quote: PatternOption[] };
  loading: boolean;
  onRegenerate: (id: string, override?: { type?: string; patternId?: number }) => void;
  onPost: (id: string) => void;
  onSkip: (id: string) => void;
}) {
  const options = candidate.type === "QUOTE" ? patterns.quote : patterns.comment;

  return (
    <div className="rounded-md border border-zinc-200 p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <select
          value={candidate.type}
          disabled={loading}
          onChange={(e) => onRegenerate(candidate.id, { type: e.target.value })}
          className="rounded border border-zinc-300 px-2 py-1"
        >
          <option value="COMMENT">コメント</option>
          <option value="QUOTE">引用RT</option>
        </select>
        <select
          value={candidate.patternId}
          disabled={loading}
          onChange={(e) => onRegenerate(candidate.id, { patternId: Number(e.target.value) })}
          className="rounded border border-zinc-300 px-2 py-1"
        >
          {options.map((p) => (
            <option key={p.id} value={p.id}>
              {p.id}. {p.name}
            </option>
          ))}
        </select>
        <button
          onClick={() => onRegenerate(candidate.id)}
          disabled={loading}
          className="rounded border border-zinc-300 px-2 py-1 disabled:opacity-50"
        >
          再生成
        </button>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm">{loading ? "生成中…" : candidate.content}</p>
      <div className="mt-2 flex gap-2">
        <button
          onClick={() => onPost(candidate.id)}
          disabled={loading}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          この案でGO
        </button>
        <button
          onClick={() => onSkip(candidate.id)}
          disabled={loading}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs disabled:opacity-50"
        >
          スキップ
        </button>
      </div>
    </div>
  );
}

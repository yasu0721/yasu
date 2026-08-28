import type { AppConfig, PostClassification } from "./types";
import type { FetchedTweet } from "./xClient";

export interface ClassificationResult {
  genre: string | null;
  classification: PostClassification;
  buzzScore: number;
  isAd: boolean;
  excluded: boolean;
  exclusionReason: string | null;
}

const AD_MARKERS = ["【PR】", "[PR]", "広告", "スポンサード", "sponsored", "プロモーション"];

const SERIOUS_KEYWORDS = [
  "事故", "事件", "災害", "訃報", "逝去", "死去", "地震", "火災", "津波", "台風", "殺害", "被害",
];

const EXPERIENCE_KEYWORDS = [
  "失敗した", "反省", "内省", "弱み", "挫折", "辛かった", "苦労した", "うまくいかなかった", "後悔",
];

const MEME_MARKERS = ["ｗｗ", "www", "笑笑"];

// Heuristic keyword sets for the sensitive-topic categories listed in
// spec/config.yaml `exclusion_rules.sensitive_topics.excluded`. This is a
// deliberately coarse MVP-level filter — see 要件定義書.md §4/§14 for the
// intent; refine with real moderation tooling before scaling volume.
const SENSITIVE_KEYWORDS: Record<string, string[]> = {
  "政治(党派・政策論争・特定政党や政治家個人への言及)": [
    "自民党", "立憲民主党", "与党", "野党", "衆院選", "参院選", "総理大臣",
  ],
  宗教: ["宗教", "信仰", "教団", "布教"],
  アダルト: ["アダルト", "性的", "エロ"],
  "差別・ジェンダー論争": ["差別", "ジェンダー論争", "フェミ", "女叩き", "男叩き"],
  医療健康の断定的アドバイス: ["これを飲めば治る", "絶対治る", "副作用なし"],
  投資の断定的助言: ["絶対に儲かる", "元本保証", "必ず上がる"],
};

const LOW_QUALITY_MONEYMAKING_KEYWORDS = [
  "誰でも稼げる", "才能不要", "するだけで正解", "スキル不要で稼", "寝てるだけで稼",
];

function detectGenre(text: string, config: AppConfig): string | null {
  for (const genre of config.target_genres) {
    const keywords = config.genre_keywords[genre] ?? [];
    if (keywords.some((kw) => text.includes(kw))) {
      return genre;
    }
  }
  return null;
}

function detectClassification(text: string): PostClassification {
  if (SERIOUS_KEYWORDS.some((kw) => text.includes(kw))) return "SERIOUS";
  if (EXPERIENCE_KEYWORDS.some((kw) => text.includes(kw))) return "EXPERIENCE";
  if (MEME_MARKERS.some((kw) => text.includes(kw))) return "MEME";
  return "NORMAL";
}

function computeBuzzScore(tweet: FetchedTweet, config: AppConfig): number {
  const hoursSince = Math.max(
    (Date.now() - tweet.postedAt.getTime()) / 3_600_000,
    0.1,
  );
  if (config.scoring.method === "likes_per_hour") {
    return tweet.likeCount / hoursSince;
  }
  return tweet.likeCount / hoursSince;
}

export function classifyPost(
  tweet: FetchedTweet,
  config: AppConfig,
): ClassificationResult {
  const text = tweet.text;
  const isAd =
    Boolean(tweet.isAdLabelled) ||
    AD_MARKERS.some((marker) => text.includes(marker));

  if (isAd) {
    return {
      genre: detectGenre(text, config),
      classification: "AD",
      buzzScore: computeBuzzScore(tweet, config),
      isAd: true,
      excluded: config.exclusion_rules.exclude_sponsored_ads,
      exclusionReason: config.exclusion_rules.exclude_sponsored_ads
        ? "広告(スポンサード)ラベル付き投稿のため自動スキップ"
        : null,
    };
  }

  const classification = detectClassification(text);
  const genre = detectGenre(text, config);
  const buzzScore = computeBuzzScore(tweet, config);
  const hoursSince =
    (Date.now() - tweet.postedAt.getTime()) / 3_600_000;

  if (
    config.exclusion_rules.exclude_low_quality_moneymaking &&
    LOW_QUALITY_MONEYMAKING_KEYWORDS.some((kw) => text.includes(kw))
  ) {
    return {
      genre,
      classification,
      buzzScore,
      isAd: false,
      excluded: true,
      exclusionReason:
        "断定的な副業・稼げる系セールスコピーに該当するため自動スキップ",
    };
  }

  for (const [category, keywords] of Object.entries(SENSITIVE_KEYWORDS)) {
    if (keywords.some((kw) => text.includes(kw))) {
      return {
        genre,
        classification,
        buzzScore,
        isAd: false,
        excluded: true,
        exclusionReason: `センシティブ話題(${category})に該当するため自動スキップ`,
      };
    }
  }

  if (
    tweet.likeCount < config.buzz_threshold.min_likes &&
    tweet.retweetCount < config.buzz_threshold.min_retweets
  ) {
    return {
      genre,
      classification,
      buzzScore,
      isAd: false,
      excluded: true,
      exclusionReason: "いいね数・RT数がバズ閾値未満のため対象外",
    };
  }

  if (hoursSince > config.buzz_threshold.max_hours_since_post) {
    return {
      genre,
      classification,
      buzzScore,
      isAd: false,
      excluded: true,
      exclusionReason: "投稿からの経過時間が閾値を超えているため対象外",
    };
  }

  return {
    genre,
    classification,
    buzzScore,
    isAd: false,
    excluded: false,
    exclusionReason: null,
  };
}

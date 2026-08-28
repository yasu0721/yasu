// Shared literal unions. SQLite has no enum type, so these are enforced only
// in application code (see prisma/schema.prisma header comment).

export type PostClassification =
  | "NORMAL"
  | "SERIOUS"
  | "EXPERIENCE"
  | "MEME"
  | "AD";

export type InfluencerRank = "S" | "A" | "B" | "C";

export type ActionType = "COMMENT" | "QUOTE" | "OWN_POST";

export type CandidateStatus = "PENDING" | "POSTED" | "SKIPPED";

export type OperationMode = "手動" | "半自動" | "完全自動";

// Shape of spec/config.yaml (and the DB-backed override of it).
export interface AppConfig {
  schedule: {
    interval_minutes: number;
    active_hours: { start: string; end: string };
    daily_action_limit: {
      total: number;
      own_post_ratio: number;
      comment_ratio: number;
      quote_retweet_ratio: number;
    };
    mode: OperationMode;
  };
  buzz_threshold: {
    min_likes: number;
    min_retweets: number;
    max_hours_since_post: number;
  };
  scoring: { method: string };
  target_genres: string[];
  genre_keywords: Record<string, string[]>;
  influencer_mode: {
    enabled: boolean;
    target_accounts: string[];
    auto_research: boolean;
    influence_rank_check: boolean;
    risk_flagged_accounts: string[];
    teasing_mode: {
      enabled_condition: string;
      forbidden_topics: string[];
    };
  };
  exclusion_rules: {
    exclude_sponsored_ads: boolean;
    exclude_low_quality_moneymaking: boolean;
    sensitive_topics: {
      excluded: string[];
      excluded_exceptions: string[];
      allowed_with_caution: string[];
    };
  };
  pattern_eligibility: Record<
    string,
    {
      comment_patterns?: number[];
      quote_patterns?: number[];
      quote_patterns_caution?: number[];
      quote_patterns_excluded?: number[];
      tone_override?: string;
      allow_skip?: boolean;
      excluded_patterns_note?: string;
      action?: string;
      reason?: string;
    }
  >;
  diversity_control: {
    enabled: boolean;
    lookback_count: number;
    avoid_repeat_pattern: boolean;
    vary_length: boolean;
    vary_tone: boolean;
    casual_ratio_target: string;
  };
  quote_opener_policy: {
    mode: string;
    tone_tagging: boolean;
    require_specific_reference: boolean;
    diversity_tracking: boolean;
  };
}

// Maps PostClassification -> the pattern_eligibility key used in config.yaml
// (Japanese labels, kept as authored in spec/config.yaml).
export const CLASSIFICATION_TO_ELIGIBILITY_KEY: Record<
  PostClassification,
  string
> = {
  NORMAL: "通常投稿",
  SERIOUS: "シリアス系(事件・災害等)",
  EXPERIENCE: "経験談・内省系(失敗談・弱み開示を含む投稿)",
  MEME: "ネタ・ミーム系投稿",
  AD: "広告投稿",
};

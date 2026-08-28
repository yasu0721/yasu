import type { AppConfig, ActionType, PostClassification } from "./types";
import { CLASSIFICATION_TO_ELIGIBILITY_KEY } from "./types";

export interface EligiblePattern {
  id: number;
  caution: boolean;
}

/**
 * Returns the comment/quote pattern ids allowed for a given post
 * classification, per config.yaml `pattern_eligibility` (要件定義書.md §8).
 *
 * Two patterns are always excluded from *automatic* generation regardless
 * of eligibility list, and only offered via manual override in the UI:
 * - #10 (著名人リスペクト型) / #11 (著名人いじり・ツッコミ型) when the post
 *   is not from a detected influencer.
 * - #11 additionally requires a human to confirm the
 *   `teasing_mode.enabled_condition` (self-deprecation is public knowledge)
 *   — that judgment call isn't automatable, so auto-generation never picks
 *   it; it stays selectable by hand in the candidate row's pattern dropdown.
 *
 * 自分発信(OWN_POST) patterns are not yet defined as their own set
 * (要件定義書.md §13「未確定」) — per common_rules.txt §「引用RT・自分発信の
 * 深掘り基準(型D)」 the quote-tweet patterns double as the closest
 * available structure for own-post generation until a dedicated set exists.
 */
export function getEligiblePatterns(
  type: ActionType,
  classification: PostClassification,
  config: AppConfig,
  opts: { isInfluencer: boolean },
): EligiblePattern[] {
  const key = CLASSIFICATION_TO_ELIGIBILITY_KEY[classification];
  const rule = config.pattern_eligibility[key];
  if (!rule || rule.action === "skip") return [];

  let ids: EligiblePattern[];
  if (type === "COMMENT") {
    ids = (rule.comment_patterns ?? []).map((id) => ({ id, caution: false }));
  } else {
    const standard = (rule.quote_patterns ?? []).map((id) => ({
      id,
      caution: false,
    }));
    const caution = (rule.quote_patterns_caution ?? []).map((id) => ({
      id,
      caution: true,
    }));
    ids = [...standard, ...caution];
  }

  return ids.filter(({ id }) => {
    if ((id === 10 || id === 11) && !opts.isInfluencer) return false;
    if (id === 11) return false; // requires human confirmation, see doc comment above
    return true;
  });
}

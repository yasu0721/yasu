// 振り分けGPTの回答テキストを、後続処理が使える形へ解析する。
// 想定フォーマット(prompts/router.txt が指示している形式):
//
// 【使うGPT】
// - id: 理由
// - id2: 理由
//
// 【狙う反応】
// いいね
//
// 【避けるもの】
// 断定的すぎる表現

// 見出し(【〜】)ごとに本文を分割する。
function splitSections(text) {
  const sections = {};
  const lines = text.split(/\r?\n/);
  let current = null;
  for (const line of lines) {
    const heading = line.match(/^【(.+?)】\s*$/);
    if (heading) {
      current = heading[1];
      sections[current] = [];
      continue;
    }
    if (current) {
      sections[current].push(line);
    }
  }
  for (const key of Object.keys(sections)) {
    sections[key] = sections[key].join('\n').trim();
  }
  return sections;
}

// 「- id: 理由」「id: 理由」「id」のような行から専門GPTのidを拾う。
function extractGptIds(sectionText, availableIds) {
  if (!sectionText) return [];
  const found = [];
  for (const rawLine of sectionText.split(/\r?\n/)) {
    const line = rawLine.replace(/^[-・*\s]+/, '').trim();
    if (!line) continue;
    const idPart = line.split(/[:：]/)[0].trim();
    if (availableIds.includes(idPart) && !found.includes(idPart)) {
      found.push(idPart);
    }
  }
  return found;
}

// 振り分けGPTの回答を解析する。
// 解析に失敗した場合(【使うGPT】が無い/有効な専門GPTが1つも見つからない)は null を返す。
// 呼び出し側は null の場合、安全側に倒して処理を止めること。
function parseRouterOutput(text, availableIds) {
  const sections = splitSections(text);
  const usedGptSection = sections['使うGPT'];
  if (!usedGptSection) return null;

  const selectedIds = extractGptIds(usedGptSection, availableIds);
  if (selectedIds.length === 0) return null;

  return {
    selectedIds,
    targetReaction: sections['狙う反応'] || '',
    avoid: sections['避けるもの'] || '',
  };
}

module.exports = { parseRouterOutput };

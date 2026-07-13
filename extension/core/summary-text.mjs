export const CARD_SUMMARY_POLICY_VERSION = 2;

const STRUCTURAL_HEADING = /^(?:总结|摘要|核心内容|核心事实|实际影响|后续关注|信息边界|重点|重要性|为何重要|行动建议|總結|核心內容|核心事實|實際影響|後續關注|資訊邊界|重點|為何重要|行動建議|summary|core content|core facts?|practical impact|what to watch|information boundar(?:y|ies)|key points?|why it matters|importance|suggested next actions?|next actions?)\s*[:：]?$/i;
const STRUCTURAL_PREFIX = /^(?:总结|摘要|核心内容|核心事实|实际影响|后续关注|信息边界|重点|重要性|为何重要|行动建议|總結|核心內容|核心事實|實際影響|後續關注|資訊邊界|重點|為何重要|行動建議|summary|core content|core facts?|practical impact|what to watch|information boundar(?:y|ies)|key points?|why it matters|importance|suggested next actions?|next actions?)\s*[:：]/i;
const STRUCTURAL_LABEL = /(^|[。！？.!?；;,，]\s*|\s+)(?:总结|摘要|核心内容|核心事实|实际影响|后续关注|信息边界|重点|重要性|为何重要|行动建议|總結|核心內容|核心事實|實際影響|後續關注|資訊邊界|重點|為何重要|行動建議|summary|core content|core facts?|practical impact|what to watch|information boundar(?:y|ies)|key points?|why it matters|importance|suggested next actions?|next actions?)\s*[:：]\s*/gi;
const GENERATED_TITLE = /^(?:标题|標題|title)\s*[:：]\s*(.+)$/i;

export function normalizeSummaryMarkup(value) {
  return String(value || "")
    .replace(/^\s*(?:>\s*)?(?:#{1,6}\s*|[-*•]\s+|\d+[.)、]\s*)/, "")
    .replace(/!?\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/[*_~`]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function isStructuralSummaryHeading(value) {
  return STRUCTURAL_HEADING.test(String(value || "").trim());
}

export function hasStructuralSummaryPrefix(value) {
  return STRUCTURAL_PREFIX.test(String(value || "").trim());
}

export function extractGeneratedSummaryTitle(value, maxLength = 64) {
  const match = normalizeSummaryMarkup(value).match(GENERATED_TITLE);
  if (!match) return "";
  const title = match[1].trim();
  return Array.from(title).slice(0, Math.max(0, Number(maxLength) || 0)).join("").trim();
}

export function cleanGeneratedSummaryLine(value) {
  const line = normalizeSummaryMarkup(value);
  if (!line || isStructuralSummaryHeading(line) || extractGeneratedSummaryTitle(line)) return "";
  return line.replace(STRUCTURAL_LABEL, "$1").replace(/\s+/g, " ").trim();
}

export function limitGeneratedSummaryLines(values, maxLength = 280, maxLines = 3) {
  const characterLimit = Math.max(0, Math.floor(Number(maxLength) || 0));
  const lineLimit = Math.max(0, Math.floor(Number(maxLines) || 0));
  const output = [];
  let used = 0;
  for (const value of Array.isArray(values) ? values : []) {
    if (output.length >= lineLimit || used >= characterLimit) break;
    const line = String(value || "").trim();
    if (!line) continue;
    const characters = Array.from(line);
    const remaining = characterLimit - used;
    const bounded = characters.length > remaining
      ? `${characters.slice(0, Math.max(0, remaining - 1)).join("").trimEnd()}${remaining ? "…" : ""}`
      : line;
    if (!bounded) continue;
    output.push(bounded);
    used += Array.from(bounded).length;
  }
  return output;
}

export function parseGeneratedDailyDigest(value, itemCount = 5) {
  const overview = [];
  const fallbackOverview = [];
  const count = Math.min(12, Math.max(0, Number(itemCount) || 0));
  const eventTitles = Array.from({ length: count }, () => "");
  const aiScores = Array.from({ length: count }, () => null);
  const seenScores = new Set();
  let invalidScore = false;
  for (const rawLine of String(value || "").split(/\n+/)) {
    const line = normalizeSummaryMarkup(rawLine);
    if (!line) continue;
    const scoreMatch = line.match(/^(?:rank|评分|評分)\s*(\d{1,2})\s*[:：]\s*(-?\d+(?:\.\d+)?)\s*$/i);
    if (scoreMatch) {
      const index = Number(scoreMatch[1]) - 1;
      const score = Number(scoreMatch[2]);
      if (index < 0 || index >= aiScores.length || seenScores.has(index) || !Number.isInteger(score) || score < 0 || score > 100) {
        invalidScore = true;
      } else {
        seenScores.add(index);
        aiScores[index] = score;
      }
      continue;
    }
    const eventMatch = line.match(/^(?:title|event|标题|標題|事件)\s*(\d{1,2})\s*[:：]\s*(.+)$/i);
    if (eventMatch) {
      const index = Number(eventMatch[1]) - 1;
      if (index >= 0 && index < eventTitles.length) {
        eventTitles[index] = Array.from(eventMatch[2].trim()).slice(0, 64).join("").trim();
      }
      continue;
    }
    const overviewMatch = line.match(/^(?:overview|总览|總覽)\s*[:：]\s*(.+)$/i);
    if (overviewMatch) {
      if (overview.length < 3) overview.push(overviewMatch[1].trim());
      continue;
    }
    if (fallbackOverview.length < 3) fallbackOverview.push(line);
  }
  const distinctScores = new Set(aiScores.filter((score) => Number.isFinite(score)));
  const rankingValid = !invalidScore
    && count > 0
    && seenScores.size === count
    && (count === 1 || distinctScores.size > 1);
  return {
    overview: overview.length ? overview : fallbackOverview,
    eventTitles,
    aiScores,
    rankingValid,
  };
}

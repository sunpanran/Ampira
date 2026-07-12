const STRUCTURAL_HEADING = /^(?:总结|摘要|核心内容|重点|重要性|为何重要|行动建议|總結|核心內容|重點|為何重要|行動建議|summary|core content|key points?|why it matters|importance|suggested next actions?|next actions?)\s*[:：]?$/i;
const STRUCTURAL_PREFIX = /^(?:总结|摘要|核心内容|重点|重要性|为何重要|行动建议|總結|核心內容|重點|為何重要|行動建議|summary|core content|key points?|why it matters|importance|suggested next actions?|next actions?)\s*[:：]/i;
const STRUCTURAL_LABEL = /(^|[。！？.!?；;,，]\s*|\s+)(?:总结|摘要|核心内容|重点|重要性|为何重要|行动建议|總結|核心內容|重點|為何重要|行動建議|summary|core content|key points?|why it matters|importance|suggested next actions?|next actions?)\s*[:：]\s*/gi;
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

export function parseGeneratedDailyDigest(value, itemCount = 5) {
  const overview = [];
  const fallbackOverview = [];
  const eventTitles = Array.from({ length: Math.min(5, Math.max(0, Number(itemCount) || 0)) }, () => "");
  for (const rawLine of String(value || "").split(/\n+/)) {
    const line = normalizeSummaryMarkup(rawLine);
    if (!line) continue;
    const eventMatch = line.match(/^(?:event|事件)\s*(\d{1,2})\s*[:：]\s*(.+)$/i);
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
  return { overview: overview.length ? overview : fallbackOverview, eventTitles };
}

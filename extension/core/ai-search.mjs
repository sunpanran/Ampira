export const AI_ARTICLE_CONTEXT_MAX_CHARS = 8000;
export const AI_FOLLOWUP_QUERY_MAX_CHARS = 500;
export const AI_FOLLOWUP_HISTORY_MAX_CHARS = 4000;
export const AI_FOLLOWUP_HISTORY_MAX_TURNS = 6;

export function limitArticleSummary(value, locale = "zh-CN") {
  const text = String(value || "").trim();
  if (!text) return "";
  if (locale === "en") return limitEnglishWords(text, 180);
  return limitCodePointsAtBoundary(text, 500);
}

export function normalizeArticleContext(value, locale = "zh-CN", normalizeUrl = (url) => String(url || "").trim()) {
  if (!value || value.type !== "article") return null;
  const url = normalizeUrl(value.url);
  if (!url) return null;
  const summary = limitArticleSummary(value.summary, locale);
  const sourceTurns = Array.isArray(value.turns) ? value.turns.slice(-AI_FOLLOWUP_HISTORY_MAX_TURNS) : [];
  const turns = [];
  let remaining = AI_FOLLOWUP_HISTORY_MAX_CHARS;
  for (let index = sourceTurns.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const question = limitCodePoints(String(sourceTurns[index]?.question || "").trim(), AI_FOLLOWUP_QUERY_MAX_CHARS);
    const answer = limitCodePoints(String(sourceTurns[index]?.answer || "").trim(), 1200);
    if (!question || !answer) continue;
    const combinedLength = codePointLength(question) + codePointLength(answer);
    if (combinedLength > remaining && turns.length) break;
    const boundedQuestion = limitCodePoints(question, Math.min(AI_FOLLOWUP_QUERY_MAX_CHARS, remaining));
    const answerBudget = Math.max(0, remaining - codePointLength(boundedQuestion));
    const boundedAnswer = limitCodePoints(answer, answerBudget);
    if (!boundedQuestion || !boundedAnswer) break;
    turns.unshift({ question: boundedQuestion, answer: boundedAnswer });
    remaining -= codePointLength(boundedQuestion) + codePointLength(boundedAnswer);
  }
  return { type: "article", url, summary, turns };
}

export function limitCodePoints(value, maxChars) {
  if (maxChars <= 0) return "";
  return [...String(value || "")].slice(0, maxChars).join("");
}

function limitEnglishWords(value, maxWords) {
  const words = String(value || "").trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return words.join(" ");
  const bounded = words.slice(0, Math.max(1, maxWords - 1));
  let boundary = -1;
  for (let index = bounded.length - 1; index >= Math.floor(maxWords * .7); index -= 1) {
    if (/[.!?;:]$/.test(bounded[index])) {
      boundary = index + 1;
      break;
    }
  }
  return `${bounded.slice(0, boundary > 0 ? boundary : bounded.length).join(" ").trimEnd()} …`;
}

function limitCodePointsAtBoundary(value, maxChars) {
  const characters = [...String(value || "").trim()];
  if (characters.length <= maxChars) return characters.join("");
  const bounded = characters.slice(0, Math.max(1, maxChars - 1)).join("");
  let boundary = -1;
  for (const marker of ["\n", "。", "！", "？", "；", ".", "!", "?", ";"]) {
    boundary = Math.max(boundary, bounded.lastIndexOf(marker));
  }
  const minimumBoundary = Math.floor(maxChars * .7);
  const prefix = boundary >= minimumBoundary ? bounded.slice(0, boundary + 1) : bounded;
  return `${prefix.trimEnd()}…`;
}

function codePointLength(value) {
  return [...String(value || "")].length;
}

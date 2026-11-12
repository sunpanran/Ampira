import { hashText } from "./bookmarks.mjs";

export const QUESTION_CONTEXT_LIMIT = 1200;
export const BRIEF_CONTEXT_LIMIT = 4500;
export const REFERENCE_LIMIT = 4500;
export function shortText(value, limit) { return String(value || "").slice(0, limit).replace(/[\uD800-\uDBFF]$/, "").trim(); }

export function taskReference(item, index = 0) {
  let url = "";
  try { const parsed = new URL(item.url); if (parsed.protocol === "https:" && !parsed.username && !parsed.password && parsed.href.length <= 2048) url = parsed.href; } catch {}
  return { id: `ref-${hashText(`${item.url || index}|${item.title}|${item.excerpt}`)}`, title: shortText(item.title, 160),
    excerpt: shortText(item.excerpt || item.summary, 1000), source: shortText(item.publisher || item.source, 80),
    publishedAt: shortText(item.publishedAt, 30), url };
}
export function boundedReferences(values, maximum = 3, budget = REFERENCE_LIMIT) {
  const references = (Array.isArray(values) ? values : []).slice(0, maximum).map((value, index) => {
    const normalized = taskReference(value, index);
    if (typeof value.id === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value.id)) normalized.id = value.id;
    return normalized;
  });
  while (JSON.stringify(references).length > budget) {
    const long = references.findLast(value => value.excerpt.length > 160 || value.url.length > 300);
    if (long) { long.excerpt = shortText(long.excerpt, 160); long.url = ""; }
    else references.pop();
  }
  return references;
}
export function compactQuestionContext(references = [], recent = [], notice = "") {
  const context = {
    items: references.slice(0, 3).map(value => ({ id: shortText(value.id, 100), title: shortText(value.title, 100), excerpt: shortText(value.excerpt, 120) })),
    recent: recent.slice(-2).map(value => ({ question: shortText(value.question, 120), answer: shortText(value.answer, 180) })),
    ...(notice ? { notice: shortText(notice, 180) } : {}),
  };
  while (JSON.stringify(context).length > QUESTION_CONTEXT_LIMIT) {
    if (context.items.length > 1) context.items.pop();
    else if (context.recent.length) context.recent.shift();
    else context.items.pop();
  }
  return context;
}
export function briefContext(items) {
  const references = (items || []).slice(0, 12).map(taskReference);
  const context = references.map(value => ({ id: value.id, title: shortText(value.title, 120), excerpt: shortText(value.excerpt, 180),
    source: shortText(value.source, 60), publishedAt: value.publishedAt }));
  while (JSON.stringify(context).length > BRIEF_CONTEXT_LIMIT) context.pop();
  const bounded = boundedReferences(references.filter(value => context.some(item => item.id === value.id)), 12, 12000);
  return { context: context.filter(value => bounded.some(item => item.id === value.id)), references: bounded };
}

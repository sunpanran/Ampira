import { validTranslation } from "../core/feed-localization.mjs";
import { isAiContentError } from "../core/card-summary-retry.mjs";
import { normalizeCardSummary } from "../core/card-summary-format.mjs";

export async function translateFeedBatch(items, locale, request) {
  const remaining = new Map(items.map((item, index) => [String(index + 1), item]));
  const results = new Map();
  let received = false;
  for (let attempt = 0; attempt < 2 && remaining.size; attempt++) {
    const inputs = [...remaining].map(([id, item]) => ({ id, title: String(item.title || "").slice(0, 200), excerpt: String(item.excerpt || "").trim().slice(0, 2000) }));
    let text;
    try { text = await request(inputs); received = true; }
    catch (error) {
      if (isAiContentError(error) && attempt === 0) continue;
      if (!received && !isAiContentError(error)) throw error;
      return { results, failed: [...remaining.values()], error };
    }
    let rows;
    try { rows = JSON.parse(String(text).trim().replace(/^```(?:json)?\s*|\s*```$/g, "")).translations; } catch { rows = []; }
    if (!Array.isArray(rows)) rows = [];
    const counts = new Map();
    for (const row of rows) counts.set(row?.id, (counts.get(row?.id) || 0) + 1);
    for (const row of rows) {
      if (!remaining.has(row?.id) || counts.get(row.id) !== 1 || !validTranslation(row, locale)) continue;
      const normalized = normalizeCardSummary(row);
      if (!validTranslation(normalized, locale)) continue;
      const item = remaining.get(row.id);
      results.set(item.articleId || item.entryKey, normalized);
      remaining.delete(row.id);
    }
  }
  return { results, failed: [...remaining.values()], error: null };
}

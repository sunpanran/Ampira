export function normalizeUserUrl(value) {
  const text = String(value || "").trim();
  const candidate = /^https?:\/\//i.test(text) ? text : (/^[\w.-]+\.[a-z]{2,}(?:[/:?#].*)?$/i.test(text) ? `https://${text}` : "");
  if (!candidate) return "";
  try {
    const url = new URL(candidate);
    if (url.protocol === "https:") return url.href;
    if (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)) return url.href;
  } catch {}
  return "";
}

export function searchFeed(items, query) {
  const terms = searchQueryTerms(query);
  if (!terms.length) return [];
  return (items || []).map((item) => {
    const title = String(item.title || "").toLowerCase();
    const excerpt = String(item.excerpt || "").toLowerCase();
    const source = `${item.source || ""} ${item.category || ""}`.toLowerCase();
    const score = terms.reduce((total, term) => total
      + (title.includes(term) ? 4 : 0)
      + (excerpt.includes(term) ? 2 : 0)
      + (source.includes(term) ? 1 : 0), 0);
    return { item, score };
  }).filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || Number(b.item.score || 0) - Number(a.item.score || 0))
    .map((entry) => entry.item);
}

export function searchQueryTerms(query) {
  const text = String(query || "").trim().toLowerCase();
  if (!text) return [];
  const terms = new Set(text.split(/[^\p{L}\p{N}]+/u).filter((term) => term.length > 1));
  try {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
    for (const segment of segmenter.segment(text)) {
      const term = String(segment.segment || "").trim();
      if (segment.isWordLike && term.length > 1) terms.add(term);
    }
  } catch {}
  for (const sequence of text.match(/[\p{Script=Han}]{2,}/gu) || []) {
    for (let index = 0; index < sequence.length - 1; index += 1) terms.add(sequence.slice(index, index + 2));
  }
  return [...terms];
}

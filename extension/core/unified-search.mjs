import { normalizeUserUrl, normalizeSearchQuery, PRIORITY_BOOKMARK_LIMIT } from "./search.mjs";

export const SEARCH_RESULT_LIMIT = 20;
export const HISTORY_CANDIDATE_LIMIT = 200;
const BOOKMARK_MATCH_ORDER = { exact: 0, prefix: 1, normal: 2, "": 3 };

export function bookmarkSearchEntries(tree) {
  const entries = [];
  const visit = (nodes, parts) => {
    for (const node of Array.isArray(nodes) ? nodes : []) {
      if (node.url) {
        entries.push({ title: node.title, url: node.url, folderPath: parts.join(" / "), sources: ["bookmark"] });
      } else {
        visit(node.children, node.title ? [...parts, node.title] : parts);
      }
    }
  };
  visit(tree, []);
  return entries;
}

export function ampiraSearchEntries(dashboard = {}) {
  const feed = (dashboard.feed?.items || []).map(item => ({
    title: item.summaryTitle || item.title,
    url: item.url,
    text: [item.title, item.excerpt, ...(Array.isArray(item.summary) ? item.summary : [])].join(" "),
    detail: item.source || item.publisher || "",
    articleId: item.articleId || item.entryKey || "",
    sourceKey: item.sourceKey || "",
    contentKind: "article",
    sources: ["ampira"],
  }));
  const inspiration = (dashboard.bookmarks || []).filter(item => item.cardType === "inspiration").map(item => ({
    title: item.title, url: item.url, text: item.description || "", detail: item.category || "", sources: ["ampira"],
  }));
  return [...feed, ...inspiration];
}

export function rankSearchEntries(entries, query, limit = SEARCH_RESULT_LIMIT) {
  const needle = normalizeSearchQuery(query).toLowerCase();
  if (!needle) return [];
  const merged = new Map();
  for (const entry of entries) {
    const url = normalizeUserUrl(entry?.url);
    if (!url) continue;
    const sources = ["bookmark", "ampira", "history"].filter(source => entry.sources?.includes(source));
    if (!sources.length) continue;
    const score = matchScore(entry, url, needle);
    const next = {
      id: url, url, title: String(entry.title || new URL(url).hostname).slice(0, 500),
      sources, folderPath: String(entry.folderPath || "").slice(0, 1000),
      detail: String(entry.detail || "").slice(0, 500),
      lastVisitTime: Number(entry.lastVisitTime) || 0,
      articleId: String(entry.articleId || ""), sourceKey: String(entry.sourceKey || ""),
      contentKind: entry.contentKind === "article" ? "article" : "website",
      bookmarkMatch: sources.includes("bookmark") ? score === 400 ? "exact"
        : score === 300 && [...needle].length >= 2 ? "prefix" : "normal" : "",
      score,
    };
    const previous = merged.get(url);
    if (previous) {
      const preferred = sourceOrder(next) < sourceOrder(previous) ? next : previous;
      merged.set(url, {
        ...preferred,
        sources: ["bookmark", "ampira", "history"].filter(source => previous.sources.includes(source) || sources.includes(source)),
        score: Math.max(previous.score, score),
        bookmarkMatch: BOOKMARK_MATCH_ORDER[previous.bookmarkMatch] <= BOOKMARK_MATCH_ORDER[next.bookmarkMatch]
          ? previous.bookmarkMatch : next.bookmarkMatch,
        folderPath: previous.folderPath || next.folderPath,
        lastVisitTime: Math.max(previous.lastVisitTime, next.lastVisitTime),
        articleId: previous.articleId || next.articleId, sourceKey: previous.sourceKey || next.sourceKey,
        contentKind: previous.contentKind === "article" || next.contentKind === "article" ? "article" : "website",
      });
    } else merged.set(url, next);
  }
  const ranked = [...merged.values()].filter(entry => entry.score > 0).sort((a, b) => sourceOrder(a) - sourceOrder(b)
    || b.score - a.score || b.lastVisitTime - a.lastVisitTime || a.url.localeCompare(b.url));
  const priority = ranked.filter(entry => BOOKMARK_MATCH_ORDER[entry.bookmarkMatch] < 2)
    .sort((a, b) => BOOKMARK_MATCH_ORDER[a.bookmarkMatch] - BOOKMARK_MATCH_ORDER[b.bookmarkMatch])
    .slice(0, PRIORITY_BOOKMARK_LIMIT);
  const priorityIds = new Set(priority.map(entry => entry.id));
  return [...priority, ...ranked.filter(entry => !priorityIds.has(entry.id))]
    .slice(0, limit).map(({ score, ...entry }) => entry);
}

function sourceOrder(entry) {
  return entry.sources.includes("bookmark") ? 0 : entry.sources.includes("ampira") ? 1 : 2;
}

function matchScore(entry, url, needle) {
  const title = String(entry.title || "").toLowerCase();
  const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  if (title === needle || host === needle) return 400;
  if (title.startsWith(needle) || host.startsWith(needle)) return 300;
  if (title.includes(needle) || host.includes(needle)) return 200;
  const searchable = `${title} ${url} ${entry.folderPath || ""} ${entry.detail || ""} ${entry.text || ""}`.toLowerCase();
  if (searchable.includes(needle)) return 100;
  const terms = needle.split(/\s+/).filter(Boolean);
  return terms.length > 1 && terms.every(term => searchable.includes(term)) ? 50 : 0;
}

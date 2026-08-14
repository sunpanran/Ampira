import { searchQueryTerms } from "./search.mjs";

const RESEARCH_EVIDENCE_LIMIT = 12;
export const RESEARCH_SOURCE_BATCH_SIZE = 4;
export const RESEARCH_FULL_TEXT_LIMIT = 3;
const RESEARCH_CACHE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const RESEARCH_CACHE_ENTRY_LIMIT = 2000;
const RESEARCH_CACHE_BYTE_LIMIT = 6 * 1024 * 1024;

const MATERIAL_CHANGE = /(?:发布|發佈|推出|上线|上線|开放|開放|支持|更新|停止|关闭|關閉|收购|收購|融资|融資|涨价|漲價|降价|降價|release|launch|announce|support|update|discontinue|acquir|funding|price)/i;
const PUBLIC_IMPACT = /(?:政策|法律|法规|法規|监管|監管|安全|漏洞|隐私|隱私|行业|產業|市场|市場|用户|用戶|开发者|開發者|policy|law|regulat|security|vulnerab|privacy|market|users?|developers?)/i;
const TRACKING_PARAMS = new Set([
  "fbclid", "gclid", "mc_cid", "mc_eid", "ref", "ref_src", "spm",
  "utm_campaign", "utm_content", "utm_medium", "utm_source", "utm_term",
]);
const SOURCE_KIND_PRIORITY = { bookmark: 3, ampira: 2, web: 1 };
const READ_LEVEL_PRIORITY = { full: 4, feed: 3, snippet: 2, bookmark: 1 };

export function normalizeResearchRequest(value = {}) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const bookmarkFolderId = cleanText(input.bookmarkFolderId).slice(0, 256);
  const webSearch = input.webSearch === true;
  const cursor = cleanText(input.cursor).slice(0, 256);
  return { bookmarkFolderId, webSearch, cursor };
}

export function researchRequestEnabled(value = {}) {
  const research = normalizeResearchRequest(value);
  return Boolean(research.bookmarkFolderId || research.webSearch);
}

export function listResearchFolders(tree) {
  const folders = [];
  for (const root of treeRoots(tree)) collectFolderSummary(root, [], folders, true);
  return folders
    .filter((folder) => folder.path && folder.bookmarkCount > 0)
    .sort((left, right) => left.path.localeCompare(right.path, undefined, { numeric: true, sensitivity: "base" }));
}

export function folderResearchInventory(tree, folderId) {
  const requestedId = cleanText(folderId);
  if (!requestedId) return null;
  const located = findFolder(tree, requestedId);
  if (!located) return null;
  const bookmarks = [];
  collectFolderBookmarks(located.node, located.path, bookmarks);
  const validBookmarks = bookmarks.filter((bookmark) => bookmark.url);
  const sourcesByOrigin = new Map();
  for (const bookmark of validBookmarks) {
    let source = sourcesByOrigin.get(bookmark.origin);
    if (!source) {
      source = {
        layer: "candidate",
        origin: bookmark.origin,
        host: bookmark.host,
        title: bookmark.host,
        homeUrl: `${bookmark.origin}/`,
        bookmarkCount: 0,
        bookmarkIds: [],
        searchText: "",
      };
      sourcesByOrigin.set(bookmark.origin, source);
    }
    source.bookmarkCount += 1;
    source.bookmarkIds.push(bookmark.id);
    source.searchText += ` ${bookmark.title} ${bookmark.url} ${bookmark.folderPath}`;
    if (isOriginHomepage(bookmark.url)) {
      source.homeUrl = bookmark.url;
      source.title = bookmark.title || source.title;
    }
  }
  const sources = [...sourcesByOrigin.values()].map((source) => ({
    ...source,
    bookmarkIds: uniqueStrings(source.bookmarkIds),
    searchText: cleanText(source.searchText),
  }));
  return {
    id: requestedId,
    title: cleanText(located.node.title) || requestedId,
    path: located.path.join(" / ") || cleanText(located.node.title) || requestedId,
    bookmarkCount: validBookmarks.length,
    siteCount: sources.length,
    bookmarks: validBookmarks,
    sources,
  };
}

export function researchFolderOriginIndex(tree) {
  const index = new Map();
  for (const root of treeRoots(tree)) collectFolderOrigins(root, index);
  return index;
}

export function detectResearchTimeIntent(query, nowValue = Date.now()) {
  const queryText = cleanText(query);
  const now = finiteDate(nowValue);
  const endAt = endOfDay(now);
  const explicitIsoRange = queryText.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\s*(?:到|至|—|–|-|to|through)\s*(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/i);
  if (explicitIsoRange) {
    const start = safeCalendarDate(explicitIsoRange[1], explicitIsoRange[2], explicitIsoRange[3]);
    const end = safeCalendarDate(explicitIsoRange[4], explicitIsoRange[5], explicitIsoRange[6], true);
    if (start && end && start <= end) return explicitTimeIntent("absolute", start, end);
  }
  const chineseMonthRange = queryText.match(/\b(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(?:到|至|—|–|-)\s*(?:(20\d{2})\s*年\s*)?(\d{1,2})\s*月/);
  if (chineseMonthRange) {
    const startYear = Number(chineseMonthRange[1]);
    const endYear = Number(chineseMonthRange[3] || startYear);
    const start = safeCalendarDate(startYear, chineseMonthRange[2], 1);
    const end = endOfMonth(endYear, Number(chineseMonthRange[4]));
    if (start && end && start <= end) return explicitTimeIntent("absolute", start, end);
  }
  const chineseMonth = queryText.match(/\b(20\d{2})\s*年\s*(\d{1,2})\s*月/);
  if (chineseMonth) {
    const start = safeCalendarDate(chineseMonth[1], chineseMonth[2], 1);
    const end = endOfMonth(Number(chineseMonth[1]), Number(chineseMonth[2]));
    if (start && end) return explicitTimeIntent("absolute", start, end);
  }
  if (/(?:近|过去|過去)\s*(?:1|一|一个|一個)?\s*(?:个|個)?月|\b(?:past|last)\s+(?:one\s+)?month\b/i.test(queryText)) {
    return explicitTimeIntent("relative-month", startOfDay(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)), endAt);
  }
  const explicitYear = queryText.match(/\b(20\d{2})\s*年\b/);
  if (explicitYear) {
    const year = Number(explicitYear[1]);
    return explicitTimeIntent("year", new Date(Date.UTC(year, 0, 1)), new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999)));
  }
  if (/(?:今年|本年|\bthis\s+year\b)/i.test(queryText)) {
    const year = now.getUTCFullYear();
    return explicitTimeIntent("year", new Date(Date.UTC(year, 0, 1)), endAt);
  }
  if (/(?:最新|最近|近期|近况|近況|\blatest\b|\brecent(?:ly)?\b|\bnewest\b)/i.test(queryText)) {
    return {
      kind: "recent",
      explicit: false,
      startAt: "",
      endAt: "",
    };
  }
  return {
    kind: "default",
    explicit: false,
    startAt: "",
    endAt: "",
  };
}

export function filterEvidenceByTimeIntent(input, intent) {
  const evidence = Array.isArray(input) ? input : [];
  if (!intent?.explicit || !intent.startAt || !intent.endAt) {
    return evidence.map((item) => ({ ...item, timeScopeMatched: true }));
  }
  const start = Date.parse(intent.startAt);
  const end = Date.parse(intent.endAt);
  return evidence.flatMap((item) => {
    const published = Date.parse(String(item?.publishedAt || ""));
    if (!Number.isFinite(published)) return [{ ...item, timeVerified: false, timeScopeMatched: false }];
    if (published < start || published > end) return [];
    return [{ ...item, timeVerified: true, timeScopeMatched: true }];
  });
}

export function scoreResearchEvidence(item, query, nowValue = Date.now(), corroboration = 0) {
  const terms = searchQueryTerms(query);
  const title = cleanText(item?.title).toLowerCase();
  const snippet = cleanText(item?.snippet || item?.excerpt).toLowerCase();
  const host = cleanText(item?.host).toLowerCase();
  const searchable = `${title} ${snippet} ${host}`;
  const relevance = terms.reduce((score, term) => score
    + (title.includes(term) ? 12 : 0)
    + (snippet.includes(term) ? 5 : 0)
    + (host.includes(term) ? 2 : 0), 0);
  const published = Date.parse(String(item?.publishedAt || ""));
  const ageDays = Number.isFinite(published)
    ? Math.max(0, (Number(nowValue) - published) / (24 * 60 * 60 * 1000))
    : Number.POSITIVE_INFINITY;
  const freshness = Number.isFinite(ageDays) ? Math.max(0, 24 - Math.log2(ageDays + 1) * 4) : 0;
  const body = `${title} ${snippet}`;
  const materialChange = MATERIAL_CHANGE.test(body) ? 9 : 0;
  const publicImpact = PUBLIC_IMPACT.test(body) ? 7 : 0;
  const completeness = Math.min(12,
    (title.length >= 8 ? 3 : 0)
    + (snippet.length >= 40 ? 4 : (snippet.length ? 2 : 0))
    + (Number.isFinite(published) ? 3 : 0)
    + (item?.readLevel === "full" ? 2 : 0));
  const sourceQuality = item?.sourceKind === "bookmark" ? 4 : (item?.sourceKind === "ampira" ? 3 : 2);
  const passageRelevance = Math.min(40, Math.max(0, Number(item?.retrievalScore) || 0) * 0.02);
  return relevance + freshness + materialChange + publicImpact + completeness + sourceQuality
    + passageRelevance + Math.min(10, Number(corroboration) || 0);
}

export function mergeResearchEvidence(input, query, options = {}) {
  const now = Number(options.now ?? Date.now());
  const limit = Math.max(1, Math.min(RESEARCH_EVIDENCE_LIMIT, Number(options.limit) || RESEARCH_EVIDENCE_LIMIT));
  const byPassage = new Map();
  for (const raw of Array.isArray(input) ? input : []) {
    const item = normalizeEvidence(raw);
    if (!item) continue;
    const identity = evidenceIdentity(item);
    const existing = byPassage.get(identity);
    byPassage.set(identity, existing ? mergeDuplicateEvidence(existing, item) : item);
  }
  const rawCandidates = [...byPassage.values()];
  const provenanceByUrl = new Map();
  for (const item of rawCandidates) {
    provenanceByUrl.set(item.normalizedUrl, uniqueStrings([
      ...(provenanceByUrl.get(item.normalizedUrl) || []),
      ...item.sourceKinds,
    ]).sort((left, right) => (SOURCE_KIND_PRIORITY[right] || 0) - (SOURCE_KIND_PRIORITY[left] || 0)));
  }
  const candidates = rawCandidates.map((item) => ({
    ...item,
    sourceKinds: provenanceByUrl.get(item.normalizedUrl) || item.sourceKinds,
  }));
  const corroboration = corroborationScores(candidates);
  const ranked = candidates
    .map((item) => ({
      ...item,
      score: scoreResearchEvidence(item, query, now, corroboration.get(evidenceSignature(item)) || 0),
    }))
    .sort((left, right) => right.score - left.score
      || verifiedTime(right.publishedAt) - verifiedTime(left.publishedAt)
      || left.title.localeCompare(right.title, undefined, { numeric: true, sensitivity: "base" }))
  const perDocument = new Map();
  return ranked
    .flatMap((item) => {
      const documentId = item.documentId || item.normalizedUrl;
      const count = perDocument.get(documentId) || 0;
      if (count >= 2) return [];
      perDocument.set(documentId, count + 1);
      return [item];
    })
    .slice(0, limit)
    .map((item, index) => ({
      ...item,
      id: `S${index + 1}`,
    }));
}

export function buildResearchCoverage(input = {}) {
  const evidence = Array.isArray(input.evidence) ? input.evidence : [];
  const published = evidence.map((item) => verifiedTime(item.publishedAt)).filter(Boolean).sort((a, b) => a - b);
  return {
    folderSourcesTotal: nonNegativeInteger(input.folderSourcesTotal),
    folderSourcesSearched: nonNegativeInteger(input.folderSourcesSearched),
    folderSourcesAuthorized: nonNegativeInteger(input.folderSourcesAuthorized),
    folderSourcesFailed: nonNegativeInteger(input.folderSourcesFailed),
    webResults: nonNegativeInteger(input.webResults),
    fullTextsRead: nonNegativeInteger(input.fullTextsRead),
    evidenceCount: evidence.length,
    timeUnknownCount: evidence.filter((item) => !verifiedTime(item.publishedAt)).length,
    oldestPublishedAt: published.length ? new Date(published[0]).toISOString() : "",
    newestPublishedAt: published.length ? new Date(published[published.length - 1]).toISOString() : "",
    expandedBeyondRecent: input.expandedBeyondRecent === true,
  };
}

export function validateResearchCitations(answer, evidence) {
  const allowed = new Set((Array.isArray(evidence) ? evidence : []).map((item) => cleanText(item?.id)).filter(Boolean));
  const text = String(answer || "");
  const citedIds = uniqueStrings([...text.matchAll(/\[(S\d+)\]/gi)].map((match) => match[1].toUpperCase()));
  const invalidIds = citedIds.filter((id) => !allowed.has(id));
  const bareIds = uniqueStrings([...text.replace(/\[S\d+\]/gi, "").matchAll(/\bS\d+\b/gi)]
    .map((match) => match[0].toUpperCase()).filter((id) => allowed.has(id)));
  const missing = allowed.size > 0 && citedIds.length === 0;
  return {
    valid: invalidIds.length === 0 && bareIds.length === 0 && !missing,
    citedIds,
    invalidIds,
    bareIds,
    missing,
  };
}

export function buildDeterministicResearchAnswer(evidence, locale = "zh-CN", notices = []) {
  const items = Array.isArray(evidence) ? evidence.slice(0, 8) : [];
  const copy = deterministicCopy(locale);
  const lines = [];
  if (items.length) {
    lines.push(copy.found.replace("{count}", String(items.length)));
    for (const item of items) {
      const detail = cleanText(item.snippet);
      lines.push(`${item.title} [${item.id}]${detail ? ` — ${detail}` : ""}`);
    }
  } else {
    lines.push(copy.empty);
  }
  for (const notice of uniqueStrings(notices)) lines.push(notice);
  return lines.join("\n\n");
}

function sanitizeResearchCacheEntry(value, nowValue = Date.now()) {
  const item = normalizeEvidence(value);
  if (!item || item.evidenceLayer !== "passage" || item.readLevel === "bookmark" || item.snippet.length < 40) return null;
  const fetchedAt = validIso(value?.fetchedAt) || new Date(Number(nowValue) || Date.now()).toISOString();
  return {
    evidenceLayer: "passage",
    documentId: item.documentId,
    passageId: item.passageId,
    title: item.title.slice(0, 500),
    url: item.url,
    host: item.host,
    snippet: item.snippet.slice(0, 1600),
    contextBefore: item.contextBefore.slice(0, 240),
    contextAfter: item.contextAfter.slice(0, 240),
    publishedAt: item.publishedAt,
    timeVerified: item.timeVerified,
    sourceKind: item.sourceKind === "ampira" ? "ampira" : "bookmark",
    readLevel: item.readLevel === "feed" ? "feed" : "snippet",
    origin: safeOrigin(value?.origin || item.url),
    folderIds: uniqueStrings(value?.folderIds).slice(0, 24),
    fetchedAt,
  };
}

export function pruneResearchCacheEntries(input, options = {}) {
  const now = Number(options.now ?? Date.now());
  const maxEntries = Math.max(1, Number(options.maxEntries) || RESEARCH_CACHE_ENTRY_LIMIT);
  const maxBytes = Math.max(1024, Number(options.maxBytes) || RESEARCH_CACHE_BYTE_LIMIT);
  const retentionMs = Math.max(1, Number(options.retentionMs) || RESEARCH_CACHE_RETENTION_MS);
  const seen = new Set();
  const candidates = (Array.isArray(input) ? input : [])
    .map((item) => sanitizeResearchCacheEntry(item, now))
    .filter(Boolean)
    .filter((item) => {
      const fetched = Date.parse(item.fetchedAt);
      return Number.isFinite(fetched) && fetched >= now - retentionMs;
    })
    .sort((left, right) => Date.parse(right.fetchedAt) - Date.parse(left.fetchedAt))
    .filter((item) => {
      const identity = `${item.passageId || item.url}\u0000${item.folderIds.join(",")}`;
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    });
  const output = [];
  let size = 2;
  for (const item of candidates) {
    if (output.length >= maxEntries) break;
    const itemSize = byteLength(JSON.stringify(item)) + (output.length ? 1 : 0);
    if (size + itemSize > maxBytes) continue;
    output.push(item);
    size += itemSize;
  }
  return output;
}

export function normalizeEvidenceUrl(value) {
  try {
    const url = new URL(cleanText(value));
    const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname.toLowerCase());
    if (url.protocol !== "https:" && !localHttp) return "";
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key.toLowerCase()) || key.toLowerCase().startsWith("utm_")) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.href;
  } catch {
    return "";
  }
}

function collectFolderSummary(node, parentPath, output, syntheticRoot = false) {
  if (!node || node.url) return [];
  const title = cleanText(node.title);
  const path = syntheticRoot && !title ? parentPath : [...parentPath, title].filter(Boolean);
  const bookmarks = [];
  for (const child of Array.isArray(node.children) ? node.children : []) {
    if (child?.url) {
      const url = normalizeEvidenceUrl(child.url);
      if (url) bookmarks.push({ url, origin: safeOrigin(url) });
      continue;
    }
    bookmarks.push(...collectFolderSummary(child, path, output, false));
  }
  if (!syntheticRoot && title && bookmarks.length) {
    output.push({
      id: cleanText(node.id),
      path: path.join(" / "),
      title,
      bookmarkCount: bookmarks.length,
      siteCount: new Set(bookmarks.map((bookmark) => bookmark.origin).filter(Boolean)).size,
    });
  }
  return bookmarks;
}

function collectFolderOrigins(node, index) {
  if (!node || node.url) return new Set();
  const origins = new Set();
  for (const child of Array.isArray(node.children) ? node.children : []) {
    if (child?.url) {
      const url = normalizeEvidenceUrl(child.url);
      const origin = safeOrigin(url);
      if (origin) origins.add(origin);
      continue;
    }
    for (const origin of collectFolderOrigins(child, index)) origins.add(origin);
  }
  const id = cleanText(node.id);
  if (id) index.set(id, origins);
  return origins;
}

function findFolder(tree, folderId) {
  const pending = treeRoots(tree).map((node) => ({ node, path: cleanText(node?.title) ? [cleanText(node.title)] : [] }));
  while (pending.length) {
    const entry = pending.shift();
    if (!entry.node?.url && cleanText(entry.node?.id) === folderId) return entry;
    for (const child of Array.isArray(entry.node?.children) ? entry.node.children : []) {
      if (child?.url) continue;
      const title = cleanText(child.title);
      pending.push({ node: child, path: [...entry.path, title].filter(Boolean) });
    }
  }
  return null;
}

function collectFolderBookmarks(folder, parentPath, output) {
  for (const child of Array.isArray(folder?.children) ? folder.children : []) {
    if (child?.url) {
      const url = normalizeEvidenceUrl(child.url);
      if (!url) continue;
      const origin = safeOrigin(url);
      output.push({
        layer: "candidate",
        id: cleanText(child.id),
        title: cleanText(child.title) || hostOf(url) || url,
        url,
        origin,
        host: hostOf(url),
        folderPath: parentPath.join(" / "),
        dateAdded: Number(child.dateAdded || 0),
      });
      continue;
    }
    collectFolderBookmarks(child, [...parentPath, cleanText(child?.title)].filter(Boolean), output);
  }
}

function explicitTimeIntent(kind, start, end) {
  const startAt = start.toISOString();
  const endAt = end.toISOString();
  return {
    kind,
    explicit: true,
    startAt,
    endAt,
  };
}

function normalizeEvidence(value) {
  if (!value || typeof value !== "object") return null;
  const url = normalizeEvidenceUrl(value.url);
  if (!url) return null;
  const title = cleanText(value.title) || hostOf(url) || url;
  const publishedAt = validIso(value.publishedAt);
  const sourceKind = ["ampira", "bookmark", "web"].includes(value.sourceKind) ? value.sourceKind : "web";
  const readLevel = ["full", "feed", "snippet", "bookmark"].includes(value.readLevel) ? value.readLevel : "snippet";
  return {
    evidenceLayer: value.evidenceLayer === "passage" ? "passage" : "source",
    documentId: cleanText(value.documentId).slice(0, 80),
    passageId: cleanText(value.passageId).slice(0, 80),
    title,
    url,
    normalizedUrl: url,
    host: cleanText(value.host) || hostOf(url),
    snippet: cleanText(value.snippet || value.excerpt),
    contextBefore: cleanText(value.contextBefore).slice(0, 240),
    contextAfter: cleanText(value.contextAfter).slice(0, 240),
    publishedAt,
    timeVerified: Boolean(publishedAt && value.timeVerified !== false),
    sourceKind,
    sourceKinds: uniqueStrings([...(Array.isArray(value.sourceKinds) ? value.sourceKinds : []), sourceKind])
      .filter((kind) => ["ampira", "bookmark", "web"].includes(kind)),
    readLevel,
    fetchedAt: validIso(value.fetchedAt),
    origin: safeOrigin(value.origin || url),
    folderIds: uniqueStrings(value.folderIds),
    timeScopeMatched: value.timeScopeMatched !== false,
    retrievalScore: Math.max(0, Number(value.retrievalScore) || 0),
  };
}

function evidenceIdentity(item) {
  return item.passageId ? `${item.normalizedUrl}\u0000${item.passageId}` : item.normalizedUrl;
}

function mergeDuplicateEvidence(left, right) {
  const preferred = evidenceQuality(right) > evidenceQuality(left) ? right : left;
  const alternate = preferred === right ? left : right;
  const sourceKinds = uniqueStrings([...left.sourceKinds, ...right.sourceKinds])
    .sort((a, b) => (SOURCE_KIND_PRIORITY[b] || 0) - (SOURCE_KIND_PRIORITY[a] || 0));
  return {
    ...preferred,
    title: preferred.title.length >= alternate.title.length ? preferred.title : alternate.title,
    snippet: preferred.snippet.length >= alternate.snippet.length ? preferred.snippet : alternate.snippet,
    publishedAt: preferred.publishedAt || alternate.publishedAt,
    timeVerified: preferred.timeVerified || alternate.timeVerified,
    sourceKind: sourceKinds[0] || preferred.sourceKind,
    sourceKinds,
    folderIds: uniqueStrings([...left.folderIds, ...right.folderIds]),
    fetchedAt: latestIso(left.fetchedAt, right.fetchedAt),
  };
}

function evidenceQuality(item) {
  return (READ_LEVEL_PRIORITY[item.readLevel] || 0) * 100
    + (SOURCE_KIND_PRIORITY[item.sourceKind] || 0) * 10
    + Math.min(9, Math.floor(item.snippet.length / 160));
}

function corroborationScores(items) {
  const hostsBySignature = new Map();
  for (const item of items) {
    const signature = evidenceSignature(item);
    if (!signature) continue;
    const hosts = hostsBySignature.get(signature) || new Set();
    hosts.add(item.host);
    hostsBySignature.set(signature, hosts);
  }
  return new Map([...hostsBySignature].map(([signature, hosts]) => [signature, Math.max(0, hosts.size - 1) * 4]));
}

function evidenceSignature(item) {
  const terms = searchQueryTerms(item?.title).filter((term) => !/^\d+$/.test(term)).slice(0, 8).sort();
  return terms.join("|");
}

function deterministicCopy(locale) {
  if (locale === "zh-Hant") return {
    found: "找到 {count} 條可核對的研究依據。以下先按相關性與時效排列：",
    empty: "這一輪沒有找到可核對的依據；請檢查所選收藏夾、網站權限或聯網搜尋設定。",
  };
  if (locale === "zh-CN") return {
    found: "找到 {count} 条可核对的研究依据。以下先按相关性与时效排列：",
    empty: "这一轮没有找到可核对的依据；请检查所选收藏夹、网站权限或联网搜索设置。",
  };
  return {
    found: "Found {count} verifiable research sources, ordered by relevance and recency:",
    empty: "No verifiable evidence was found in this run. Check the selected folder, website access, or web-search setup.",
  };
}

function treeRoots(tree) {
  if (Array.isArray(tree)) return tree.filter(Boolean);
  return tree ? [tree] : [];
}

function finiteDate(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : new Date();
}

function startOfDay(value) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function endOfDay(value) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), 23, 59, 59, 999));
}

function endOfMonth(year, month) {
  if (!Number.isInteger(year) || month < 1 || month > 12) return null;
  return new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
}

function safeCalendarDate(yearValue, monthValue, dayValue, end = false) {
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day, end ? 23 : 0, end ? 59 : 0, end ? 59 : 0, end ? 999 : 0));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
}

function validIso(value) {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? new Date(time).toISOString() : "";
}

function verifiedTime(value) {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? time : 0;
}

function latestIso(left, right) {
  return verifiedTime(left) >= verifiedTime(right) ? validIso(left) : validIso(right);
}

function isOriginHomepage(value) {
  try {
    const url = new URL(value);
    return (url.pathname === "/" || !url.pathname) && !url.search && !url.hash;
  } catch {
    return false;
  }
}

function safeOrigin(value) {
  try {
    return new URL(normalizeEvidenceUrl(value)).origin;
  } catch {
    return "";
  }
}

function hostOf(value) {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(cleanText).filter(Boolean))];
}

function nonNegativeInteger(value) {
  const number = Math.floor(Number(value) || 0);
  return Math.max(0, number);
}

function byteLength(value) {
  return new TextEncoder().encode(String(value || "")).byteLength;
}

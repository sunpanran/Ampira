import { normalizeEvidenceUrl, scoreResearchEvidence } from "./research-search.mjs";

const DEFAULT_CHUNK_CHARS = 680;
const DEFAULT_OVERLAP_CHARS = 120;
const MAX_DOCUMENT_CHARS = 24000;
const MIN_PASSAGE_CHARS = 40;
const MAX_PASSAGES_PER_DOCUMENT = 24;

export function createResearchDocument(value = {}) {
  const url = normalizeEvidenceUrl(value.url);
  const content = cleanDocumentText(value.content || value.text || value.snippet || value.excerpt)
    .slice(0, MAX_DOCUMENT_CHARS);
  if (!url || content.length < MIN_PASSAGE_CHARS) return null;
  const sourceKind = ["ampira", "bookmark", "web"].includes(value.sourceKind) ? value.sourceKind : "bookmark";
  const readLevel = ["full", "feed", "snippet"].includes(value.readLevel) ? value.readLevel : "snippet";
  return {
    layer: "document",
    documentId: `D${stableHash(url)}`,
    title: cleanText(value.title) || hostFromUrl(url) || url,
    url,
    host: cleanText(value.host) || hostFromUrl(url),
    content,
    publishedAt: validIso(value.publishedAt),
    timeVerified: Boolean(validIso(value.publishedAt) && value.timeVerified !== false),
    sourceKind,
    readLevel,
    origin: safeOrigin(value.origin || url),
    folderIds: uniqueStrings(value.folderIds).slice(0, 24),
    fetchedAt: validIso(value.fetchedAt),
  };
}

export function segmentResearchDocument(value, options = {}) {
  const document = value?.layer === "document" ? value : createResearchDocument(value);
  if (!document) return [];
  const chunkChars = clamp(options.chunkChars, 240, 1200, DEFAULT_CHUNK_CHARS);
  const overlapChars = clamp(options.overlapChars, 0, Math.floor(chunkChars / 2), DEFAULT_OVERLAP_CHARS);
  const maxPassages = clamp(options.maxPassages, 1, MAX_PASSAGES_PER_DOCUMENT, MAX_PASSAGES_PER_DOCUMENT);
  const ranges = passageRanges(document.content, chunkChars, overlapChars).slice(0, maxPassages);
  return ranges.flatMap(({ start, end }) => {
    const snippet = cleanText(document.content.slice(start, end));
    if (snippet.length < MIN_PASSAGE_CHARS) return [];
    return [{
      layer: "passage",
      evidenceLayer: "passage",
      documentId: document.documentId,
      passageId: `P${stableHash(`${document.url}\u0000${start}\u0000${snippet}`)}`,
      title: document.title,
      url: document.url,
      host: document.host,
      snippet,
      contextBefore: cleanText(document.content.slice(Math.max(0, start - overlapChars), start)),
      contextAfter: cleanText(document.content.slice(end, Math.min(document.content.length, end + overlapChars))),
      passageStart: start,
      passageEnd: end,
      publishedAt: document.publishedAt,
      timeVerified: document.timeVerified,
      sourceKind: document.sourceKind,
      readLevel: document.readLevel,
      origin: document.origin,
      folderIds: document.folderIds,
      fetchedAt: document.fetchedAt,
    }];
  });
}

export function retrieveResearchPassages(input, plan, options = {}) {
  const now = Number(options.now ?? Date.now());
  const limit = clamp(options.limit, 1, 12, 12);
  const passages = dedupePassages(Array.isArray(input) ? input : []);
  const query = cleanText(plan?.standaloneQuery);
  const lexical = passages
    .map((item) => ({ item, score: passageLexicalScore(item, query, now) }))
    .sort(rankRows);
  const freshness = passages
    .map((item) => ({ item, score: passageFreshnessScore(item) }))
    .sort(rankRows);
  const aggregate = new Map();
  addReciprocalRanks(aggregate, lexical, 1);
  addReciprocalRanks(aggregate, freshness, plan?.freshnessIntent === "default" ? 0.28 : 0.72);
  const perDocument = new Map();
  return [...aggregate.values()]
    .sort((left, right) => right.rrfScore - left.rrfScore
      || right.lexicalScore - left.lexicalScore
      || left.item.title.localeCompare(right.item.title, undefined, { numeric: true, sensitivity: "base" }))
    .flatMap((row) => {
      const documentId = row.item.documentId || row.item.url;
      const count = perDocument.get(documentId) || 0;
      if (count >= 2) return [];
      perDocument.set(documentId, count + 1);
      return [{ ...row.item, retrievalScore: row.rrfScore * 1000 + row.lexicalScore }];
    })
    .slice(0, limit);
}

export function passageCacheEntry(value, nowValue = Date.now()) {
  const url = normalizeEvidenceUrl(value?.url);
  const snippet = cleanText(value?.snippet).slice(0, 1600);
  if (!url || snippet.length < MIN_PASSAGE_CHARS || value?.evidenceLayer !== "passage") return null;
  return {
    evidenceLayer: "passage",
    documentId: cleanText(value.documentId).slice(0, 80) || `D${stableHash(url)}`,
    passageId: cleanText(value.passageId).slice(0, 80) || `P${stableHash(`${url}\u0000${snippet}`)}`,
    title: cleanText(value.title).slice(0, 500) || hostFromUrl(url) || url,
    url,
    host: cleanText(value.host).slice(0, 255) || hostFromUrl(url),
    snippet,
    contextBefore: cleanText(value.contextBefore).slice(0, 240),
    contextAfter: cleanText(value.contextAfter).slice(0, 240),
    publishedAt: validIso(value.publishedAt),
    timeVerified: Boolean(validIso(value.publishedAt) && value.timeVerified !== false),
    sourceKind: ["ampira", "bookmark", "web"].includes(value.sourceKind) ? value.sourceKind : "bookmark",
    readLevel: ["full", "feed", "snippet"].includes(value.readLevel) ? value.readLevel : "snippet",
    origin: safeOrigin(value.origin || url),
    folderIds: uniqueStrings(value.folderIds).slice(0, 24),
    fetchedAt: validIso(value.fetchedAt) || new Date(Number(nowValue) || Date.now()).toISOString(),
  };
}

function passageLexicalScore(item, query, now) {
  const base = scoreResearchEvidence(item, query, now);
  const terms = queryTerms(query);
  const snippet = cleanText(item?.snippet).toLowerCase();
  const exactMatches = terms.filter((term) => snippet.includes(term)).length;
  const density = snippet.length ? exactMatches / Math.max(1, terms.length) : 0;
  return base + density * 30 + Math.min(8, snippet.length / 100) + Number(item?.retrievalScore || 0) * 0.001;
}

function passageFreshnessScore(item) {
  const published = Date.parse(String(item?.publishedAt || ""));
  return Number.isFinite(published) ? published : 0;
}

function addReciprocalRanks(target, rows, weight) {
  rows.forEach((row, index) => {
    const key = passageIdentity(row.item);
    const current = target.get(key) || { item: row.item, rrfScore: 0, lexicalScore: 0 };
    current.rrfScore += weight / (60 + index + 1);
    current.lexicalScore = Math.max(current.lexicalScore, row.score);
    target.set(key, current);
  });
}

function passageRanges(text, chunkChars, overlapChars) {
  const boundaries = sentenceBoundaries(text);
  const ranges = [];
  let start = 0;
  while (start < text.length) {
    const target = Math.min(text.length, start + chunkChars);
    let end = boundaries.find((value) => value >= target) || text.length;
    if (end - start > chunkChars * 1.5) end = target;
    ranges.push({ start, end });
    if (end >= text.length) break;
    const overlapTarget = Math.max(start + 1, end - overlapChars);
    start = [...boundaries].reverse().find((value) => value <= overlapTarget && value > start) || overlapTarget;
  }
  return ranges;
}

function sentenceBoundaries(text) {
  const output = [0];
  const pattern = /(?:[。！？!?；;]\s*|\n+)/g;
  for (const match of text.matchAll(pattern)) output.push(match.index + match[0].length);
  if (output.at(-1) !== text.length) output.push(text.length);
  return output;
}

function dedupePassages(values) {
  const output = new Map();
  for (const raw of values) {
    const item = raw?.evidenceLayer === "passage" ? passageCacheEntry(raw, Date.now()) : null;
    if (!item) continue;
    const key = passageIdentity(item);
    const current = output.get(key);
    if (!current || item.snippet.length > current.snippet.length) output.set(key, item);
  }
  return [...output.values()];
}

function passageIdentity(item) {
  return cleanText(item?.passageId) || `${normalizeEvidenceUrl(item?.url)}\u0000${cleanText(item?.snippet)}`;
}

function rankRows(left, right) {
  return right.score - left.score || left.item.title.localeCompare(right.item.title, undefined, { sensitivity: "base" });
}

function queryTerms(value) {
  return [...new Set(cleanText(value).toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [])].slice(0, 32);
}

function cleanDocumentText(value) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stableHash(value) {
  let hash = 2166136261;
  for (const char of String(value || "")) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function clamp(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, Math.floor(number))) : fallback;
}

function validIso(value) {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? new Date(time).toISOString() : "";
}

function safeOrigin(value) {
  try { return new URL(normalizeEvidenceUrl(value)).origin; } catch { return ""; }
}

function hostFromUrl(value) {
  try { return new URL(normalizeEvidenceUrl(value)).hostname.replace(/^www\./, ""); } catch { return ""; }
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(cleanText).filter(Boolean))];
}

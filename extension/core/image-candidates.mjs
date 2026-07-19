import { findAll, findFirst, parseHtml, walkElements } from "./reader-html-tree.mjs";
import { isPrivateAddressLiteral } from "./network-policy.mjs";

export const IMAGE_CANDIDATE_POLICY_VERSION = 3;
export const IMAGE_PROFILE_ARTICLE = "article";
export const IMAGE_PROFILE_VISUAL = "visual";

const MAX_IMAGE_URL_LENGTH = 8192;
const LOW_VALUE_IMAGE_PATTERN = /(?:^|[^a-z0-9])(?:app[-_ ]?download|arrow|avatar|badge|blank|caret|chevron|download[-_ ]?app|emoji|icon|loading|logo|logotype|partner|pixel|placeholder|qr(?:[-_ ]?code)?|social[-_ ]?share|spacer|spinner|sponsor|sprite|tracker|transparent)(?:$|[^a-z0-9])/i;
const VIDEO_URL_PATTERN = /\.(?:m3u8|mp4|m4v|mov|webm|avi)(?:[?#]|$)/i;
const HERO_PATTERN = /(?:^|[\s_-])(?:article|content|cover|featured|hero|lead|main|masthead|og[-_]?image|post|story)(?:[-_\s]*(?:cover|image|masthead|media|photo|visual))?(?=$|[\s_-])/i;
const POSITIVE_PATTERN = /(?:^|[\s_-])(?:article|body|content|entry|main|post|story|text)(?:$|[\s_-])/i;
const NEGATIVE_CONTEXT_PATTERN = /(?:^|[\s_-])(?:ad|ads|advert|breadcrumb|comment|consent|cookie|download|footer|login|menu|modal|nav|newsletter|partner|promo|qrcode|recommend|related|share|sidebar|social|sponsor|subscribe|toolbar)(?:$|[\s_-])/i;
const EXCLUDED_CONTEXT_TAGS = new Set(["nav", "footer", "aside", "form", "button", "select", "textarea", "dialog"]);
const ARTICLE_CANDIDATE_TAGS = new Set(["article", "main", "section", "div"]);
const ARTICLE_STRUCTURED_TYPES = new Set(["article", "newsarticle", "blogposting"]);
const NON_VISUAL_STRUCTURED_TYPES = new Set(["organization", "person"]);
const NON_VISUAL_STRUCTURED_KEYS = new Set(["author", "creator", "provider", "publisher", "sponsor"]);

const LAZY_IMAGE_ATTRIBUTES = [
  "data-original", "data-original-src", "data-src", "data-lazy-src", "data-lazy",
  "data-image", "data-zoom-image", "data-flickity-lazyload", "data-cfsrc",
];

const PROFILE_DIMENSIONS = Object.freeze({
  article: Object.freeze({ shortEdge: 120, longEdge: 320, area: 70000 }),
  visual: Object.freeze({ shortEdge: 100, longEdge: 240, area: 40000 }),
});

export function normalizeImageProfile(value) {
  return value === IMAGE_PROFILE_ARTICLE ? IMAGE_PROFILE_ARTICLE : IMAGE_PROFILE_VISUAL;
}

export function imageMeetsProfileDimensions(width, height, profile = IMAGE_PROFILE_VISUAL) {
  const normalizedProfile = normalizeImageProfile(profile);
  const minimum = PROFILE_DIMENSIONS[normalizedProfile];
  const normalizedWidth = imageDimension(width);
  const normalizedHeight = imageDimension(height);
  if (normalizedWidth && normalizedWidth < minimum.shortEdge) return false;
  if (normalizedHeight && normalizedHeight < minimum.shortEdge) return false;
  if (!normalizedWidth || !normalizedHeight) return true;
  return Math.max(normalizedWidth, normalizedHeight) >= minimum.longEdge
    && normalizedWidth * normalizedHeight >= minimum.area;
}

export function normalizeImageCandidateRecords(input, baseUrl, {
  limit = 3,
  profile = IMAGE_PROFILE_VISUAL,
} = {}) {
  const normalizedProfile = normalizeImageProfile(profile);
  const candidates = (Array.isArray(input) ? input : [input])
    .map((value, index) => normalizeCandidateRecord(value, baseUrl, index, normalizedProfile))
    .filter(Boolean)
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const seen = new Set();
  const records = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.url)) continue;
    seen.add(candidate.url);
    records.push(candidate);
    if (records.length >= Math.max(1, Math.floor(Number(limit) || 1))) break;
  }
  return records;
}

export function normalizeImageCandidates(input, baseUrl, options = {}) {
  return normalizeImageCandidateRecords(input, baseUrl, options).map((candidate) => candidate.url);
}

export function extractPageImageCandidateRecords(html, baseUrl, {
  limit = 3,
  profile = IMAGE_PROFILE_VISUAL,
} = {}) {
  const normalizedProfile = normalizeImageProfile(profile);
  const source = String(html || "");
  const root = parseHtml(source);
  const candidates = [
    ...metadataImageCandidates(root, normalizedProfile),
    ...structuredImageCandidateRecords(source, normalizedProfile),
    ...structuralImageCandidates(root, normalizedProfile),
  ];
  return normalizeImageCandidateRecords(candidates, baseUrl, { limit, profile: normalizedProfile });
}

export function extractPageImageCandidates(html, baseUrl, options = {}) {
  return extractPageImageCandidateRecords(html, baseUrl, options).map((candidate) => candidate.url);
}

export function extractMarkupImageCandidates(markup, baseUrl, {
  limit = 3,
  normalized = true,
  profile = IMAGE_PROFILE_VISUAL,
} = {}) {
  const source = decodeEmbeddedMarkup(markup);
  const candidates = [];
  let index = 0;
  for (const match of source.matchAll(/<(?:img|source)\b[^>]*>/gi)) {
    const tag = match[0];
    const attrs = parseImageAttributes(tag);
    if (/^<source/i.test(tag) && attrs.type && !String(attrs.type).toLowerCase().startsWith("image/")) continue;
    const identity = `${attrs.id || ""} ${attrs.class || ""} ${attrs.alt || ""} ${attrs.title || ""}`;
    const width = imageDimension(attrs.width);
    const height = imageDimension(attrs.height);
    let score = Math.max(0, 30 - index * 0.01);
    if (/^<source/i.test(tag)) score += 130;
    if (String(attrs.itemprop || "").toLowerCase() === "image") score += 140;
    if (HERO_PATTERN.test(identity)) score += 120;
    if (String(attrs.fetchpriority || "").toLowerCase() === "high") score += 100;
    score += dimensionScore(width, height);
    imageAttributeCandidates(attrs).forEach((url, sourceIndex) => candidates.push({
      url,
      score: score - sourceIndex * 0.01,
      identity: `${identity} ${url}`,
      width,
      height,
      provenance: "embedded",
    }));
    index += 1;
  }

  for (const match of source.matchAll(/<([a-z0-9:-]+)\b[^>]*>/gi)) {
    const attrs = parseImageAttributes(match[0]);
    const identity = `${attrs.id || ""} ${attrs.class || ""}`;
    if (!HERO_PATTERN.test(identity)) continue;
    const background = backgroundImageCandidate(attrs);
    if (background) candidates.push({ url: background, score: 760, identity: `${identity} background`, provenance: "hero" });
  }
  if (!normalized) return candidates.slice(0, Math.max(1, Number(limit) || 1));
  return normalizeImageCandidates(candidates, baseUrl, { limit, profile });
}

export function imageAttributeCandidates(attrs = {}) {
  return [
    ...srcsetImageCandidates(attrs["data-srcset"]),
    ...srcsetImageCandidates(attrs.srcset),
    ...LAZY_IMAGE_ATTRIBUTES.map((name) => attrs[name]),
    attrs.src,
  ].map((value) => String(value || "").trim()).filter(Boolean);
}

export function parseImageAttributes(raw) {
  const attrs = {};
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  const source = String(raw || "").replace(/^<\/?[^\s>]+\s*/i, "").replace(/\/?\s*>$/, "");
  for (const match of source.matchAll(pattern)) {
    const name = String(match[1] || "").toLowerCase();
    if (!name || name.startsWith("on")) continue;
    attrs[name] = decodeImageEntities(firstNonEmpty(match[2], match[3], match[4], ""));
  }
  return attrs;
}

export function srcsetImageCandidates(value) {
  return String(value || "").split(",").map((entry, index) => {
    const match = entry.trim().match(/^(\S+)(?:\s+([\d.]+)(w|x))?$/i);
    if (!match) return null;
    const amount = Number(match[2] || 0);
    const score = match[3]?.toLowerCase() === "w" ? amount : amount * 1000;
    return { url: match[1], score, index };
  }).filter(Boolean).sort((left, right) => right.score - left.score || left.index - right.index).map((entry) => entry.url);
}

export function structuredImageCandidates(html, options = {}) {
  return structuredImageCandidateRecords(html, normalizeImageProfile(options.profile)).map((candidate) => candidate.url);
}

export function selectArticleCandidate(root) {
  const candidates = [];
  walkElements(root, (node) => {
    if (!ARTICLE_CANDIDATE_TAGS.has(node.tag) && node.attrs.role !== "main") return;
    if (isExcludedStructuralNode(node)) return;
    const metrics = contentMetrics(node);
    if (metrics.textLength < 120) return;
    const identity = nodeIdentity(node);
    if (["div", "section"].includes(node.tag) && metrics.paragraphs === 0 && !POSITIVE_PATTERN.test(identity)) return;
    const semanticBoost = node.tag === "article" ? 1600 : node.tag === "main" || node.attrs.role === "main" ? 1000 : 0;
    const positiveBoost = POSITIVE_PATTERN.test(identity) ? 600 : 0;
    const linkPenalty = metrics.linkLength * 1.8;
    const score = Math.min(metrics.textLength, 6000) + metrics.paragraphs * 160
      + metrics.headings * 40 + semanticBoost + positiveBoost - linkPenalty;
    candidates.push({ node, metrics, score });
  });
  candidates.sort((left, right) => right.score - left.score);
  if (candidates.length) {
    const selected = refineArticleCandidate(candidates[0], candidates);
    return { node: selected.node, fallback: selected.metrics.textLength < 500 };
  }
  const body = findFirst(root, (node) => node.tag === "body") || root;
  return { node: body, fallback: true };
}

function refineArticleCandidate(selected, candidates) {
  if (selected.metrics.textLength < 500) return selected;
  const minimumTextLength = selected.metrics.textLength * 0.55;
  const minimumParagraphs = selected.metrics.paragraphs * 0.5;
  return candidates
    .filter((candidate) => candidate !== selected
      && isWithin(candidate.node, selected.node)
      && candidate.metrics.textLength >= minimumTextLength
      && candidate.metrics.paragraphs >= minimumParagraphs
      && isPositiveArticleContainer(candidate.node))
    .sort((left, right) => nodeDepth(right.node) - nodeDepth(left.node)
      || left.metrics.textLength - right.metrics.textLength)[0] || selected;
}

function isPositiveArticleContainer(node) {
  return node.tag === "article"
    || node.tag === "main"
    || node.attrs.role === "main"
    || POSITIVE_PATTERN.test(nodeIdentity(node));
}

function nodeDepth(node) {
  let depth = 0;
  for (let current = node?.parent; current; current = current.parent) depth += 1;
  return depth;
}

function metadataImageCandidates(root, profile) {
  const meta = new Map();
  for (const node of findAll(root, (candidate) => candidate.tag === "meta")) {
    const key = String(node.attrs.property || node.attrs.name || node.attrs.itemprop || "").toLowerCase();
    const value = String(node.attrs.content || "").trim();
    if (key && value && !meta.has(key)) meta.set(key, value);
  }
  const width = imageDimension(meta.get("og:image:width"));
  const height = imageDimension(meta.get("og:image:height"));
  const candidates = [];
  for (const [key, score] of [
    ["og:image:secure_url", 1200], ["og:image:url", 1190], ["og:image", 1180],
    ["twitter:image", 1100], ["twitter:image:src", 1090],
    ["thumbnailurl", 1020], ["image", 1010],
  ]) {
    if (!meta.get(key)) continue;
    candidates.push({
      url: meta.get(key),
      score,
      identity: key,
      width: key.startsWith("og:image") ? width : 0,
      height: key.startsWith("og:image") ? height : 0,
      provenance: "metadata",
    });
  }
  for (const node of findAll(root, (candidate) => candidate.tag === "link")) {
    const rel = String(node.attrs.rel || "").toLowerCase().split(/\s+/);
    if (rel.includes("image_src") && node.attrs.href) {
      candidates.push({ url: node.attrs.href, score: 1000, identity: "image_src", provenance: "metadata" });
    }
    if (profile !== IMAGE_PROFILE_VISUAL || !rel.includes("preload") || String(node.attrs.as || "").toLowerCase() !== "image") continue;
    for (const url of srcsetImageCandidates(node.attrs.imagesrcset)) {
      candidates.push({ url, score: 930, identity: "preload", provenance: "preload" });
    }
    if (node.attrs.href) candidates.push({ url: node.attrs.href, score: 910, identity: "preload", provenance: "preload" });
  }
  return candidates;
}

function structuralImageCandidates(root, profile) {
  const selection = selectArticleCandidate(root);
  const main = findFirst(root, (node) => node.tag === "main" || node.attrs.role === "main");
  const selectedIsSpecific = selection.node && !["body", "#root"].includes(selection.node.tag);
  const candidates = [];
  let index = 0;
  for (const node of findAll(root, (candidate) => candidate.tag === "img")) {
    const urls = imageNodeCandidates(node);
    const identity = imageNodeIdentity(node);
    if (!urls.length || isDecorativeImageNode(node, identity, profile)) {
      index += 1;
      continue;
    }
    const insideArticle = selectedIsSpecific && isWithin(node, selection.node);
    const insideMain = main && isWithin(node, main);
    const positiveContext = hasAncestor(node, (ancestor) => POSITIVE_PATTERN.test(nodeIdentity(ancestor)));
    const hero = HERO_PATTERN.test(identity);
    const fetchHigh = String(node.attrs.fetchpriority || "").toLowerCase() === "high";
    let provenance = "";
    let score = 0;
    if (profile === IMAGE_PROFILE_ARTICLE) {
      if (insideArticle) {
        provenance = "article";
        score = 850;
      } else if (insideMain || !selectedIsSpecific && positiveContext) {
        provenance = "main";
        score = 570;
      } else {
        index += 1;
        continue;
      }
    } else if (hero || fetchHigh) {
      provenance = "hero";
      score = 820;
    } else if (insideMain || positiveContext) {
      provenance = "main";
      score = 620;
    } else {
      index += 1;
      continue;
    }
    const width = imageDimension(node.attrs.width);
    const height = imageDimension(node.attrs.height);
    if (String(node.attrs.itemprop || "").toLowerCase() === "image") score += 140;
    if (hero) score += 120;
    if (fetchHigh) score += 100;
    if (cleanText(node.attrs.alt).length >= 8) score += 8;
    score += dimensionScore(width, height);
    urls.forEach((url, sourceIndex) => candidates.push({
      url,
      score: score - index * 0.01 - sourceIndex * 0.001,
      identity,
      width,
      height,
      provenance,
    }));
    index += 1;
  }

  for (const node of findAll(root, (candidate) => candidate.tag !== "#text")) {
    const background = backgroundImageCandidate(node.attrs);
    if (!background) continue;
    const identity = imageNodeIdentity(node);
    if (isDecorativeImageNode(node, identity, profile)) continue;
    const insideArticle = selectedIsSpecific && isWithin(node, selection.node);
    const insideMain = main && isWithin(node, main);
    const hero = HERO_PATTERN.test(identity);
    if (profile === IMAGE_PROFILE_ARTICLE
      && !insideArticle
      && !insideMain
      && (selectedIsSpecific || !hasAncestor(node, (ancestor) => POSITIVE_PATTERN.test(nodeIdentity(ancestor))))) continue;
    if (profile === IMAGE_PROFILE_VISUAL && !hero && !insideMain) continue;
    candidates.push({
      url: background,
      score: profile === IMAGE_PROFILE_ARTICLE && insideArticle ? 830 : hero ? 800 : 580,
      identity: `${identity} background`,
      provenance: hero ? "hero" : insideArticle ? "article" : "main",
    });
  }
  return candidates;
}

function structuredImageCandidateRecords(html, profile) {
  const output = [];
  const seen = new Set();
  let remaining = 500;
  let consumed = 0;
  for (const match of String(html || "").matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const attrs = parseImageAttributes(match[1]);
    if (String(attrs.type || "").split(";", 1)[0].trim().toLowerCase() !== "application/ld+json") continue;
    const raw = String(match[2] || "").trim().replace(/^<!--\s*|\s*-->$/g, "");
    consumed += raw.length;
    if (!raw || consumed > 256 * 1024) break;
    try { visit(JSON.parse(raw), 0, false, false); } catch { /* Invalid JSON-LD is inert. */ }
  }
  return output;

  function visit(value, depth, articleContext, blockedContext) {
    if (remaining <= 0 || depth > 10 || value === null || value === undefined) return;
    remaining -= 1;
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, depth + 1, articleContext, blockedContext));
      return;
    }
    if (typeof value !== "object") return;
    const types = (Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]])
      .map((type) => String(type || "").toLowerCase());
    const excludedEntity = blockedContext || types.some((type) => NON_VISUAL_STRUCTURED_TYPES.has(type));
    const nextArticleContext = !excludedEntity
      && (articleContext || types.some((type) => ARTICLE_STRUCTURED_TYPES.has(type)));
    const visualContext = profile === IMAGE_PROFILE_VISUAL && !excludedEntity;
    if (nextArticleContext || visualContext) {
      for (const key of ["image", "thumbnailUrl", "primaryImageOfPage"]) collect(value[key], depth + 1, types);
      if (types.includes("imageobject")) collect(value, depth + 1, types);
    }
    for (const [key, item] of Object.entries(value)) {
      if (key === "logo") continue;
      visit(item, depth + 1, nextArticleContext, excludedEntity || NON_VISUAL_STRUCTURED_KEYS.has(key));
    }
  }

  function collect(value, depth, types) {
    if (typeof value === "string") return push(value, 0, 0, types);
    if (Array.isArray(value)) return value.forEach((item) => collect(item, depth + 1, types));
    if (!value || typeof value !== "object" || depth > 10) return;
    const width = imageDimension(value.width);
    const height = imageDimension(value.height);
    for (const key of ["contentUrl", "url", "thumbnailUrl", "@id"]) {
      if (typeof value[key] === "string") push(value[key], width, height, types);
    }
  }

  function push(value, width, height, types) {
    const url = String(value || "").trim();
    if (!url || seen.has(url)) return;
    seen.add(url);
    output.push({
      url,
      score: 980 - output.length * 0.01,
      identity: `${types.join(" ")} structured image`,
      width,
      height,
      provenance: "structured",
    });
  }
}

function normalizeCandidateRecord(value, baseUrl, index, profile) {
  const candidate = typeof value === "object" && value ? value : { url: value };
  const identity = `${candidate.identity || ""} ${candidate.context || ""} ${candidate.url || ""}`;
  const width = imageDimension(candidate.width);
  const height = imageDimension(candidate.height);
  if (!candidate.url || LOW_VALUE_IMAGE_PATTERN.test(identity) || VIDEO_URL_PATTERN.test(String(candidate.url))) return null;
  if (!imageMeetsProfileDimensions(width, height, profile)) return null;
  const url = safeImageUrl(candidate.url, baseUrl);
  if (!url) return null;
  return {
    url,
    score: Number(candidate.score) || 0,
    index,
    provenance: String(candidate.provenance || "markup"),
    width,
    height,
    identity: String(candidate.identity || ""),
  };
}

function imageNodeCandidates(node) {
  const pictureSources = node?.parent?.tag === "picture"
    ? node.parent.children.filter((child) => child.tag === "source")
    : [];
  return [
    ...pictureSources.flatMap((source) => imageAttributeCandidates(source.attrs)),
    ...imageAttributeCandidates(node.attrs),
  ];
}

function imageNodeIdentity(node) {
  return `${nodeIdentity(node)} ${node?.attrs?.alt || ""} ${node?.attrs?.title || ""} ${ancestorIdentity(node)}`;
}

function ancestorIdentity(node) {
  const identities = [];
  for (let current = node?.parent; current && current.tag !== "#root"; current = current.parent) {
    identities.push(`${current.tag} ${nodeIdentity(current)}`);
  }
  return identities.join(" ");
}

function isDecorativeImageNode(node, identity, profile) {
  if (isHiddenImageNode(node)) return true;
  if (LOW_VALUE_IMAGE_PATTERN.test(identity)) return true;
  if (NEGATIVE_CONTEXT_PATTERN.test(nodeIdentity(node))) return true;
  return hasAncestor(node, (ancestor) => {
    if (isHiddenImageNode(ancestor)) return true;
    if (EXCLUDED_CONTEXT_TAGS.has(ancestor.tag)) return true;
    const ancestorIdentityValue = nodeIdentity(ancestor);
    if (NEGATIVE_CONTEXT_PATTERN.test(ancestorIdentityValue)) return true;
    return ancestor.tag === "header"
      && (profile === IMAGE_PROFILE_ARTICLE || !HERO_PATTERN.test(ancestorIdentityValue));
  });
}

function isHiddenImageNode(node) {
  return Object.hasOwn(node?.attrs || {}, "hidden")
    || String(node?.attrs?.["aria-hidden"] || "").toLowerCase() === "true";
}

function contentMetrics(node) {
  let textLength = 0;
  let linkLength = 0;
  let paragraphs = 0;
  let headings = 0;
  const visit = (current, inLink = false) => {
    if (current.tag === "#text") {
      const length = cleanText(current.text).length;
      textLength += length;
      if (inLink) linkLength += length;
      return;
    }
    if (current !== node && isExcludedStructuralNode(current)) return;
    if (current.tag === "p") paragraphs += 1;
    if (/^h[1-6]$/.test(current.tag)) headings += 1;
    for (const child of current.children || []) visit(child, inLink || current.tag === "a");
  };
  visit(node);
  return { textLength, linkLength, paragraphs, headings };
}

function isExcludedStructuralNode(node) {
  if (!node || node.tag === "#text" || node.tag === "#root") return false;
  if (EXCLUDED_CONTEXT_TAGS.has(node.tag)) return true;
  if (Object.hasOwn(node.attrs, "hidden") || node.attrs["aria-hidden"] === "true") return true;
  return NEGATIVE_CONTEXT_PATTERN.test(nodeIdentity(node));
}

function hasAncestor(node, predicate) {
  for (let current = node?.parent; current; current = current.parent) if (predicate(current)) return true;
  return false;
}

function isWithin(node, ancestor) {
  for (let current = node; current; current = current.parent) if (current === ancestor) return true;
  return false;
}

function nodeIdentity(node) {
  return `${node?.attrs?.id || ""} ${node?.attrs?.class || ""} ${node?.attrs?.role || ""}`.trim();
}

function dimensionScore(width, height) {
  let score = 0;
  if (width >= 1000) score += 50;
  else if (width >= 600) score += 35;
  else if (width >= 320) score += 20;
  if (height >= 300) score += 15;
  return score;
}

function backgroundImageCandidate(attrs = {}) {
  return firstNonEmpty(
    attrs["data-bg"], attrs["data-background"], attrs["data-background-image"],
    cssBackgroundUrl(attrs.style),
  );
}

function safeImageUrl(value, baseUrl) {
  try {
    const url = new URL(String(value || "").trim(), baseUrl);
    if (url.username || url.password || url.href.length > MAX_IMAGE_URL_LENGTH) return "";
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) return "";
    const page = new URL(baseUrl);
    if (isPrivateAddressLiteral(url.hostname) && url.origin !== page.origin) return "";
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

function decodeEmbeddedMarkup(value) {
  const source = String(value || "").replace(/<!\[CDATA\[|\]\]>/g, "");
  return /&lt;\s*(?:img|picture|source)\b/i.test(source) ? decodeImageEntities(source) : source;
}

function decodeImageEntities(value) {
  const entities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return String(value || "").replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === "#") {
      const hex = entity[1]?.toLowerCase() === "x";
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return entities[entity.toLowerCase()] ?? match;
  });
}

function cssBackgroundUrl(value) {
  return String(value || "").match(/background(?:-image)?\s*:\s*url\(\s*(['"]?)(.*?)\1\s*\)/i)?.[2] || "";
}

export function imageDimension(value) {
  if (value && typeof value === "object") return imageDimension(value.value);
  const match = String(value || "").trim().match(/^([\d.]+)(?:px)?$/i);
  const number = Number(match?.[1] || 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function firstNonEmpty(...values) {
  return values.find((value) => String(value || "").trim()) || "";
}

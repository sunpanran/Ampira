const MAX_IMAGE_URL_LENGTH = 8192;
const LOW_VALUE_IMAGE_PATTERN = /(?:^|[^a-z0-9])(?:avatar|badge|emoji|icon|logo|pixel|spinner|sprite|tracker|blank|loading|placeholder|spacer|transparent)(?:$|[^a-z0-9])/i;
const VIDEO_URL_PATTERN = /\.(?:m3u8|mp4|m4v|mov|webm|avi)(?:[?#]|$)/i;
const HERO_PATTERN = /(?:article|content|cover|featured|hero|lead|main|masthead|og-image|post|story)[-_\s]*(?:image|media|photo|visual)?/i;

const LAZY_IMAGE_ATTRIBUTES = [
  "data-original", "data-original-src", "data-src", "data-lazy-src", "data-lazy",
  "data-image", "data-zoom-image", "data-flickity-lazyload", "data-cfsrc",
];

export function normalizeImageCandidates(input, baseUrl, { limit = 3 } = {}) {
  const candidates = (Array.isArray(input) ? input : [input])
    .map((value, index) => normalizeCandidate(value, baseUrl, index))
    .filter(Boolean)
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const seen = new Set();
  const urls = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.url)) continue;
    seen.add(candidate.url);
    urls.push(candidate.url);
    if (urls.length >= Math.max(1, Math.floor(Number(limit) || 1))) break;
  }
  return urls;
}

export function extractPageImageCandidates(html, baseUrl, { limit = 3 } = {}) {
  const source = String(html || "");
  const candidates = [];
  const meta = new Map();
  for (const match of source.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = parseImageAttributes(match[0]);
    const key = String(attrs.property || attrs.name || attrs.itemprop || "").toLowerCase();
    if (key && attrs.content && !meta.has(key)) meta.set(key, attrs.content);
  }
  const metaPriority = [
    ["og:image:secure_url", 1200], ["og:image:url", 1190], ["og:image", 1180],
    ["twitter:image", 1100], ["twitter:image:src", 1090],
    ["thumbnailurl", 1020], ["image", 1010],
  ];
  for (const [key, score] of metaPriority) {
    if (meta.get(key)) candidates.push({ url: meta.get(key), score, identity: key });
  }

  for (const match of source.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = parseImageAttributes(match[0]);
    const rel = String(attrs.rel || "").toLowerCase().split(/\s+/);
    if (rel.includes("image_src") && attrs.href) candidates.push({ url: attrs.href, score: 1000, identity: "image_src" });
    if (!rel.includes("preload") || String(attrs.as || "").toLowerCase() !== "image") continue;
    for (const url of srcsetImageCandidates(attrs.imagesrcset)) candidates.push({ url, score: 900, identity: "preload" });
    if (attrs.href) candidates.push({ url: attrs.href, score: 880, identity: "preload" });
  }

  structuredImageCandidates(source).forEach((url, index) => {
    candidates.push({ url, score: 960 - index * 0.01, identity: "structured image" });
  });
  extractMarkupImageCandidates(source, baseUrl, { limit: 24, normalized: false }).forEach((candidate, index) => {
    candidates.push({ ...candidate, score: 700 + candidate.score - index * 0.01 });
  });
  return normalizeImageCandidates(candidates, baseUrl, { limit });
}

export function extractMarkupImageCandidates(markup, baseUrl, { limit = 3, normalized = true } = {}) {
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
    if (width >= 1000) score += 50;
    else if (width >= 600) score += 35;
    else if (width >= 320) score += 20;
    if (height >= 300) score += 15;
    const urls = imageAttributeCandidates(attrs);
    urls.forEach((url, sourceIndex) => candidates.push({
      url,
      score: score - sourceIndex * 0.01,
      identity: `${identity} ${url}`,
      width,
      height,
    }));
    index += 1;
  }

  for (const match of source.matchAll(/<([a-z0-9:-]+)\b[^>]*>/gi)) {
    const attrs = parseImageAttributes(match[0]);
    const identity = `${attrs.id || ""} ${attrs.class || ""}`;
    if (!HERO_PATTERN.test(identity)) continue;
    const background = firstNonEmpty(
      attrs["data-bg"], attrs["data-background"], attrs["data-background-image"],
      cssBackgroundUrl(attrs.style),
    );
    if (background) candidates.push({ url: background, score: 760, identity: `${identity} background` });
  }
  if (!normalized) return candidates.slice(0, Math.max(1, Number(limit) || 1));
  return normalizeImageCandidates(candidates, baseUrl, { limit });
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

function normalizeCandidate(value, baseUrl, index) {
  const candidate = typeof value === "object" && value ? value : { url: value };
  const identity = `${candidate.identity || ""} ${candidate.url || ""}`;
  const width = imageDimension(candidate.width);
  const height = imageDimension(candidate.height);
  if (!candidate.url || LOW_VALUE_IMAGE_PATTERN.test(identity) || VIDEO_URL_PATTERN.test(String(candidate.url))) return null;
  if ((width && width < 180) || (height && height < 100)) return null;
  const url = safeImageUrl(candidate.url, baseUrl);
  if (!url) return null;
  return { url, score: Number(candidate.score) || 0, index };
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

export function structuredImageCandidates(html) {
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
    try { visitStructuredImages(JSON.parse(raw), 0); } catch { /* Invalid JSON-LD is inert. */ }
  }
  return output;

  function visitStructuredImages(value, depth) {
    if (remaining <= 0 || depth > 10 || value === null || value === undefined) return;
    remaining -= 1;
    if (Array.isArray(value)) {
      value.forEach((item) => visitStructuredImages(item, depth + 1));
      return;
    }
    if (typeof value !== "object") return;
    for (const key of ["image", "thumbnailUrl", "primaryImageOfPage"]) collectValue(value[key], depth + 1);
    const types = Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]];
    if (types.some((type) => String(type || "").toLowerCase() === "imageobject")) collectValue(value, depth + 1);
    for (const [key, item] of Object.entries(value)) {
      if (["image", "thumbnailUrl", "primaryImageOfPage", "logo"].includes(key)) continue;
      visitStructuredImages(item, depth + 1);
    }
  }

  function collectValue(value, depth) {
    if (typeof value === "string") return push(value);
    if (Array.isArray(value)) return value.forEach((item) => collectValue(item, depth + 1));
    if (!value || typeof value !== "object" || depth > 10) return;
    for (const key of ["contentUrl", "url", "thumbnailUrl", "@id"]) if (typeof value[key] === "string") push(value[key]);
  }

  function push(value) {
    const candidate = String(value || "").trim();
    if (!candidate || seen.has(candidate)) return;
    seen.add(candidate);
    output.push(candidate);
  }
}

function decodeEmbeddedMarkup(value) {
  const source = String(value || "").replace(/<!\[CDATA\[|\]\]>/g, "");
  return /&lt;\s*(?:img|picture|source)\b/i.test(source)
    ? decodeImageEntities(source)
    : source;
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
  const match = String(value || "").trim().match(/^([\d.]+)(?:px)?$/i);
  const number = Number(match?.[1] || 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function firstNonEmpty(...values) {
  return values.find((value) => String(value || "").trim()) || "";
}
import { isPrivateAddressLiteral } from "./network-policy.mjs";

export function metaContent(html, names) {
  const accepted = new Set(names.map((name) => String(name).toLowerCase()));
  for (const match of String(html || "").matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = parseAttributes(match[0]);
    const name = String(attributes.property || attributes.name || "").toLowerCase();
    if (!accepted.has(name)) continue;
    const content = attributes.content || "";
    if (content) return content;
  }
  return "";
}

export function htmlToText(html) {
  return decodeEntities(String(html || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
    .replace(/<\/(?:p|div|article|section|main|h[1-6]|li|blockquote)>/gi, "\n")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/[^\S\r\n]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

export function tagText(block, tag) {
  const escaped = tag.replace(":", "\\:");
  return stripCdata(firstMatch(block, new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`, "i")));
}

export function stripCdata(value) {
  return String(value || "").replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/i, "$1").trim();
}

export function parseAttributes(tag) {
  const attributes = {};
  const source = String(tag || "").replace(/^<[^\s>]+|\/?\s*>$/g, "");
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const match of source.matchAll(pattern)) {
    const name = String(match[1] || "").toLowerCase();
    if (!name || Object.hasOwn(attributes, name)) continue;
    attributes[name] = decodeEntities(firstNonEmpty(match[2], match[3], match[4], ""));
  }
  return attributes;
}

export function dedupeArticles(items) {
  const deduped = [];
  const indexesByUrl = new Map();
  for (const item of (items || []).filter(Boolean)) {
    const key = normalizeUrl(item.url);
    if (!key) continue;
    const existingIndex = indexesByUrl.get(key);
    if (existingIndex === undefined) {
      indexesByUrl.set(key, deduped.length);
      deduped.push(item);
      continue;
    }
    if (deduped[existingIndex].externalDiscovery === true && item.externalDiscovery !== true) {
      deduped[existingIndex] = item;
    }
  }
  return deduped;
}

export function dedupeBy(items, keyFor) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyFor(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function isJsonFeed(text, contentType) {
  return /application\/(?:feed\+)?json/i.test(contentType) || /^\s*\{/.test(text) && /"items"\s*:/.test(text.slice(0, 1000));
}

export function looksLikeHtml(text, contentType) {
  return /text\/html|application\/xhtml/i.test(contentType) || /<(?:html|head|body)\b/i.test(String(text).slice(0, 1000));
}

export function cleanText(value) {
  return decodeEntities(String(value || "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

export function decodeEntities(value) {
  const entities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return String(value || "").replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === "#") {
      const hex = entity[1]?.toLowerCase() === "x";
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      try { return Number.isFinite(code) ? String.fromCodePoint(code) : match; } catch { return match; }
    }
    return entities[entity.toLowerCase()] ?? match;
  });
}

export function absolutize(value, base) {
  try {
    const raw = decodeEntities(String(value || "").trim());
    if (!raw) return "";
    const url = new URL(raw, base);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

export function looksLikeAbsoluteUrl(value) {
  return /^https?:\/\//i.test(stripCdata(value));
}

export function normalizeUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].forEach((key) => url.searchParams.delete(key));
    return url.href.replace(/\/$/, "");
  } catch {
    return "";
  }
}

export function hostOf(value) {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function safeSourceOrigin(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (url.protocol === "https:") return url.origin;
    if (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)) return url.origin;
    return "";
  } catch {
    return "";
  }
}

export function normalizeDate(value) {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? new Date(time).toISOString() : "";
}

export function firstMatch(text, pattern) {
  return String(text || "").match(pattern)?.[1]?.trim() || "";
}

export function firstNonEmpty(...values) {
  return values.find((value) => String(value || "").trim()) || "";
}

export function cleanHeaderValue(value) {
  return String(value || "").replace(/[\r\n]/g, "").trim().slice(0, 1024);
}

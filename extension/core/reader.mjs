import { DEFAULT_LOCALE, translate } from "./i18n.mjs";
import { decodeResponseBuffer, fetchBounded } from "./network.mjs";

const REQUEST_TIMEOUT_MS = 12000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_TEXT_CHARS = 120000;
const MAX_BLOCKS = 400;
const MAX_IMAGES = 30;

const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr",
]);
const OMITTED_TAGS = new Set(["script", "style", "noscript", "template", "svg", "canvas"]);
const EXCLUDED_CONTENT_TAGS = new Set(["nav", "footer", "aside", "form", "button", "select", "textarea", "dialog"]);
const CANDIDATE_TAGS = new Set(["article", "main", "section", "div", "body"]);
const BLOCK_TAGS = new Set([
  "article", "main", "section", "div", "p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "blockquote", "pre", "figure", "table", "img", "video", "iframe",
]);
const NEGATIVE_PATTERN = /(?:^|[\s_-])(?:ad|ads|advert|banner|breadcrumb|comment|cookie|consent|footer|header|login|menu|modal|nav|newsletter|promo|recommend|related|share|sidebar|social|sponsor|subscribe|toolbar)(?:$|[\s_-])/i;
const POSITIVE_PATTERN = /(?:^|[\s_-])(?:article|body|content|entry|main|post|story|text)(?:$|[\s_-])/i;
const IMAGE_NEGATIVE_PATTERN = /(?:^|[^a-z0-9])(?:avatar|badge|emoji|icon|logo|pixel|spinner|sprite|tracker)(?:$|[^a-z0-9])/i;
const HERO_IMAGE_PATTERN = /(?:article|content|cover|featured|hero|lead|main|masthead|og-image|post|story)[-_\s]*(?:image|media|photo|visual)?/i;
const PLACEHOLDER_IMAGE_PATTERN = /(?:^|[/_.-])(?:blank|loading|placeholder|spacer|transparent)(?:[/_.-]|$)/i;
const MAX_STRUCTURED_DATA_CHARS = 256 * 1024;
const MAX_STRUCTURED_DATA_NODES = 500;
const VIDEO_HOST_PATTERN = /(?:youtube(?:-nocookie)?\.com|youtu\.be|vimeo\.com|bilibili\.com|player\.|video\.)/i;

export async function fetchReader(url, timeoutOrOptions = REQUEST_TIMEOUT_MS) {
  const options = typeof timeoutOrOptions === "object" && timeoutOrOptions ? timeoutOrOptions : {};
  const timeoutMs = typeof timeoutOrOptions === "number" ? timeoutOrOptions : (options.timeoutMs || REQUEST_TIMEOUT_MS);
  const response = await fetchReaderHtml(url, timeoutMs, options);
  return extractReaderDocument(response.text, response.url, url);
}

export async function loadReaderWithCache(url, adapters = {}) {
  const readCache = typeof adapters.readCache === "function" ? adapters.readCache : async () => null;
  const storeCache = typeof adapters.storeCache === "function" ? adapters.storeCache : async () => {};
  const fetchDocument = typeof adapters.fetchDocument === "function" ? adapters.fetchDocument : fetchReader;
  const validateCache = typeof adapters.validateCache === "function" ? adapters.validateCache : async () => true;
  let cached = await readCache(url);
  if (cached) {
    try {
      if (!await validateCache(cached)) cached = null;
    } catch {
      cached = null;
    }
  }
  try {
    const reader = await fetchDocument(url);
    try {
      await storeCache(reader);
    } catch {
      // A cache outage must not hide successfully fetched article content.
    }
    return reader;
  } catch (error) {
    if (error?.code === "ORIGIN_PERMISSION_REQUIRED") throw error;
    if (!cached) throw error;
    return {
      ...cached,
      requestedUrl: url,
      source: "cache",
      staleReason: error?.message || error?.code || "READER_ERROR",
      staleCode: error?.code || "READER_ERROR",
      staleDetails: error?.details && typeof error.details === "object" ? error.details : {},
    };
  }
}

export async function fetchReaderHtml(url, timeoutMs = REQUEST_TIMEOUT_MS, options = {}) {
  let response;
  let buffer;
  try {
    const bounded = await fetchBounded(url, {
      redirect: "error",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers: { accept: "text/html, application/xhtml+xml;q=0.9, text/plain;q=0.5, */*;q=0.1" },
    }, {
      timeoutMs,
      maxBytes: MAX_RESPONSE_BYTES,
      validateResponse: options.validateResponse,
    });
    response = bounded.response;
    buffer = bounded.buffer;
  } catch (error) {
    if (error?.messageKey) throw error;
    if (error?.code === "NETWORK_TIMEOUT") throw readerError("READER_TIMEOUT", true, { url });
    if (error?.code === "RESPONSE_TOO_LARGE") throw readerError("READER_RESPONSE_TOO_LARGE", false, error.details);
    throw readerError("READER_NETWORK_ERROR", true, { url });
  }
  if (!response.ok) throw responseError(response, url);
  const contentType = response.headers.get("content-type") || "";
  const text = decodeResponseBuffer(buffer, contentType);
  if (!looksLikeReadableHtml(text, contentType)) {
    throw readerError("READER_UNSUPPORTED_CONTENT", false, { status: response.status, url: response.url || url });
  }
  return { text, url: response.url || url, contentType };
}

export function extractReaderDocument(html, finalUrl, requestedUrl = finalUrl) {
  const root = parseHtml(html);
  const metadata = extractMetadata(root, finalUrl);
  const selection = selectArticleCandidate(root);
  const title = firstNonEmpty(metadata.title, textOf(findFirst(selection.node, (node) => node.tag === "h1")), hostOf(finalUrl));
  const state = createExtractionState(finalUrl, title);
  if (metadata.heroImageUrl) addImageBlock(state, {
    url: metadata.heroImageUrl,
    alt: title,
    caption: "",
  });
  extractBlocks(selection.node, state);
  const blocks = state.blocks;
  const plainText = readerTextFromBlocks(blocks);
  if (plainText.trim().length < 80) {
    throw readerError("READER_EXTRACTION_EMPTY", false, { url: finalUrl });
  }
  const wordCount = countWords(plainText);
  return {
    ok: true,
    schemaVersion: 2,
    requestedUrl: safeHttpUrl(requestedUrl, finalUrl) || finalUrl,
    url: safeHttpUrl(finalUrl, finalUrl) || requestedUrl,
    canonicalUrl: sameOriginUrl(metadata.canonicalUrl, finalUrl) || safeHttpUrl(finalUrl, finalUrl) || requestedUrl,
    title: cleanText(title),
    siteName: metadata.siteName || hostOf(finalUrl),
    byline: metadata.byline,
    publishedAt: metadata.publishedAt,
    blocks,
    wordCount,
    readingMinutes: Math.max(1, Math.ceil(wordCount / 350)),
    truncated: state.truncated,
    quality: selection.fallback || plainText.length < 600 ? "partial" : "complete",
    source: "live",
    fetchedAt: new Date().toISOString(),
    staleReason: "",
  };
}

export function extractPageMetadata(html, baseUrl) {
  const source = String(html || "");
  return extractMetadata(parseHtml(source), baseUrl, structuredImageCandidates(source));
}

export function readerTextFromBlocks(blocks) {
  return (blocks || []).map((block) => {
    if (block.type === "paragraph" || block.type === "heading") return runsText(block.runs || [{ text: block.text || "" }]);
    if (block.type === "list") return (block.items || []).map(runsText).join("\n");
    if (block.type === "quote" || block.type === "code") return block.text || "";
    if (block.type === "image") return [block.alt, block.caption].filter(Boolean).join(" ");
    if (block.type === "video") return block.title || "";
    return "";
  }).filter(Boolean).join("\n\n");
}

function parseHtml(html) {
  const root = { tag: "#root", attrs: {}, children: [], parent: null, ignored: false };
  const stack = [root];
  let index = 0;
  const source = String(html || "");
  while (index < source.length) {
    const open = source.indexOf("<", index);
    if (open < 0) {
      appendText(stack.at(-1), source.slice(index));
      break;
    }
    if (open > index) appendText(stack.at(-1), source.slice(index, open));
    if (source.startsWith("<!--", open)) {
      const end = source.indexOf("-->", open + 4);
      index = end < 0 ? source.length : end + 3;
      continue;
    }
    const end = findTagEnd(source, open + 1);
    if (end < 0) {
      appendText(stack.at(-1), source.slice(open));
      break;
    }
    const token = source.slice(open + 1, end).trim();
    index = end + 1;
    if (!token || token[0] === "!" || token[0] === "?") continue;
    if (token[0] === "/") {
      const tag = token.slice(1).trim().split(/\s+/, 1)[0].toLowerCase();
      for (let cursor = stack.length - 1; cursor > 0; cursor -= 1) {
        if (stack[cursor].tag !== tag) continue;
        stack.length = cursor;
        break;
      }
      continue;
    }
    const tagMatch = token.match(/^([^\s/>]+)/);
    if (!tagMatch) continue;
    const tag = tagMatch[1].toLowerCase();
    const parent = stack.at(-1);
    const ignored = parent.ignored || OMITTED_TAGS.has(tag);
    const node = {
      tag,
      attrs: parseAttributes(token.slice(tagMatch[0].length)),
      children: [],
      parent,
      ignored,
    };
    if (!ignored) parent.children.push(node);
    if (!VOID_TAGS.has(tag) && !/\/\s*$/.test(token)) stack.push(node);
  }
  return root;
}

function findTagEnd(source, start) {
  let quote = "";
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ">") return index;
  }
  return -1;
}

function parseAttributes(raw) {
  const attrs = {};
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const match of String(raw || "").matchAll(pattern)) {
    const name = match[1].toLowerCase();
    if (!name || name.startsWith("on")) continue;
    attrs[name] = decodeEntities(firstNonEmpty(match[2], match[3], match[4], ""));
  }
  return attrs;
}

function appendText(parent, value) {
  if (!parent || parent.ignored || !value) return;
  parent.children.push({ tag: "#text", text: value, attrs: {}, children: [], parent, ignored: false });
}

function selectArticleCandidate(root) {
  const candidates = [];
  walkElements(root, (node) => {
    if (!CANDIDATE_TAGS.has(node.tag) && node.attrs.role !== "main") return;
    if (isExcludedNode(node)) return;
    const metrics = contentMetrics(node);
    if (metrics.textLength < 120) return;
    const identity = nodeIdentity(node);
    const semanticBoost = node.tag === "article" ? 1200 : node.tag === "main" || node.attrs.role === "main" ? 900 : 0;
    const positiveBoost = POSITIVE_PATTERN.test(identity) ? 500 : 0;
    const linkPenalty = metrics.textLength ? (metrics.linkLength / metrics.textLength) * metrics.textLength * 1.6 : 0;
    const score = metrics.textLength + metrics.paragraphs * 140 + metrics.headings * 40 + semanticBoost + positiveBoost - linkPenalty;
    candidates.push({ node, metrics, score });
  });
  candidates.sort((left, right) => right.score - left.score);
  if (candidates.length) return { node: candidates[0].node, fallback: candidates[0].metrics.textLength < 500 };
  const body = findFirst(root, (node) => node.tag === "body") || root;
  return { node: body, fallback: true };
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
    if (current !== node && isExcludedNode(current)) return;
    if (current.tag === "p") paragraphs += 1;
    if (/^h[1-6]$/.test(current.tag)) headings += 1;
    for (const child of current.children) visit(child, inLink || current.tag === "a");
  };
  visit(node);
  return { textLength, linkLength, paragraphs, headings };
}

function extractMetadata(root, baseUrl, structuredImages = []) {
  const meta = new Map();
  walkElements(root, (node) => {
    if (node.tag !== "meta") return;
    const key = String(node.attrs.property || node.attrs.name || node.attrs.itemprop || "").toLowerCase();
    const value = cleanText(node.attrs.content || "");
    if (key && value && !meta.has(key)) meta.set(key, value);
  });
  const canonicalNode = findFirst(root, (node) => node.tag === "link" && /(?:^|\s)canonical(?:\s|$)/i.test(node.attrs.rel || ""));
  const imageSourceNode = findFirst(root, (node) => node.tag === "link" && /(?:^|\s)image_src(?:\s|$)/i.test(node.attrs.rel || ""));
  const preloadImages = findAll(root, (node) => (
    node.tag === "link"
    && /(?:^|\s)preload(?:\s|$)/i.test(node.attrs.rel || "")
    && String(node.attrs.as || "").toLowerCase() === "image"
  )).flatMap((node) => [
    ...srcsetImageCandidates(node.attrs.imagesrcset),
    node.attrs.href,
  ]);
  const titleNode = findFirst(root, (node) => node.tag === "title");
  const bylineNode = findFirst(root, (node) => /(?:author|byline)/i.test(nodeIdentity(node)) && cleanText(textOf(node)).length < 180);
  const timeNode = findFirst(root, (node) => node.tag === "time" && node.attrs.datetime);
  return {
    title: firstNonEmpty(meta.get("og:title"), meta.get("twitter:title"), cleanText(textOf(titleNode))),
    siteName: firstNonEmpty(meta.get("og:site_name"), meta.get("application-name"), hostOf(baseUrl)),
    byline: firstNonEmpty(meta.get("author"), meta.get("article:author"), cleanText(textOf(bylineNode))).slice(0, 180),
    publishedAt: normalizeDate(firstNonEmpty(
      meta.get("article:published_time"),
      meta.get("datepublished"),
      meta.get("date"),
      timeNode?.attrs?.datetime,
    )),
    canonicalUrl: safeHttpUrl(canonicalNode?.attrs?.href, baseUrl),
    heroImageUrl: firstSafeImageUrl([
      meta.get("og:image:secure_url"),
      meta.get("og:image:url"),
      meta.get("og:image"),
      meta.get("twitter:image"),
      meta.get("twitter:image:src"),
      meta.get("thumbnailurl"),
      meta.get("image"),
      imageSourceNode?.attrs?.href,
      ...structuredImages,
      ...preloadImages,
      ...semanticImageCandidates(root),
    ], baseUrl),
  };
}

function structuredImageCandidates(html) {
  const output = [];
  const seen = new Set();
  let consumed = 0;
  const scripts = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  for (const match of String(html || "").matchAll(scripts)) {
    const attrs = parseAttributes(match[1]);
    if (String(attrs.type || "").split(";", 1)[0].trim().toLowerCase() !== "application/ld+json") continue;
    const raw = String(match[2] || "").trim().replace(/^<!--\s*|\s*-->$/g, "");
    consumed += raw.length;
    if (!raw || consumed > MAX_STRUCTURED_DATA_CHARS) break;
    try {
      const state = { remaining: MAX_STRUCTURED_DATA_NODES };
      collectStructuredImages(JSON.parse(raw), output, seen, state);
    } catch {
      // Invalid structured data is ignored like malformed metadata.
    }
  }
  return output;
}

function collectStructuredImages(value, output, seen, state, depth = 0) {
  if (state.remaining <= 0 || depth > 10 || value === null || value === undefined) return;
  state.remaining -= 1;
  if (Array.isArray(value)) {
    for (const item of value) collectStructuredImages(item, output, seen, state, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  for (const key of ["image", "thumbnailUrl", "primaryImageOfPage"]) {
    if (Object.hasOwn(value, key)) collectStructuredImageValue(value[key], output, seen, state, depth + 1);
  }
  const types = Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]];
  if (types.some((type) => String(type || "").toLowerCase() === "imageobject")) {
    for (const key of ["contentUrl", "url", "thumbnailUrl", "@id"]) {
      if (typeof value[key] === "string") pushUniqueImageCandidate(value[key], output, seen);
    }
  }
  for (const [key, item] of Object.entries(value)) {
    if (["image", "thumbnailUrl", "primaryImageOfPage", "logo"].includes(key)) continue;
    collectStructuredImages(item, output, seen, state, depth + 1);
  }
}

function collectStructuredImageValue(value, output, seen, state, depth) {
  if (typeof value === "string") {
    pushUniqueImageCandidate(value, output, seen);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStructuredImageValue(item, output, seen, state, depth + 1);
    return;
  }
  if (!value || typeof value !== "object" || state.remaining <= 0 || depth > 10) return;
  state.remaining -= 1;
  for (const key of ["contentUrl", "url", "thumbnailUrl", "@id"]) {
    if (typeof value[key] === "string") pushUniqueImageCandidate(value[key], output, seen);
  }
}

function pushUniqueImageCandidate(value, output, seen) {
  const candidate = String(value || "").trim();
  if (!candidate || seen.has(candidate)) return;
  seen.add(candidate);
  output.push(candidate);
}

function semanticImageCandidates(root) {
  return findAll(root, (node) => node.tag === "img")
    .map((node, index) => scoreImageNode(node, index))
    .filter(Boolean)
    .sort((left, right) => right.score - left.score)
    .flatMap((entry) => entry.sources);
}

function scoreImageNode(node, index) {
  const sources = imageNodeCandidates(node);
  if (!sources.length) return null;
  const identity = `${nodeIdentity(node)} ${node.attrs.alt || ""} ${node.attrs.title || ""} ${sources.join(" ")}`;
  if (IMAGE_NEGATIVE_PATTERN.test(identity) || hasDecorativeAncestor(node)) return null;
  const width = imageDimension(node.attrs.width);
  const height = imageDimension(node.attrs.height);
  if ((width && width < 180) || (height && height < 100)) return null;
  let score = Math.max(0, 20 - index * 0.01);
  if (String(node.attrs.itemprop || "").toLowerCase() === "image") score += 140;
  if (HERO_IMAGE_PATTERN.test(identity)) score += 120;
  if (String(node.attrs.fetchpriority || "").toLowerCase() === "high") score += 100;
  if (hasAncestor(node, (ancestor) => ancestor.tag === "article")) score += 90;
  else if (hasAncestor(node, (ancestor) => ancestor.tag === "main" || ancestor.attrs.role === "main")) score += 70;
  if (width >= 1000) score += 50;
  else if (width >= 600) score += 35;
  else if (width >= 320) score += 20;
  if (height >= 300) score += 15;
  if (cleanText(node.attrs.alt || "").length >= 8) score += 8;
  return { score, sources };
}

function imageNodeCandidates(node) {
  return [
    node.attrs["data-original"],
    node.attrs["data-original-src"],
    node.attrs["data-src"],
    node.attrs["data-lazy-src"],
    node.attrs["data-lazy"],
    node.attrs["data-image"],
    node.attrs["data-zoom-image"],
    node.attrs["data-flickity-lazyload"],
    node.attrs["data-cfsrc"],
    ...srcsetImageCandidates(node.attrs["data-srcset"]),
    ...pictureSourceCandidates(node),
    ...srcsetImageCandidates(node.attrs.srcset),
    node.attrs.src,
  ].map((value) => String(value || "").trim()).filter((value) => value && !PLACEHOLDER_IMAGE_PATTERN.test(value));
}

function pictureSourceCandidates(node) {
  if (node?.parent?.tag !== "picture") return [];
  return node.parent.children.filter((child) => child.tag === "source").flatMap((source) => [
    ...srcsetImageCandidates(source.attrs["data-srcset"]),
    ...srcsetImageCandidates(source.attrs.srcset),
    source.attrs["data-src"],
    source.attrs.src,
  ]);
}

function srcsetImageCandidates(value) {
  return String(value || "").split(",").map((entry, index) => {
    const match = entry.trim().match(/^(\S+)(?:\s+([\d.]+)(w|x))?$/i);
    if (!match) return null;
    const amount = Number(match[2] || 0);
    const score = match[3]?.toLowerCase() === "w" ? amount : amount * 1000;
    return { url: match[1], score, index };
  }).filter(Boolean).sort((left, right) => right.score - left.score || left.index - right.index).map((entry) => entry.url);
}

function imageDimension(value) {
  const match = String(value || "").trim().match(/^([\d.]+)(?:px)?$/i);
  const number = Number(match?.[1] || 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function hasAncestor(node, predicate) {
  for (let current = node?.parent; current; current = current.parent) if (predicate(current)) return true;
  return false;
}

function hasDecorativeAncestor(node) {
  return hasAncestor(node, (ancestor) => (
    ["nav", "footer", "aside"].includes(ancestor.tag)
    || ancestor.tag === "header" && !HERO_IMAGE_PATTERN.test(nodeIdentity(ancestor))
    || isExcludedNode(ancestor)
  ));
}

function createExtractionState(baseUrl, title) {
  return {
    baseUrl,
    title: cleanComparable(title),
    blocks: [],
    imageUrls: new Set(),
    imageCount: 0,
    usedChars: 0,
    truncated: false,
    stopped: false,
  };
}

function extractBlocks(node, state) {
  if (!node || state.stopped || isExcludedNode(node)) return;
  if (node.tag === "#text") return;
  if (/^h[1-6]$/.test(node.tag)) {
    const runs = collectInlineRuns(node, state.baseUrl);
    const text = runsText(runs);
    if (text && cleanComparable(text) !== state.title) addBlock(state, { type: "heading", level: Number(node.tag[1]) <= 2 ? 2 : 3, runs });
    return;
  }
  if (node.tag === "p") {
    addBlock(state, { type: "paragraph", runs: collectInlineRuns(node, state.baseUrl) });
    extractMediaDescendants(node, state);
    return;
  }
  if (node.tag === "ul" || node.tag === "ol") {
    const items = node.children
      .filter((child) => child.tag === "li")
      .map((child) => collectInlineRuns(child, state.baseUrl, new Set(["ul", "ol"])))
      .filter((runs) => runsText(runs));
    addBlock(state, { type: "list", ordered: node.tag === "ol", items });
    return;
  }
  if (node.tag === "blockquote") {
    addBlock(state, { type: "quote", text: cleanText(textOf(node)) });
    return;
  }
  if (node.tag === "pre") {
    addBlock(state, { type: "code", text: decodeEntities(textOf(node)).replace(/^\s+|\s+$/g, "") });
    return;
  }
  if (node.tag === "figure") {
    const captionNode = findFirst(node, (child) => child.tag === "figcaption");
    const caption = cleanText(textOf(captionNode));
    for (const child of node.children) {
      if (child.tag === "img") addImageNode(state, child, caption);
      if (child.tag === "video" || child.tag === "iframe") addVideoNode(state, child, caption);
      if (child.tag !== "figcaption" && child.tag !== "img" && child.tag !== "video" && child.tag !== "iframe") extractBlocks(child, state);
    }
    return;
  }
  if (node.tag === "img") {
    addImageNode(state, node, "");
    return;
  }
  if (node.tag === "video" || node.tag === "iframe") {
    addVideoNode(state, node, "");
    return;
  }
  if (node.tag === "table") {
    for (const row of findAll(node, (child) => child.tag === "tr")) {
      const cells = row.children.filter((child) => child.tag === "td" || child.tag === "th").map((child) => cleanText(textOf(child))).filter(Boolean);
      if (cells.length) addBlock(state, { type: "paragraph", runs: [{ text: cells.join(" · ") }] });
    }
    return;
  }
  const elementChildren = node.children.filter((child) => child.tag !== "#text");
  const hasBlockChildren = elementChildren.some((child) => BLOCK_TAGS.has(child.tag));
  if (["div", "section"].includes(node.tag) && !hasBlockChildren) {
    const runs = collectInlineRuns(node, state.baseUrl);
    if (runsText(runs).length >= 30) addBlock(state, { type: "paragraph", runs });
    extractMediaDescendants(node, state);
    return;
  }
  for (const child of node.children) extractBlocks(child, state);
}

function collectInlineRuns(node, baseUrl, excludedTags = new Set()) {
  const runs = [];
  const visit = (current, href = "") => {
    if (current.tag === "#text") {
      addRun(runs, current.text, href);
      return;
    }
    const stopsInlineFlow = ["ul", "ol", "blockquote", "pre", "figure", "table", "img", "video", "iframe"].includes(current.tag);
    if (current !== node && (excludedTags.has(current.tag) || isExcludedNode(current) || stopsInlineFlow)) return;
    if (current.tag === "br") {
      addRun(runs, "\n", href);
      return;
    }
    const nextHref = current.tag === "a" ? safeHttpUrl(current.attrs.href, baseUrl) : href;
    for (const child of current.children) visit(child, nextHref);
  };
  visit(node);
  return normalizeRuns(runs);
}

function addRun(runs, value, href) {
  const text = decodeEntities(String(value || "")).replace(/[^\S\r\n]+/g, " ");
  if (!text) return;
  const previous = runs.at(-1);
  if (previous && (previous.href || "") === (href || "")) previous.text += text;
  else runs.push({ text, ...(href ? { href } : {}) });
}

function normalizeRuns(input) {
  const runs = input.map((run) => ({ ...run, text: run.text.replace(/\n\s*\n+/g, "\n") })).filter((run) => run.text);
  if (!runs.length) return [];
  runs[0].text = runs[0].text.trimStart();
  runs[runs.length - 1].text = runs[runs.length - 1].text.trimEnd();
  return runs.filter((run) => run.text);
}

function addImageNode(state, node, caption) {
  const identity = nodeIdentity(node);
  const width = Number.parseInt(node.attrs.width || "0", 10) || 0;
  const height = Number.parseInt(node.attrs.height || "0", 10) || 0;
  if (IMAGE_NEGATIVE_PATTERN.test(identity) || width > 0 && height > 0 && width <= 80 && height <= 80) return;
  const pictureSource = node.parent?.tag === "picture"
    ? node.parent.children.find((child) => child.tag === "source")
    : null;
  const url = firstNonEmpty(
    bestSrcset(node.attrs["data-srcset"]),
    bestSrcset(node.attrs.srcset),
    bestSrcset(pictureSource?.attrs?.srcset),
    node.attrs["data-src"],
    node.attrs["data-lazy-src"],
    node.attrs["data-original"],
    node.attrs.src,
  );
  addImageBlock(state, {
    url: safeImageUrl(url, state.baseUrl),
    alt: cleanText(node.attrs.alt || ""),
    caption: cleanText(caption || node.attrs.title || ""),
  });
}

function addImageBlock(state, image) {
  if (!image.url || state.imageCount >= MAX_IMAGES || state.imageUrls.has(image.url)) return;
  state.imageUrls.add(image.url);
  state.imageCount += 1;
  addBlock(state, { type: "image", url: image.url, alt: image.alt || "", caption: image.caption || "" });
}

function addVideoNode(state, node, caption) {
  const sourceUrl = safeHttpUrl(node.attrs.src, state.baseUrl);
  const looksLikeVideo = node.tag === "video" || VIDEO_HOST_PATTERN.test(sourceUrl) || /video|视频/i.test(`${node.attrs.title || ""} ${node.attrs.class || ""}`);
  if (!looksLikeVideo) return;
  addBlock(state, {
    type: "video",
    posterUrl: safeImageUrl(node.attrs.poster, state.baseUrl),
    title: cleanText(firstNonEmpty(caption, node.attrs.title)),
    externalUrl: state.baseUrl,
  });
}

function extractMediaDescendants(node, state) {
  walkElements(node, (child) => {
    if (child === node) return;
    if (child.tag === "img") addImageNode(state, child, "");
    if (child.tag === "video" || child.tag === "iframe") addVideoNode(state, child, "");
  });
}

function addBlock(state, input) {
  if (state.stopped || !input) return;
  const block = normalizeBlock(input);
  if (!block) return;
  if (state.blocks.length >= MAX_BLOCKS) {
    state.truncated = true;
    state.stopped = true;
    return;
  }
  const length = blockTextLength(block);
  if (!length && block.type !== "image" && block.type !== "video") return;
  const remaining = MAX_TEXT_CHARS - state.usedChars;
  if (length > remaining) {
    const truncated = truncateBlock(block, Math.max(0, remaining));
    if (truncated) state.blocks.push(truncated);
    state.usedChars = MAX_TEXT_CHARS;
    state.truncated = true;
    state.stopped = true;
    return;
  }
  const previous = state.blocks.at(-1);
  if (previous && blockText(previous) && cleanComparable(blockText(previous)) === cleanComparable(blockText(block))) return;
  state.blocks.push(block);
  state.usedChars += length;
}

function normalizeBlock(block) {
  if (block.type === "paragraph" || block.type === "heading") {
    const runs = normalizeRuns(block.runs || []);
    return runsText(runs) ? { ...block, runs } : null;
  }
  if (block.type === "list") {
    const items = (block.items || []).map(normalizeRuns).filter((runs) => runsText(runs));
    return items.length ? { ...block, items } : null;
  }
  if (block.type === "quote" || block.type === "code") {
    const text = String(block.text || "").trim();
    return text ? { ...block, text } : null;
  }
  if (block.type === "image" || block.type === "video") return block;
  return null;
}

function truncateBlock(block, remaining) {
  if (remaining <= 0) return null;
  if (block.type === "paragraph" || block.type === "heading") {
    return { ...block, runs: truncateRuns(block.runs, remaining) };
  }
  if (block.type === "quote" || block.type === "code") return { ...block, text: block.text.slice(0, remaining) };
  if (block.type === "list") {
    const items = [];
    let left = remaining;
    for (const runs of block.items) {
      if (left <= 0) break;
      const next = truncateRuns(runs, left);
      if (runsText(next)) items.push(next);
      left -= runsText(next).length;
    }
    return items.length ? { ...block, items } : null;
  }
  return block;
}

function truncateRuns(runs, length) {
  const output = [];
  let remaining = length;
  for (const run of runs || []) {
    if (remaining <= 0) break;
    const text = run.text.slice(0, remaining);
    if (text) output.push({ ...run, text });
    remaining -= text.length;
  }
  return output;
}

function blockTextLength(block) {
  return blockText(block).length;
}

function blockText(block) {
  if (block.type === "paragraph" || block.type === "heading") return runsText(block.runs);
  if (block.type === "list") return block.items.map(runsText).join(" ");
  if (block.type === "quote" || block.type === "code") return block.text || "";
  if (block.type === "image") return `${block.alt || ""} ${block.caption || ""}`.trim();
  if (block.type === "video") return block.title || "";
  return "";
}

function runsText(runs) {
  return (runs || []).map((run) => run.text || "").join("").trim();
}

function bestSrcset(value) {
  const candidates = String(value || "").split(",").map((entry, index) => {
    const parts = entry.trim().split(/\s+/);
    const descriptor = parts[1] || "";
    const score = Number.parseFloat(descriptor) || index + 1;
    return { url: parts[0] || "", score };
  }).filter((entry) => entry.url);
  return candidates.sort((left, right) => right.score - left.score)[0]?.url || "";
}

function isExcludedNode(node) {
  if (!node || node.tag === "#text" || node.tag === "#root") return false;
  if (EXCLUDED_CONTENT_TAGS.has(node.tag)) return true;
  if (Object.hasOwn(node.attrs, "hidden") || node.attrs["aria-hidden"] === "true") return true;
  return NEGATIVE_PATTERN.test(nodeIdentity(node));
}

function nodeIdentity(node) {
  return `${node?.attrs?.id || ""} ${node?.attrs?.class || ""} ${node?.attrs?.role || ""}`.trim();
}

function textOf(node) {
  if (!node) return "";
  if (node.tag === "#text") return node.text || "";
  return node.children.map(textOf).join(" ");
}

function findFirst(node, predicate) {
  if (!node) return null;
  if (predicate(node)) return node;
  for (const child of node.children || []) {
    const found = findFirst(child, predicate);
    if (found) return found;
  }
  return null;
}

function findAll(node, predicate, output = []) {
  if (!node) return output;
  if (predicate(node)) output.push(node);
  for (const child of node.children || []) findAll(child, predicate, output);
  return output;
}

function walkElements(node, callback) {
  if (!node || node.tag === "#text") return;
  callback(node);
  for (const child of node.children || []) walkElements(child, callback);
}

function safeHttpUrl(value, baseUrl) {
  if (!value) return "";
  try {
    const url = new URL(String(value).trim(), baseUrl);
    if (url.username || url.password || url.href.length > 8192) return "";
    if (url.protocol === "https:") return url.href;
    if (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)) return url.href;
  } catch {
    return "";
  }
  return "";
}

function sameOriginUrl(value, baseUrl) {
  const safe = safeHttpUrl(value, baseUrl);
  if (!safe) return "";
  try {
    return new URL(safe).origin === new URL(baseUrl).origin ? safe : "";
  } catch {
    return "";
  }
}

function safeImageUrl(value, baseUrl) {
  const safe = safeHttpUrl(value, baseUrl);
  if (!safe) return "";
  try {
    const imageUrl = new URL(safe);
    const pageUrl = new URL(baseUrl);
    if (isPrivateAddressLiteral(imageUrl.hostname) && imageUrl.origin !== pageUrl.origin) return "";
    imageUrl.hash = "";
    return imageUrl.href;
  } catch {
    return "";
  }
}

function firstSafeImageUrl(values, baseUrl) {
  for (const value of values || []) {
    const safe = safeImageUrl(value, baseUrl);
    if (safe) return safe;
  }
  return "";
}

function isPrivateAddressLiteral(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (["localhost", "::1"].includes(host)) return true;
  if (/^(?:fc|fd|fe[89ab])[0-9a-f:]*$/i.test(host)) return true;
  const octets = host.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return octets[0] === 10
    || octets[0] === 127
    || octets[0] === 0
    || octets[0] === 169 && octets[1] === 254
    || octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31
    || octets[0] === 192 && octets[1] === 168;
}

function looksLikeReadableHtml(text, contentType) {
  if (/text\/(?:html|plain)|application\/xhtml\+xml/i.test(contentType)) return true;
  return /<(?:html|head|body|article|main)\b/i.test(String(text).slice(0, 2000));
}

function responseError(response, requestedUrl) {
  const details = { status: response.status, url: response.url || requestedUrl };
  if (response.status === 404 || response.status === 410) return readerError("READER_NOT_FOUND", false, details);
  if (response.status === 401 || response.status === 403) return readerError("READER_ACCESS_DENIED", false, details);
  const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
  return readerError("READER_HTTP_ERROR", retryable, details);
}

function readerError(code, retryable, details = {}) {
  const messageKey = readerMessageKey(code);
  const messageParams = Number.isFinite(Number(details.status)) ? { status: Number(details.status) } : {};
  const error = new Error(translate(DEFAULT_LOCALE, messageKey, messageParams));
  error.code = code;
  error.messageKey = messageKey;
  error.messageParams = messageParams;
  error.retryable = retryable === true;
  error.details = details;
  return error;
}

function readerMessageKey(code) {
  return {
    READER_NOT_FOUND: "reader.error.notFoundBody",
    READER_ACCESS_DENIED: "reader.error.deniedBody",
    READER_TIMEOUT: "reader.error.timeoutBody",
    READER_RESPONSE_TOO_LARGE: "reader.error.tooLargeBody",
    READER_UNSUPPORTED_CONTENT: "reader.error.unsupportedBody",
    READER_EXTRACTION_EMPTY: "reader.error.emptyBody",
    READER_NETWORK_ERROR: "reader.error.networkBody",
    READER_HTTP_ERROR: "reader.error.httpBody",
  }[code] || "reader.error.genericBody";
}

function decodeEntities(value) {
  const entities = {
    amp: "&", apos: "'", gt: ">", hellip: "…", laquo: "“", ldquo: "“", lsquo: "‘", lt: "<", mdash: "—", nbsp: " ", ndash: "–", quot: '"', raquo: "”", rdquo: "”", rsquo: "’",
  };
  return String(value || "").replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === "#") {
      const hex = entity[1]?.toLowerCase() === "x";
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      try { return Number.isFinite(code) ? String.fromCodePoint(code) : match; } catch { return match; }
    }
    return entities[entity.toLowerCase()] ?? match;
  });
}

function cleanText(value) {
  return decodeEntities(String(value || "")).replace(/\s+/g, " ").trim();
}

function cleanComparable(value) {
  return cleanText(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function countWords(value) {
  const text = String(value || "");
  const cjk = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length || 0;
  const words = text.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu, " ").match(/[\p{L}\p{N}]+/gu)?.length || 0;
  return cjk + words;
}

function normalizeDate(value) {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? new Date(time).toISOString() : "";
}

function hostOf(value) {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}

function firstNonEmpty(...values) {
  return values.find((value) => String(value || "").trim()) || "";
}

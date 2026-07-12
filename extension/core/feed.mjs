import { PREFERRED_FEEDS } from "./constants.mjs";
import { hashText } from "./bookmarks.mjs";
import { normalizeLocale, translate } from "./i18n.mjs";
import { decodeResponseBuffer, fetchBounded } from "./network.mjs";

const REQUEST_TIMEOUT_MS = 12000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const NON_NEWS_PATH_SEGMENTS = new Set([
  "about", "about-us", "account", "auth", "career", "careers", "contact", "contact-us",
  "download", "downloads", "job", "jobs", "login", "privacy", "privacy-policy", "register",
  "search", "sign-in", "sign-up", "signin", "signup", "sitemap", "terms", "terms-of-service",
]);
const NON_NEWS_TITLE_SEGMENTS = new Set([
  "about", "about us", "advertisement", "careers", "contact", "contact us", "download", "downloads",
  "home", "homepage", "jobs", "login", "privacy", "privacy policy", "register", "search", "sign in",
  "sign up", "sitemap", "sponsored", "terms", "terms of service",
  "主页", "首页", "关于我们", "联系我们", "下载", "下载客户端", "加入我们", "招聘", "搜索",
  "登录", "注册", "用户协议", "隐私政策", "服务条款", "网站地图", "免责声明", "广告", "推广",
  "主頁", "首頁", "關於我們", "聯絡我們", "下載", "下載客戶端", "加入我們", "招聘", "搜尋",
  "登入", "註冊", "使用者協議", "隱私政策", "服務條款", "網站地圖", "免責聲明", "廣告", "推廣",
]);
const PROMOTIONAL_TITLE = /^\s*(?:(?:[\[【(（]\s*(?:广告|廣告|推广|推廣|赞助|贊助|商业推广|商業推廣|advertisement|sponsored)\s*[\]】)）])|(?:(?:广告|廣告|推广|推廣|赞助|贊助|商业推广|商業推廣|advertisement|sponsored)(?:\s*[:：|｜·—-]|\s+)))/i;
const ARTICLE_PATH_MARKERS = new Set(["article", "blog", "detail", "feature", "news", "post", "review", "story"]);
const ARTICLE_QUERY_KEYS = new Set(["articleid", "contentid", "id", "newsid", "storyid"]);

export async function fetchSourceArticles(source, options = {}) {
  const requestedLimit = Number(options.limit);
  const limit = requestedLimit === 0 ? 12 : Math.max(1, Math.min(12, Number.isFinite(requestedLimit) ? requestedLimit : 5));
  const urls = preferredFeedUrls(source);
  let successfulResponses = 0;
  let lastError = null;
  for (const url of urls) {
    try {
      const response = await fetchText(url, options);
      successfulResponses += 1;
      const parsed = filterLikelyNewsItems(parseFeedDocument(response.text, response.url, source, limit, response.contentType));
      if (parsed.length) return parsed;
      if (looksLikeHtml(response.text, response.contentType)) {
        const discovered = discoverFeedUrls(response.text, response.url);
        for (const feedUrl of discovered.slice(0, 3)) {
          try {
            const feed = await fetchText(feedUrl, options);
            successfulResponses += 1;
            const entries = filterLikelyNewsItems(parseFeedDocument(feed.text, feed.url, source, limit, feed.contentType));
            if (entries.length) return entries;
          } catch (error) {
            lastError = error;
            if (options.onError) options.onError(error, feedUrl);
          }
        }
        const links = extractArticleLinks(response.text, response.url).slice(0, limit);
        if (links.length) return links.map((link, index) => articleFromLink(link, source, index));
        if (isLikelyArticleDocument(response.text)) {
          const article = articleFromHtml(response.text, response.url, source);
          if (isLikelyNewsItem(article)) return [article];
        }
        continue;
      }
    } catch (error) {
      lastError = error;
      if (options.onError) options.onError(error, url);
    }
  }
  if (!successfulResponses && lastError) throw lastError;
  return [];
}

export function parseFeedDocument(text, finalUrl, source = {}, limit = 5, contentType = "") {
  if (isJsonFeed(text, contentType)) return parseJsonFeed(text, finalUrl, source, limit);
  const blocks = [...String(text || "").matchAll(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi)].map((match) => match[0]);
  const entries = blocks.map((block, index) => parseXmlEntry(block, finalUrl, source, index)).filter(Boolean);
  return dedupeArticles(entries).slice(0, limit);
}

export function rankAndDedupe(items, limit = 192) {
  const now = Date.now();
  return dedupeArticles(filterLikelyNewsItems(items))
    .map((item) => ({ ...item, score: item.score || scoreArticle(item, now) }))
    .sort((left, right) => Number(right.score || 0) - Number(left.score || 0))
    .slice(0, limit);
}

export function filterLikelyNewsItems(items) {
  return (Array.isArray(items) ? items : []).filter(isLikelyNewsItem);
}

export function feedCacheOrEmpty(feed) {
  if (feed && Array.isArray(feed.items)) return feed;
  return {
    schemaVersion: 2,
    generatedAt: "",
    items: [],
    localCount: 0,
    publicCount: 0,
    deniedOrigins: [],
  };
}

export function buildTopics(items, limit = 4) {
  const groups = new Map();
  for (const item of items || []) {
    const key = item.categoryKey || item.category || item.host || "news";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return [...groups.entries()]
    .map(([category, group]) => {
      const representative = [...group].sort((a, b) => Number(b.score || 0) - Number(a.score || 0))[0];
      return {
        id: `topic-${hashText(category)}`,
        title: representative?.title || category,
        category,
        categoryKey: representative?.categoryKey || "",
        sourceCount: new Set(group.map((item) => item.host)).size,
        itemCount: group.length,
        latestAt: group.map((item) => item.publishedAt).filter(Boolean).sort().at(-1) || "",
        score: Math.round(Math.max(...group.map((item) => Number(item.score || 0)), 0)),
        representative,
        items: group.slice(0, 6),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function buildFallbackDigest(items, reason = "no-api-key", locale = "zh-CN") {
  const normalizedLocale = normalizeLocale(locale);
  const selected = (items || []).slice(0, 5);
  return {
    schemaVersion: 1,
    locale: normalizedLocale,
    date: localDateKey(),
    generatedAt: new Date().toISOString(),
    status: reason,
    overview: selected.length
      ? [translate(normalizedLocale, "background.digest.organized"), translate(normalizedLocale, "background.digest.configureAiHint")]
      : [translate(normalizedLocale, "background.digest.empty")],
    items: selected.map((item) => ({
      id: item.articleId,
      title: item.title,
      summary: item.excerpt || translate(normalizedLocale, "background.digest.openOriginal"),
      reason: translate(normalizedLocale, "background.digest.highPriority"),
      url: item.url,
      source: item.source,
      host: item.host,
      importanceScore: item.score,
      type: item.externalDiscovery ? "internet" : "bookmark",
    })),
  };
}

function parseXmlEntry(block, finalUrl, source, index) {
  const atomUrl = firstMatch(block, /<link\b[^>]*href=["']([^"']+)["'][^>]*>/i);
  const rawUrl = firstNonEmpty(atomUrl, tagText(block, "link"), tagText(block, "guid"));
  const url = absolutize(rawUrl, finalUrl);
  if (!url) return null;
  const title = cleanText(tagText(block, "title")) || source.title || hostOf(url);
  const description = cleanText(firstNonEmpty(tagText(block, "description"), tagText(block, "summary"), tagText(block, "content")));
  const publishedAt = normalizeDate(firstNonEmpty(tagText(block, "pubDate"), tagText(block, "published"), tagText(block, "updated"), tagText(block, "dc:date")));
  const imageUrl = absolutize(firstNonEmpty(
    firstMatch(block, /<media:(?:content|thumbnail)\b[^>]*url=["']([^"']+)["']/i),
    firstMatch(block, /<enclosure\b[^>]*type=["']image\/[^"']+["'][^>]*url=["']([^"']+)["']/i),
    firstMatch(block, /<img\b[^>]*src=["']([^"']+)["']/i),
  ), finalUrl);
  return articleRecord({ title, url, description, publishedAt, imageUrl, source, index });
}

function parseJsonFeed(text, finalUrl, source, limit) {
  try {
    const data = JSON.parse(text);
    return dedupeArticles((Array.isArray(data.items) ? data.items : []).map((item, index) => {
      const url = absolutize(item.url || item.external_url || item.id, finalUrl);
      if (!url) return null;
      const image = item.image || item.banner_image || item.attachments?.find((entry) => /^image\//.test(entry?.mime_type || ""))?.url || "";
      return articleRecord({
        title: cleanText(item.title) || source.title || hostOf(url),
        url,
        description: cleanText(item.summary || item.content_text || item.content_html),
        publishedAt: normalizeDate(item.date_published || item.date_modified),
        imageUrl: absolutize(image, finalUrl),
        source,
        index,
      });
    }).filter(Boolean)).slice(0, limit);
  } catch {
    return [];
  }
}

function articleFromHtml(html, url, source) {
  return articleRecord({
    title: cleanText(firstNonEmpty(
      firstMatch(html, /<meta\b[^>]*(?:property|name)=["']og:title["'][^>]*content=["']([^"']+)["']/i),
      firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i),
      source.title,
    )),
    url,
    description: cleanText(firstNonEmpty(
      firstMatch(html, /<meta\b[^>]*(?:property|name)=["'](?:description|og:description)["'][^>]*content=["']([^"']+)["']/i),
      htmlToText(html).slice(0, 600),
    )),
    publishedAt: normalizeDate(firstNonEmpty(
      firstMatch(html, /<meta\b[^>]*(?:property|name)=["'](?:article:published_time|datePublished)["'][^>]*content=["']([^"']+)["']/i),
      "",
    )),
    imageUrl: absolutize(firstMatch(html, /<meta\b[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i), url),
    source,
    index: 0,
  });
}

function articleFromLink(link, source, index) {
  return articleRecord({ title: link.title, url: link.url, description: "", publishedAt: "", imageUrl: "", source, index });
}

function articleRecord({ title, url, description, publishedAt, imageUrl, source, index }) {
  const host = hostOf(url);
  const fetchedAt = new Date().toISOString();
  const excerpt = cleanText(description).slice(0, 420);
  return {
    schemaVersion: 1,
    extractorVersion: 1,
    policyVersion: 1,
    articleId: `article-${hashText(normalizeUrl(url))}`,
    entryKey: `article-${hashText(normalizeUrl(url))}`,
    sourceKey: source.key || `source-${hashText(source.url || host)}`,
    source: source.title || host,
    sourceOrigin: safeSourceOrigin(source.url),
    host,
    category: source.category || "",
    categoryKey: source.categoryKey || (source.category ? "" : "news"),
    title: cleanText(title) || source.title || host,
    url,
    excerpt,
    summary: excerpt ? [excerpt] : [],
    imageUrl: imageUrl || "",
    publishedAt: publishedAt || "",
    fetchedAt,
    timeUnverified: !publishedAt,
    externalDiscovery: source.externalDiscovery === true,
    score: Math.max(20, 86 - index * 4),
    scoreBreakdown: { freshness: publishedAt ? 35 : 10, source: 25, position: Math.max(0, 20 - index * 2) },
  };
}

async function fetchText(url, options = {}) {
  try {
    if (typeof options.validateUrl === "function") await options.validateUrl(url);
    const { response, buffer } = await fetchBounded(url, {
      redirect: "error",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers: { accept: "application/rss+xml, application/atom+xml, application/feed+json, application/xml, text/xml, text/html;q=0.9, */*;q=0.5" },
    }, {
      timeoutMs: options.timeoutMs || REQUEST_TIMEOUT_MS,
      maxBytes: MAX_RESPONSE_BYTES,
      validateResponse: options.validateResponse,
    });
    if (!response.ok) {
      throw feedError(
        "SOURCE_HTTP_ERROR",
        "background.error.sourceHttp",
        response.status === 408 || response.status === 429 || response.status >= 500,
        { status: response.status, url: response.url || url },
      );
    }
    return {
      text: decodeResponseBuffer(buffer, response.headers.get("content-type") || ""),
      url: response.url || url,
      contentType: response.headers.get("content-type") || "",
    };
  } catch (error) {
    if (error?.messageKey) throw error;
    if (error?.code === "RESPONSE_TOO_LARGE") {
      throw feedError("SOURCE_RESPONSE_TOO_LARGE", "background.error.sourceTooLarge", false, error.details);
    }
    if (error?.code === "NETWORK_TIMEOUT") {
      throw feedError("SOURCE_TIMEOUT", "background.error.sourceTimeout", true, error.details);
    }
    throw feedError("SOURCE_NETWORK_ERROR", "background.error.sourceNetwork", true, error?.details || { url });
  }
}

function preferredFeedUrls(source) {
  const host = hostOf(source.url);
  return [...new Set([...(PREFERRED_FEEDS[host] || []), source.url].filter(Boolean))];
}

function discoverFeedUrls(html, baseUrl) {
  const urls = [];
  for (const match of String(html || "").matchAll(/<link\b[^>]*(?:type=["'](?:application\/(?:rss|atom)\+xml|application\/feed\+json)["']|rel=["'][^"']*alternate[^"']*["'])[^>]*>/gi)) {
    const href = firstMatch(match[0], /href=["']([^"']+)["']/i);
    if (href) urls.push(absolutize(href, baseUrl));
  }
  return [...new Set(urls.filter(Boolean))];
}

function extractArticleLinks(html, baseUrl) {
  const links = [];
  for (const match of String(html || "").matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = absolutize(match[1], baseUrl);
    const title = cleanText(match[2]);
    if (!url || title.length < 8 || isNonNewsTitle(title) || isNonNewsUrl(url) || !hasArticlePath(url)) continue;
    links.push({ url, title });
  }
  return dedupeBy(links, (item) => normalizeUrl(item.url));
}

function isLikelyNewsItem(item) {
  if (!item || isNonNewsTitle(item.title) || isNonNewsUrl(item.url)) return false;
  if (isRootSourceLanding(item)) return false;
  return true;
}

function isNonNewsTitle(value) {
  const title = cleanText(value);
  if (!title || PROMOTIONAL_TITLE.test(title)) return true;
  return title
    .toLowerCase()
    .split(/\s*(?:[|｜·•»]|-{1,2}|–|—|:|：)\s*/)
    .filter(Boolean)
    .some((segment) => NON_NEWS_TITLE_SEGMENTS.has(segment));
}

function isNonNewsUrl(value) {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) return true;
    return url.pathname
      .toLowerCase()
      .split("/")
      .filter(Boolean)
      .some((segment) => NON_NEWS_PATH_SEGMENTS.has(segment));
  } catch {
    return true;
  }
}

function isRootSourceLanding(item) {
  try {
    const url = new URL(item.url);
    if (!/^\/(?:index(?:\.[a-z0-9]+)?)?$/i.test(url.pathname) || url.search) return false;
    const title = comparableText(item.title);
    const source = comparableText(item.source);
    const host = comparableText(url.hostname.replace(/^www\./i, ""));
    return Boolean(title && (title === source || title === host));
  } catch {
    return false;
  }
}

function hasArticlePath(value) {
  try {
    const url = new URL(value);
    const segments = url.pathname.toLowerCase().split("/").filter(Boolean);
    const yearIndex = segments.findIndex((segment) => /^20\d{2}$/.test(segment));
    if (yearIndex >= 0 && segments.length > yearIndex + 1) return true;
    const markerIndex = segments.findIndex((segment) => ARTICLE_PATH_MARKERS.has(segment));
    if (markerIndex >= 0 && segments.length > markerIndex + 1) return true;
    if (segments.some((segment) => /^(?:article|detail|news|post|story)[-_]\d{3,}(?:\.[a-z0-9]+)?$/.test(segment))) return true;
    return markerIndex >= 0 && [...url.searchParams.keys()].some((key) => ARTICLE_QUERY_KEYS.has(key.toLowerCase()));
  } catch {
    return false;
  }
}

function comparableText(value) {
  return cleanText(value).toLowerCase().replace(/^www\./, "").replace(/[^a-z0-9\u3400-\u9fff]+/gu, "");
}

function isLikelyArticleDocument(html) {
  const type = metaContent(html, ["og:type"]).toLowerCase();
  if (type === "article" || type === "newsarticle") return true;
  return Boolean(normalizeDate(metaContent(html, ["article:published_time", "datepublished"])));
}

function metaContent(html, names) {
  const accepted = new Set(names.map((name) => String(name).toLowerCase()));
  for (const match of String(html || "").matchAll(/<meta\b[^>]*>/gi)) {
    const name = firstMatch(match[0], /(?:property|name)=["']([^"']+)["']/i).toLowerCase();
    if (!accepted.has(name)) continue;
    const content = firstMatch(match[0], /content=["']([^"']*)["']/i);
    if (content) return content;
  }
  return "";
}

function htmlToText(html) {
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

function tagText(block, tag) {
  const escaped = tag.replace(":", "\\:");
  return firstMatch(block, new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`, "i"));
}

function scoreArticle(item, now) {
  const published = Date.parse(item.publishedAt || item.fetchedAt || "") || now;
  const hours = Math.max(0, (now - published) / 3600000);
  return Math.round(Math.max(10, 96 - Math.min(72, hours) * 0.7 + (item.imageUrl ? 4 : 0)));
}

function dedupeArticles(items) {
  return dedupeBy((items || []).filter(Boolean), (item) => normalizeUrl(item.url));
}

function dedupeBy(items, keyFor) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyFor(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isJsonFeed(text, contentType) {
  return /application\/(?:feed\+)?json/i.test(contentType) || /^\s*\{/.test(text) && /"items"\s*:/.test(text.slice(0, 1000));
}

function looksLikeHtml(text, contentType) {
  return /text\/html|application\/xhtml/i.test(contentType) || /<(?:html|head|body)\b/i.test(String(text).slice(0, 1000));
}

function cleanText(value) {
  return decodeEntities(String(value || "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEntities(value) {
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

function absolutize(value, base) {
  try {
    const url = new URL(decodeEntities(String(value || "").trim()), base);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function normalizeUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].forEach((key) => url.searchParams.delete(key));
    return url.href.replace(/\/$/, "");
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

function safeSourceOrigin(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (url.protocol === "https:") return url.origin;
    if (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)) return url.origin;
    return "";
  } catch {
    return "";
  }
}

function normalizeDate(value) {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? new Date(time).toISOString() : "";
}

function firstMatch(text, pattern) {
  return String(text || "").match(pattern)?.[1]?.trim() || "";
}

function firstNonEmpty(...values) {
  return values.find((value) => String(value || "").trim()) || "";
}

function localDateKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function feedError(code, messageKey, retryable = false, details = {}) {
  const messageParams = Number.isFinite(Number(details.status)) ? { status: Number(details.status) } : {};
  const error = new Error(translate("zh-CN", messageKey, messageParams));
  error.code = code;
  error.messageKey = messageKey;
  error.messageParams = messageParams;
  error.retryable = retryable;
  error.details = details;
  return error;
}

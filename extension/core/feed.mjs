import { PREFERRED_FEEDS } from "./constants.mjs";
import { hashText } from "./bookmarks.mjs";
import { normalizeLocale, translate } from "./i18n.mjs";
import { decodeResponseBuffer, fetchBounded } from "./network.mjs";
import { isDisplayableFeedItem } from "./feed-item-policy.mjs";
import {
  extractMarkupImageCandidates,
  extractPageImageCandidates,
  normalizeImageCandidates,
  parseImageAttributes,
} from "./image-candidates.mjs";
import {
  DAILY_DIGEST_SCHEMA_VERSION,
  NEWS_RANKING_POLICY_VERSION,
  buildDailyCandidates,
  dailyCandidateFingerprint,
  newsTimeScope,
  rankNewsItems,
  scoreNewsArticle,
} from "./news-ranking.mjs";

export { isDisplayableFeedItem } from "./feed-item-policy.mjs";
export {
  DAILY_DIGEST_SCHEMA_VERSION,
  NEWS_RANKING_POLICY_VERSION,
  buildDailyCandidates,
  dailyCandidateFingerprint,
} from "./news-ranking.mjs";

const REQUEST_TIMEOUT_MS = 12000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_DECLARED_FEEDS = 3;
const MAX_PROBED_FEEDS = 4;
const MAX_SOURCE_SCAN_ITEMS = 48;
const MIN_SOURCE_SCAN_ITEMS = 12;
const MIN_SEMANTIC_COLLECTION_ARTICLES = 3;
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
const ARTICLE_QUERY_KEYS = new Set(["articleid", "contentid", "id", "newsid", "sid", "storyid"]);
const NEWS_LANDING_PATHS = new Set([...ARTICLE_PATH_MARKERS, "articles", "latest", "posts", "updates"]);

export async function fetchSourceArticles(source, options = {}) {
  const requestedLimit = Number(options.limit);
  const limit = requestedLimit === 0 ? 12 : Math.max(1, Math.min(12, Number.isFinite(requestedLimit) ? requestedLimit : 5));
  const scanLimit = sourceScanLimit(limit);
  const now = options.now ?? Date.now();
  const profile = normalizeFetchProfile(options.profile);
  const candidates = sourceCandidates(source, profile);
  const attempted = new Set();
  const pendingFeeds = [];
  let successfulResponses = 0;
  let lastError = null;
  let landing = null;
  for (const candidate of candidates) {
    const url = candidate.url;
    if (!url || attempted.has(url)) continue;
    attempted.add(url);
    try {
      const response = await fetchText(url, {
        ...options,
        validators: profile.resolvedUrl === url ? profile.validators : null,
      });
      if (response.notModified) {
        return sourceFetchResult([], {
          outcome: "notModified",
          method: candidate.method,
          response,
          pendingFeeds,
        });
      }
      successfulResponses += 1;
      const parsed = parsedResponseItems(response, source, limit, scanLimit, now);
      if (parsed.length) return sourceFetchResult(parsed, { method: candidate.method, response, pendingFeeds });
      if (looksLikeHtml(response.text, response.contentType)) {
        landing ||= response;
        const discovered = discoverFeedUrls(response.text, response.url);
        for (const feedUrl of discovered.slice(0, MAX_DECLARED_FEEDS)) {
          const feedResult = await tryFeedCandidate(feedUrl, "declared-feed", {
            attempted, pendingFeeds, options, source, limit,
          });
          successfulResponses += Number(feedResult.responded);
          if (feedResult.error) lastError = feedResult.error;
          if (feedResult.result) return feedResult.result;
        }
        const collectionPage = isLikelyArticleCollectionPage(response.text);
        const structured = selectSourceArticles(
          extractJsonLdArticles(response.text, response.url, source, scanLimit, { collectionPage }),
          limit,
          now,
        );
        if (structured.length) return sourceFetchResult(structured, { method: "json-ld", response, pendingFeeds });
        const links = extractArticleLinks(response.text, response.url).slice(0, scanLimit);
        if (links.length) {
          const items = selectSourceArticles(links.map((link, index) => articleFromLink(link, {
            ...source,
            fetchOrigin: safeSourceOrigin(response.url),
          }, index)), limit, now);
          return sourceFetchResult(items, { method: "html-links", response, pendingFeeds });
        }
        if (!collectionPage && isLikelyArticleDocument(response.text)) {
          const article = articleFromHtml(response.text, response.url, {
            ...source,
            fetchOrigin: safeSourceOrigin(response.url),
          });
          if (isLikelyNewsItem(article)) return sourceFetchResult([article], { method: "direct-article", response, pendingFeeds });
        }
        continue;
      }
    } catch (error) {
      lastError = error;
      if (error?.code === "ORIGIN_PERMISSION_REQUIRED") {
        const origin = safeSourceOrigin(error?.details?.url || url);
        if (origin && origin !== safeSourceOrigin(source.url)) pendingFeeds.push({ url, origin });
      }
      if (options.onError) options.onError(error, url);
    }
  }
  if (landing) {
    for (const feedUrl of commonFeedUrls(landing.text, landing.url).slice(0, MAX_PROBED_FEEDS)) {
      const feedResult = await tryFeedCandidate(feedUrl, "probed-feed", {
        attempted, pendingFeeds, options, source, limit,
      });
      successfulResponses += Number(feedResult.responded);
      if (feedResult.error) lastError = feedResult.error;
      if (feedResult.result) return feedResult.result;
    }
  }
  if (!successfulResponses && lastError) throw lastError;
  return sourceFetchResult([], { outcome: "empty", response: landing, pendingFeeds });
}

function normalizeFetchProfile(profile) {
  const value = profile && typeof profile === "object" ? profile : {};
  return {
    resolvedUrl: looksLikeAbsoluteUrl(value.resolvedUrl) ? new URL(String(value.resolvedUrl).trim()).href : "",
    validators: {
      etag: cleanHeaderValue(value.validators?.etag || value.etag),
      lastModified: cleanHeaderValue(value.validators?.lastModified || value.lastModified),
    },
    pendingFeedUrl: looksLikeAbsoluteUrl(value.pendingFeed?.url) ? new URL(String(value.pendingFeed.url).trim()).href : "",
  };
}

function sourceCandidates(source, profile) {
  const preferred = preferredFeedUrls(source);
  const candidates = [];
  if (profile.resolvedUrl) candidates.push({ url: profile.resolvedUrl, method: "cached-feed" });
  if (profile.pendingFeedUrl) candidates.push({ url: profile.pendingFeedUrl, method: "declared-feed" });
  for (const url of preferred) {
    candidates.push({
      url,
      method: url === source.url ? "direct" : "preferred-feed",
    });
  }
  return dedupeBy(candidates, (candidate) => candidate.url);
}

async function tryFeedCandidate(url, method, context) {
  const { attempted, pendingFeeds, options, source, limit } = context;
  if (!url || attempted.has(url)) return { responded: false, result: null, error: null };
  attempted.add(url);
  try {
    const response = await fetchText(url, options);
    if (response.notModified) {
      return {
        responded: true,
        result: sourceFetchResult([], { outcome: "notModified", method, response, pendingFeeds }),
        error: null,
      };
    }
    const items = parsedResponseItems(response, source, limit, undefined, options.now ?? Date.now());
    return {
      responded: true,
      result: items.length ? sourceFetchResult(items, { method, response, pendingFeeds }) : null,
      error: null,
    };
  } catch (error) {
    if (error?.code === "ORIGIN_PERMISSION_REQUIRED") {
      const origin = safeSourceOrigin(error?.details?.url || url);
      if (origin && origin !== safeSourceOrigin(source.url)) pendingFeeds.push({ url, origin });
    }
    if (options.onError) options.onError(error, url);
    return { responded: false, result: null, error };
  }
}

function parsedResponseItems(response, source, limit, scanLimit = sourceScanLimit(limit), now = Date.now()) {
  const fetchOrigin = safeSourceOrigin(response.url);
  return selectSourceArticles(
    filterLikelyNewsItems(parseFeedDocument(
      response.text,
      response.url,
      { ...source, fetchOrigin },
      scanLimit,
      response.contentType,
    )),
    limit,
    now,
  );
}

function sourceScanLimit(limit) {
  return Math.min(MAX_SOURCE_SCAN_ITEMS, Math.max(MIN_SOURCE_SCAN_ITEMS, Math.max(1, Number(limit) || 1) * 4));
}

function selectSourceArticles(items, limit, now = Date.now()) {
  const scopeOrder = { today: 0, recent: 1 };
  return (Array.isArray(items) ? items : [])
    .map((item) => {
      const publishedAt = Date.parse(String(item?.publishedAt || ""));
      return {
        item,
        scope: newsTimeScope(item, now),
        score: scoreNewsArticle(item, now).score,
        publishedAt: Number.isFinite(publishedAt) ? publishedAt : 0,
      };
    })
    .sort((left, right) => (scopeOrder[left.scope] ?? 2) - (scopeOrder[right.scope] ?? 2)
      || right.score - left.score
      || right.publishedAt - left.publishedAt
      || Number(left.item?.feedPosition || 0) - Number(right.item?.feedPosition || 0))
    .slice(0, Math.max(0, Number(limit) || 0))
    .map((entry) => entry.item);
}

function sourceFetchResult(items, {
  outcome = "items", method = "", response = null, pendingFeeds = [],
} = {}) {
  const list = Array.isArray(items) ? items : [];
  const pendingFeed = dedupeBy(pendingFeeds, (entry) => entry.origin)[0] || null;
  const reusable = list.length || outcome === "notModified";
  Object.defineProperties(list, {
    outcome: { value: list.length ? "items" : outcome, enumerable: false },
    items: { value: list, enumerable: false },
    displayableItemCount: { value: filterLikelyNewsItems(list).length, enumerable: false },
    method: { value: method, enumerable: false },
    resolvedUrl: { value: reusable ? response?.url || "" : "", enumerable: false },
    fetchOrigin: { value: reusable ? safeSourceOrigin(response?.url || "") : "", enumerable: false },
    validators: { value: reusable ? response?.validators || { etag: "", lastModified: "" } : { etag: "", lastModified: "" }, enumerable: false },
    pendingFeed: { value: pendingFeed, enumerable: false },
  });
  return list;
}

export function parseFeedDocument(text, finalUrl, source = {}, limit = 5, contentType = "") {
  if (isJsonFeed(text, contentType)) return parseJsonFeed(text, finalUrl, source, limit);
  const blocks = [...String(text || "").matchAll(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi)].map((match) => match[0]);
  const entries = blocks.map((block, index) => parseXmlEntry(block, finalUrl, source, index)).filter(Boolean);
  return dedupeArticles(entries).slice(0, limit);
}

export function rankAndDedupe(items, limit = 192, options = {}) {
  return rankNewsItems(dedupeArticles(filterLikelyNewsItems(items)), options).slice(0, limit);
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

export function buildFallbackDigest(items, reason = "no-api-key", locale = "zh-CN", options = {}) {
  const normalizedLocale = normalizeLocale(locale);
  const now = options.now ?? Date.now();
  const selected = options.preselected === true
    ? (Array.isArray(items) ? items : []).slice(0, 12)
    : buildDailyCandidates(items, {
        now,
        limit: 12,
        recentLimit: 3,
        publisherLimit: options.publisherLimit,
        aiRankingEnabled: options.aiRankingEnabled,
      });
  return {
    schemaVersion: DAILY_DIGEST_SCHEMA_VERSION,
    rankingPolicyVersion: NEWS_RANKING_POLICY_VERSION,
    locale: normalizedLocale,
    date: localDateKey(now),
    generatedAt: new Date(now).toISOString(),
    candidateFingerprint: dailyCandidateFingerprint(selected, {
      policyVersion: NEWS_RANKING_POLICY_VERSION,
      publisherLimit: options.publisherLimit,
    }),
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
      publisher: item.publisher || item.source,
      publisherHost: item.publisherHost || item.host,
      publishedAt: item.publishedAt || "",
      eventId: item.eventId || "",
      sourceCount: Number(item.eventSourceCount || 1),
      articleCount: Number(item.eventArticleCount || 1),
      eventConfidence: item.eventConfidence || "single-source",
      timeScope: item.timeScope || "",
      localImportanceScore: Number(item.localImportanceScore ?? item.publicImportanceScore ?? item.score ?? 0),
      importanceScore: Number(item.localImportanceScore ?? item.publicImportanceScore ?? item.score ?? 0),
      type: item.externalDiscovery ? "internet" : "bookmark",
    })),
  };
}

function parseXmlEntry(block, finalUrl, source, index) {
  const entryBase = absolutize(entryBaseUrl(block), finalUrl) || finalUrl;
  const atomUrl = atomEntryUrl(block);
  const guid = tagText(block, "guid");
  const rawUrl = firstNonEmpty(atomUrl, tagText(block, "link"), looksLikeAbsoluteUrl(guid) ? guid : "");
  const url = absolutize(rawUrl, entryBase);
  if (!url) return null;
  const title = cleanText(tagText(block, "title")) || source.title || hostOf(url);
  const description = cleanText(firstNonEmpty(
    tagText(block, "description"),
    tagText(block, "summary"),
    tagText(block, "content:encoded"),
    tagText(block, "content"),
  ));
  const publishedAt = normalizeDate(firstNonEmpty(tagText(block, "pubDate"), tagText(block, "published"), tagText(block, "updated"), tagText(block, "dc:date")));
  const imageUrls = entryImageUrls(block, entryBase);
  const publisher = parseEntryPublisher(block, source);
  return articleRecord({ title, url, description, publishedAt, imageUrls, source, index, ...publisher });
}

function parseJsonFeed(text, finalUrl, source, limit) {
  try {
    const data = JSON.parse(text);
    return dedupeArticles((Array.isArray(data.items) ? data.items : []).map((item, index) => {
      const url = absolutize(item.url || item.external_url || item.id, finalUrl);
      if (!url) return null;
      const imageUrls = normalizeImageCandidates([
        { url: item.image, score: 500, identity: "json feed image" },
        { url: item.banner_image, score: 490, identity: "json feed banner" },
        ...(Array.isArray(item.attachments) ? item.attachments : [])
          .filter((entry) => /^image\//i.test(entry?.mime_type || ""))
          .map((entry, attachmentIndex) => ({
            url: entry.url,
            score: 470 - attachmentIndex,
            identity: `${entry.title || ""} json feed attachment`,
          })),
        ...extractMarkupImageCandidates(item.content_html || "", finalUrl, { limit: 6 })
          .map((url, imageIndex) => ({ url, score: 300 - imageIndex })),
      ], finalUrl, { limit: 3 });
      const author = Array.isArray(item.authors) ? item.authors.find((entry) => entry?.name || entry?.url) : null;
      return articleRecord({
        title: cleanText(item.title) || source.title || hostOf(url),
        url,
        description: cleanText(item.summary || item.content_text || item.content_html),
        publishedAt: normalizeDate(item.date_published || item.date_modified),
        imageUrls,
        source,
        index,
        publisher: cleanText(author?.name || ""),
        publisherUrl: absolutize(author?.url || "", finalUrl),
      });
    }).filter(Boolean)).slice(0, limit);
  } catch {
    return [];
  }
}

function articleFromHtml(html, url, source) {
  const publishedAt = normalizeDate(firstNonEmpty(
    metaContent(html, ["article:published_time", "datepublished"]),
    "",
  ));
  const imageUrls = extractPageImageCandidates(html, url, { limit: 3 });
  return articleRecord({
    title: cleanText(firstNonEmpty(
      metaContent(html, ["og:title"]),
      firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i),
      source.title,
    )),
    url,
    description: cleanText(firstNonEmpty(
      metaContent(html, ["description", "og:description"]),
      htmlToText(html).slice(0, 600),
    )),
    publishedAt,
    imageUrls,
    source,
    index: 0,
    articleDocument: Boolean(publishedAt),
    publisher: source.title || "",
    publisherUrl: source.url || "",
  });
}

function articleFromLink(link, source, index) {
  return articleRecord({
    title: link.title,
    url: link.url,
    description: "",
    publishedAt: "",
    imageUrl: "",
    source,
    index,
    publisher: source.title || "",
    publisherUrl: source.url || "",
  });
}

function articleRecord({
  title, url, description, publishedAt, imageUrl, imageUrls = [], source, index, articleDocument = false,
  publisher = "", publisherUrl = "",
}) {
  const host = hostOf(url);
  const fetchedAt = new Date().toISOString();
  const excerpt = cleanText(description).slice(0, 420);
  const normalizedImageUrls = normalizeImageCandidates(
    imageUrls?.length ? imageUrls : [imageUrl],
    url,
    { limit: 3 },
  );
  const item = {
    schemaVersion: 1,
    extractorVersion: 1,
    policyVersion: 2,
    articleId: `article-${hashText(normalizeUrl(url))}`,
    entryKey: `article-${hashText(normalizeUrl(url))}`,
    sourceKey: source.key || `source-${hashText(source.url || host)}`,
    source: source.title || host,
    sourceOrigin: safeSourceOrigin(source.url),
    fetchOrigin: safeSourceOrigin(source.fetchOrigin || source.url),
    host,
    publisher: cleanText(publisher) || source.title || host,
    publisherHost: hostOf(publisherUrl) || hostOf(source.url) || host,
    category: source.category || "",
    categoryKey: source.categoryKey || (source.category ? "" : "news"),
    title: cleanText(title) || source.title || host,
    url,
    excerpt,
    summary: excerpt ? [excerpt] : [],
    imageUrl: normalizedImageUrls[0] || "",
    imageUrls: normalizedImageUrls,
    imageSource: normalizedImageUrls.length ? "feed" : "",
    publishedAt: publishedAt || "",
    fetchedAt,
    timeUnverified: !publishedAt,
    ...(articleDocument === true ? { articleDocument: true } : {}),
    externalDiscovery: source.externalDiscovery === true,
    feedPosition: index,
  };
  const initial = scoreNewsArticle(item, Date.now());
  return {
    ...item,
    score: initial.score,
    scorePolicyVersion: NEWS_RANKING_POLICY_VERSION,
    rankingEligible: initial.rankingEligible,
    scoreBreakdown: { ...initial.breakdown, corroboration: 0, personalization: 0 },
  };
}

function parseEntryPublisher(block, source) {
  const sourceTag = firstMatch(block, /<source\b[^>]*>([\s\S]*?)<\/source>/i);
  const sourceOpen = String(block || "").match(/<source\b[^>]*>/i)?.[0] || "";
  const publisherUrl = absolutize(parseAttributes(sourceOpen).url || "", source.url || "");
  return {
    publisher: cleanText(sourceTag) || source.title || "",
    publisherUrl: publisherUrl || source.url || "",
  };
}

function entryBaseUrl(block) {
  const open = String(block || "").match(/<(?:item|entry)\b[^>]*>/i)?.[0] || "";
  return parseAttributes(open)["xml:base"] || "";
}

function atomEntryUrl(block) {
  const links = [...String(block || "").matchAll(/<link\b[^>]*\/?>/gi)].map((match) => {
    const attributes = parseAttributes(match[0]);
    return {
      href: attributes.href || "",
      rel: String(attributes.rel || "").toLowerCase(),
      type: String(attributes.type || "").toLowerCase(),
    };
  }).filter((link) => link.href);
  return links.find((link) => (!link.rel || link.rel === "alternate") && (!link.type || /html|xhtml/.test(link.type)))?.href
    || links.find((link) => !link.rel || link.rel === "alternate")?.href
    || "";
}

function entryImageUrls(block, baseUrl) {
  const candidates = [];
  for (const match of String(block || "").matchAll(/<(?:media:(?:content|thumbnail)|enclosure|itunes:image|link)\b[^>]*>/gi)) {
    const tag = match[0];
    const attributes = parseImageAttributes(tag);
    const type = String(attributes.type || "").toLowerCase();
    const medium = String(attributes.medium || "").toLowerCase();
    const value = attributes.url || attributes.href || attributes.src;
    if (!value) continue;
    if (/^<media:content/i.test(tag)) {
      if (medium && medium !== "image") continue;
      if (type && !type.startsWith("image/")) continue;
      if (!medium && !type && !looksLikeImageUrl(value)) continue;
      candidates.push({ url: value, score: 520, width: attributes.width, height: attributes.height, identity: "media content" });
      continue;
    }
    if (/^<media:thumbnail/i.test(tag)) {
      candidates.push({ url: value, score: 470, width: attributes.width, height: attributes.height, identity: "media thumbnail" });
      continue;
    }
    if (/^<enclosure/i.test(tag)) {
      if (type && !type.startsWith("image/")) continue;
      if (!type && !looksLikeImageUrl(value)) continue;
      candidates.push({ url: value, score: 500, identity: "image enclosure" });
      continue;
    }
    if (/^<link/i.test(tag)) {
      if (String(attributes.rel || "").toLowerCase() !== "enclosure" || !type.startsWith("image/")) continue;
      candidates.push({ url: value, score: 490, identity: "atom image enclosure" });
      continue;
    }
    candidates.push({ url: value, score: 430, identity: "itunes image" });
  }
  extractMarkupImageCandidates(block, baseUrl, { limit: 12 }).forEach((url, index) => {
    candidates.push({ url, score: 350 - index, identity: "embedded feed image" });
  });
  return normalizeImageCandidates(candidates, baseUrl, { limit: 3 });
}

function looksLikeImageUrl(value) {
  try {
    return /\.(?:avif|gif|jpe?g|png|svg|webp)(?:[?#]|$)/i.test(new URL(value, "https://ampira.invalid/").href);
  } catch {
    return false;
  }
}

async function fetchText(url, options = {}) {
  try {
    if (typeof options.validateUrl === "function") await options.validateUrl(url);
    const headers = {
      accept: "application/rss+xml, application/atom+xml, application/feed+json, application/xml, text/xml, text/html;q=0.9, */*;q=0.5",
    };
    const etag = cleanHeaderValue(options.validators?.etag);
    const lastModified = cleanHeaderValue(options.validators?.lastModified);
    if (etag) headers["if-none-match"] = etag;
    if (lastModified) headers["if-modified-since"] = lastModified;
    const { response, buffer } = await fetchBounded(url, {
      redirect: "error",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers,
    }, {
      timeoutMs: options.timeoutMs || REQUEST_TIMEOUT_MS,
      maxBytes: MAX_RESPONSE_BYTES,
      validateResponse: options.validateResponse,
    });
    const validators = {
      etag: cleanHeaderValue(response.headers.get("etag") || etag),
      lastModified: cleanHeaderValue(response.headers.get("last-modified") || lastModified),
    };
    if (response.status === 304) {
      return {
        text: "",
        url: response.url || url,
        contentType: response.headers.get("content-type") || "",
        validators,
        notModified: true,
      };
    }
    if (!response.ok) {
      throw feedError(
        "SOURCE_HTTP_ERROR",
        "background.error.sourceHttp",
        response.status === 408 || response.status === 429 || response.status >= 500,
        {
          status: response.status,
          url: response.url || url,
          retryAfter: cleanHeaderValue(response.headers.get("retry-after") || ""),
        },
      );
    }
    return {
      text: decodeResponseBuffer(buffer, response.headers.get("content-type") || ""),
      url: response.url || url,
      contentType: response.headers.get("content-type") || "",
      validators,
      notModified: false,
    };
  } catch (error) {
    if (error?.messageKey || error?.code === "ORIGIN_PERMISSION_REQUIRED") throw error;
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
  for (const match of String(html || "").matchAll(/<link\b[^>]*>/gi)) {
    const attributes = parseAttributes(match[0]);
    const rel = String(attributes.rel || "").toLowerCase().split(/\s+/);
    const type = String(attributes.type || "").toLowerCase();
    if (!attributes.href || !rel.includes("alternate")) continue;
    if (!/(?:application|text)\/(?:rss|atom)\+xml|application\/(?:feed\+)?json|application\/xml|text\/xml/.test(type)
      && !looksLikeFeedHref(attributes.href, baseUrl)) continue;
    urls.push(absolutize(attributes.href, baseUrl));
  }
  for (const match of String(html || "").matchAll(/<a\b[^>]*>/gi)) {
    const attributes = parseAttributes(match[0]);
    if (!attributes.href || !looksLikeFeedHref(attributes.href, baseUrl)) continue;
    urls.push(absolutize(attributes.href, baseUrl));
  }
  return [...new Set(urls.filter(Boolean))];
}

function looksLikeFeedHref(value, baseUrl) {
  try {
    const url = new URL(String(value || "").trim(), baseUrl);
    if (/(?:^|\/)(?:atom|feed|rss)(?:[\/.?_-]|$)|\.(?:atom|json|rss|xml)$/i.test(url.pathname)) return true;
    return [...url.searchParams].some(([key, entry]) => (
      /^(?:feed|format|output)$/i.test(key)
      && /(?:atom|feed|json|rss)/i.test(entry)
    ));
  } catch {
    return false;
  }
}

function extractArticleLinks(html, baseUrl) {
  const semanticSegments = [...String(html || "").matchAll(/<(?:main|article)\b[^>]*>([\s\S]*?)<\/(?:main|article)>/gi)].map((match) => match[1]);
  const links = semanticSegments.flatMap((segment) => extractAnchorLinks(segment, baseUrl, true));
  links.push(...extractAnchorLinks(html, baseUrl, false));
  return dedupeBy(links, (item) => normalizeUrl(item.url));
}

function extractAnchorLinks(html, baseUrl, semantic) {
  const baseOrigin = safeSourceOrigin(baseUrl);
  const links = [];
  for (const match of String(html || "").matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attributes = parseAttributes(`<a ${match[1]}>`);
    const url = absolutize(attributes.href || "", baseUrl);
    const title = cleanText(firstNonEmpty(attributes["aria-label"], attributes.title, match[2]));
    if (!url || safeSourceOrigin(url) !== baseOrigin || title.length < 8 || isNonNewsTitle(title) || isNonNewsUrl(url)) continue;
    if (!hasArticlePath(url) && !(semantic && hasSlugArticlePath(url))) continue;
    links.push({ url, title });
  }
  return links;
}

function hasSlugArticlePath(value) {
  try {
    const url = new URL(value);
    const segments = url.pathname.split("/").filter(Boolean);
    if (!segments.length || segments.length === 1 && NEWS_LANDING_PATHS.has(segments[0].toLowerCase())) return false;
    const tail = decodeURIComponent(segments.at(-1)).replace(/\.[a-z0-9]{1,6}$/i, "");
    return segments.length >= 2 && tail.length >= 6
      || tail.length >= 10 && /[-_]/.test(tail)
      || /\d{4,}/.test(tail);
  } catch {
    return false;
  }
}

function commonFeedUrls(html, baseUrl) {
  let origin;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    return [];
  }
  const candidates = [];
  if (/wp-content|wordpress/i.test(html)) candidates.push("/feed/");
  if (/ghost/i.test(metaContent(html, ["generator"]))) candidates.push("/rss/");
  candidates.push("/feed/", "/rss.xml", "/feed.xml", "/index.xml");
  return [...new Set(candidates)].map((pathname) => new URL(pathname, origin).href).slice(0, MAX_PROBED_FEEDS);
}

function extractJsonLdArticles(html, baseUrl, source, limit, { collectionPage = false } = {}) {
  const records = [];
  for (const match of String(html || "").matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attributes = parseAttributes(`<script ${match[1]}>`);
    if (String(attributes.type || "").toLowerCase() !== "application/ld+json") continue;
    let data;
    try {
      data = JSON.parse(match[2].trim());
    } catch {
      continue;
    }
    visitJsonLd(data, (node) => {
      if (records.length >= limit) return;
      const types = (Array.isArray(node?.["@type"]) ? node["@type"] : [node?.["@type"]])
        .map((value) => String(value || "").toLowerCase());
      const articleType = types.some((type) => ["article", "newsarticle", "blogposting"].includes(type));
      const listItem = types.includes("listitem");
      if (!articleType && !listItem) return;
      const target = listItem && node.item && typeof node.item === "object" ? node.item : node;
      const mainEntity = typeof target.mainEntityOfPage === "object" ? target.mainEntityOfPage?.["@id"] || target.mainEntityOfPage?.url : target.mainEntityOfPage;
      const url = absolutize(firstNonEmpty(target.url, mainEntity, target["@id"], node.url), baseUrl);
      const title = cleanText(firstNonEmpty(target.headline, target.name, node.name));
      if (!url || !title || isNonNewsUrl(url) || isNonNewsTitle(title)) return;
      if (articleType && collectionPage && normalizeUrl(url) === normalizeUrl(baseUrl)) return;
      const images = Array.isArray(target.image) ? target.image : [target.image];
      const imageUrls = normalizeImageCandidates(images.map((image, imageIndex) => ({
        url: typeof image === "object" ? image?.url || image?.contentUrl : image,
        score: 500 - imageIndex,
        identity: "json-ld article image",
      })), baseUrl, { limit: 3 });
      records.push(articleRecord({
        title,
        url,
        description: cleanText(target.description || ""),
        publishedAt: normalizeDate(target.datePublished || target.dateModified),
        imageUrls,
        source: { ...source, fetchOrigin: safeSourceOrigin(baseUrl) },
        index: records.length,
        articleDocument: true,
        publisher: cleanText(target.publisher?.name || target.author?.name || ""),
        publisherUrl: absolutize(target.publisher?.url || target.author?.url || "", baseUrl),
      }));
    });
  }
  return dedupeArticles(filterLikelyNewsItems(records)).slice(0, limit);
}

function visitJsonLd(value, visitor, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry) => visitJsonLd(entry, visitor, seen));
    return;
  }
  visitor(value);
  Object.values(value).forEach((entry) => visitJsonLd(entry, visitor, seen));
}

function isLikelyNewsItem(item) {
  if (!item || isNonNewsTitle(item.title) || isNonNewsUrl(item.url)) return false;
  if (isRootSourceLanding(item)) return false;
  if (!isDisplayableFeedItem(item)) return false;
  return true;
}

function isLikelyArticleCollectionPage(html) {
  const markup = String(html || "");
  const articleCount = [...markup.matchAll(/<article\b/gi)].length;
  if (articleCount < MIN_SEMANTIC_COLLECTION_ARTICLES) return false;
  if (!/<h1\b/i.test(markup)) return true;
  if (/"@type"\s*:\s*(?:\[\s*)?"ItemList"/i.test(markup)) return true;
  return /<(?:a|link)\b[^>]*\brel\s*=\s*["'][^"']*\bnext\b[^"']*["']/i.test(markup);
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
    const segments = url.pathname.toLowerCase().split("/").filter(Boolean);
    if (!segments.length) return true;
    if (segments.length === 1 && /^index(?:\.[a-z0-9]+)?$/i.test(segments[0])) return true;
    if (item.articleDocument === true) return false;
    const hasArticleIdentity = [...url.searchParams.keys()].some((key) => ARTICLE_QUERY_KEYS.has(key.toLowerCase()));
    return segments.length === 1 && NEWS_LANDING_PATHS.has(segments[0]) && !hasArticleIdentity;
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
    const attributes = parseAttributes(match[0]);
    const name = String(attributes.property || attributes.name || "").toLowerCase();
    if (!accepted.has(name)) continue;
    const content = attributes.content || "";
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
  return stripCdata(firstMatch(block, new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`, "i")));
}

function stripCdata(value) {
  return String(value || "").replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/i, "$1").trim();
}

function parseAttributes(tag) {
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
    const raw = decodeEntities(String(value || "").trim());
    if (!raw) return "";
    const url = new URL(raw, base);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function looksLikeAbsoluteUrl(value) {
  return /^https?:\/\//i.test(stripCdata(value));
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

function cleanHeaderValue(value) {
  return String(value || "").replace(/[\r\n]/g, "").trim().slice(0, 1024);
}

function localDateKey(value = Date.now()) {
  const now = new Date(value);
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

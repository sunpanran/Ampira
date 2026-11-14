import { hashText, isNewsSourceExcluded } from "./bookmarks.mjs";

export const MAX_CUSTOM_FEEDS = 50;
export const MAX_CUSTOM_FEED_TITLE = 80;
export const MAX_CUSTOM_FEED_URL = 2048;

export function normalizeCustomFeedUrl(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > MAX_CUSTOM_FEED_URL) return "";
  try {
    const url = new URL(text);
    if (url.username || url.password) return "";
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) return "";
    url.hash = "";
    return url.href.length <= MAX_CUSTOM_FEED_URL ? url.href : "";
  } catch {
    return "";
  }
}

export function normalizeCustomFeeds(value) {
  const seen = new Set();
  const feeds = [];
  for (const entry of Array.isArray(value) ? value : []) {
    const url = normalizeCustomFeedUrl(entry?.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    feeds.push({
      url,
      title: String(entry?.title || "").replace(/\s+/g, " ").trim().slice(0, MAX_CUSTOM_FEED_TITLE) || new URL(url).hostname,
      enabled: entry?.enabled !== false,
    });
    if (feeds.length === MAX_CUSTOM_FEEDS) break;
  }
  return feeds;
}

export function customFeedSource(feed) {
  return {
    ...feed,
    key: `custom-feed-${hashText(feed.url)}`,
    host: new URL(feed.url).hostname.toLowerCase().replace(/^www\./, ""),
    cardType: "news",
    sourceKind: "custom-feed",
    externalDiscovery: false,
  };
}

export function customFeedSources(settings) {
  return normalizeCustomFeeds(settings?.customFeeds)
    .filter(feed => feed.enabled)
    .map(customFeedSource)
    .filter(feed => !isNewsSourceExcluded(feed, settings?.excludedNewsSources));
}

export function uniqueFeedSources(sources) {
  const seen = new Set();
  return sources.filter(source => {
    const url = normalizeCustomFeedUrl(source.url) || source.url;
    if (seen.has(url)) return false;
    seen.add(url);
    return true;
  });
}

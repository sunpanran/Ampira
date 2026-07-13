import { normalizeLocale } from "./i18n.mjs";

const GOOGLE_NEWS_URLS = Object.freeze({
  "zh-CN": "https://news.google.com/rss?hl=zh-CN&gl=CN&ceid=CN:zh-Hans",
  "zh-Hant": "https://news.google.com/rss?hl=zh-TW&gl=TW&ceid=TW:zh-Hant",
  en: "https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en",
});
const GOOGLE_NEWS_IDS = Object.freeze({
  "zh-CN": "google-news-zh-cn",
  "zh-Hant": "google-news-zh-hant",
  en: "google-news-en",
});

export const PUBLIC_FEED_CATALOG = Object.freeze({
  "google-news": Object.freeze({
    id: "google-news",
    title: "Google News",
    ids: GOOGLE_NEWS_IDS,
    urls: GOOGLE_NEWS_URLS,
    categoryKey: "global",
    coverageGroup: "headlines",
  }),
  "bbc-world": Object.freeze({
    id: "bbc-world",
    title: "BBC World",
    url: "https://feeds.bbci.co.uk/news/world/rss.xml",
    categoryKey: "international",
    coverageGroup: "headlines",
  }),
  "the-verge": Object.freeze({
    id: "the-verge",
    title: "The Verge",
    url: "https://www.theverge.com/rss/index.xml",
    categoryKey: "technology",
    coverageGroup: "technology",
  }),
  macrumors: Object.freeze({
    id: "macrumors",
    title: "MacRumors",
    url: "https://feeds.macrumors.com/MacRumors-Front",
    categoryKey: "consumerTechnology",
    coverageGroup: "technology",
  }),
  ithome: Object.freeze({
    id: "ithome",
    title: "IT之家",
    url: "https://www.ithome.com/rss/",
    categoryKey: "technology",
    coverageGroup: "technology",
  }),
  solidot: Object.freeze({
    id: "solidot",
    title: "Solidot",
    url: "https://www.solidot.org/index.rss",
    categoryKey: "technology",
    coverageGroup: "technology",
  }),
});

export const PUBLIC_FEED_PACKS = Object.freeze({
  "zh-CN": Object.freeze(["google-news", "bbc-world", "ithome", "solidot"]),
  "zh-Hant": Object.freeze(["google-news", "bbc-world", "the-verge", "macrumors"]),
  en: Object.freeze(["google-news", "bbc-world", "the-verge", "macrumors"]),
});

export function publicFeedsForLocale(locale) {
  const normalizedLocale = normalizeLocale(locale);
  return (PUBLIC_FEED_PACKS[normalizedLocale] || PUBLIC_FEED_PACKS["zh-CN"]).map((id) => {
    const definition = PUBLIC_FEED_CATALOG[id];
    const resolvedId = definition.ids?.[normalizedLocale] || definition.id;
    return {
      id: resolvedId,
      key: `public-${resolvedId}`,
      title: definition.title,
      url: definition.urls?.[normalizedLocale] || definition.url,
      categoryKey: definition.categoryKey,
      coverageGroup: definition.coverageGroup,
    };
  });
}

import { normalizeLocale } from "./locale.mjs";

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
  "google-news": feed({
    id: "google-news",
    title: "Google News",
    ids: GOOGLE_NEWS_IDS,
    urls: GOOGLE_NEWS_URLS,
    contentLocales: { "zh-CN": "zh-CN", "zh-Hant": "zh-Hant", en: "en" },
    categoryKey: "global",
    coverageGroup: "headlines",
  }),
  chinanews: feed({
    id: "chinanews",
    title: "中新网",
    url: "https://www.chinanews.com.cn/rss/scroll-news.xml",
    contentLocale: "zh-CN",
    categoryKey: "international",
    coverageGroup: "headlines",
  }),
  "36kr": feed({
    id: "36kr",
    title: "36氪",
    url: "https://36kr.com/feed",
    contentLocale: "zh-CN",
    categoryKey: "business",
    coverageGroup: "headlines",
  }),
  ithome: feed({
    id: "ithome",
    title: "IT之家",
    url: "https://www.ithome.com/rss/",
    contentLocale: "zh-CN",
    categoryKey: "technology",
    coverageGroup: "technology",
  }),
  sspai: feed({
    id: "sspai",
    title: "少数派",
    url: "https://sspai.com/feed",
    contentLocale: "zh-CN",
    categoryKey: "consumerTechnology",
    coverageGroup: "technology",
  }),
  ifanr: feed({
    id: "ifanr",
    title: "爱范儿",
    url: "https://www.ifanr.com/feed",
    contentLocale: "zh-CN",
    categoryKey: "technology",
    coverageGroup: "technology",
  }),
  "cna-world": feed({
    id: "cna-world",
    title: "中央社国际",
    url: "https://feeds.feedburner.com/rsscna/intworld",
    contentLocale: "zh-Hant",
    categoryKey: "international",
    coverageGroup: "headlines",
  }),
  "pts-news": feed({
    id: "pts-news",
    title: "公视新闻网",
    url: "https://news.pts.org.tw/xml/newsfeed.xml",
    contentLocale: "zh-Hant",
    categoryKey: "global",
    coverageGroup: "headlines",
  }),
  "technews-tw": feed({
    id: "technews-tw",
    title: "科技新报",
    url: "https://technews.tw/feed/",
    contentLocale: "zh-Hant",
    categoryKey: "technology",
    coverageGroup: "technology",
  }),
  "ithome-tw": feed({
    id: "ithome-tw",
    title: "iThome",
    url: "https://www.ithome.com.tw/rss",
    contentLocale: "zh-Hant",
    categoryKey: "technology",
    coverageGroup: "technology",
  }),
  pansci: feed({
    id: "pansci",
    title: "泛科学",
    url: "https://pansci.asia/feed",
    contentLocale: "zh-Hant",
    categoryKey: "science",
    coverageGroup: "technology",
  }),
  "bbc-world": feed({
    id: "bbc-world",
    title: "BBC World",
    url: "https://feeds.bbci.co.uk/news/world/rss.xml",
    contentLocale: "en",
    categoryKey: "international",
    coverageGroup: "headlines",
  }),
  "npr-world": feed({
    id: "npr-world",
    title: "NPR World",
    url: "https://feeds.npr.org/1004/rss.xml",
    contentLocale: "en",
    categoryKey: "international",
    coverageGroup: "headlines",
  }),
  "the-verge": feed({
    id: "the-verge",
    title: "The Verge",
    url: "https://www.theverge.com/rss/index.xml",
    contentLocale: "en",
    categoryKey: "technology",
    coverageGroup: "technology",
  }),
  "ars-technica": feed({
    id: "ars-technica",
    title: "Ars Technica",
    url: "https://feeds.arstechnica.com/arstechnica/index",
    contentLocale: "en",
    categoryKey: "technology",
    coverageGroup: "technology",
  }),
  macrumors: feed({
    id: "macrumors",
    title: "MacRumors",
    url: "https://feeds.macrumors.com/MacRumors-Front",
    contentLocale: "en",
    categoryKey: "consumerTechnology",
    coverageGroup: "technology",
  }),
});

export const PUBLIC_FEED_PACKS = Object.freeze({
  "zh-CN": Object.freeze(["google-news", "chinanews", "36kr", "ithome", "sspai", "ifanr"]),
  "zh-Hant": Object.freeze(["google-news", "cna-world", "pts-news", "technews-tw", "ithome-tw", "pansci"]),
  en: Object.freeze(["google-news", "bbc-world", "npr-world", "the-verge", "ars-technica", "macrumors"]),
});

export const PUBLIC_FEED_AI_PACKS = Object.freeze({
  "zh-CN": Object.freeze(["cna-world", "bbc-world", "npr-world"]),
  "zh-Hant": Object.freeze(["chinanews", "bbc-world", "npr-world"]),
  en: Object.freeze(["chinanews", "cna-world", "pts-news"]),
});

export function publicFeedsForLocale(locale, { includeAiOnly = false } = {}) {
  const normalizedLocale = normalizeLocale(locale);
  const nativeIds = PUBLIC_FEED_PACKS[normalizedLocale] || PUBLIC_FEED_PACKS["zh-CN"];
  const aiIds = includeAiOnly ? PUBLIC_FEED_AI_PACKS[normalizedLocale] || [] : [];
  const nativeSet = new Set(nativeIds);
  return [...nativeIds, ...aiIds].map((id) => {
    const definition = PUBLIC_FEED_CATALOG[id];
    const resolvedId = definition.ids?.[normalizedLocale] || definition.id;
    return {
      id: resolvedId,
      key: `public-${resolvedId}`,
      title: definition.title,
      url: definition.urls?.[normalizedLocale] || definition.url,
      contentLocale: definition.contentLocales?.[normalizedLocale] || definition.contentLocale,
      accessTier: nativeSet.has(id) ? "native" : "ai",
      categoryKey: definition.categoryKey,
      coverageGroup: definition.coverageGroup,
    };
  });
}

function feed(definition) {
  return Object.freeze({
    ...definition,
    ...(definition.contentLocales ? { contentLocales: Object.freeze(definition.contentLocales) } : {}),
  });
}

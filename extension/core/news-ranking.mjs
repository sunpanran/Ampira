export const NEWS_RANKING_POLICY_VERSION = 4;
export const DAILY_DIGEST_SCHEMA_VERSION = 4;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const EVENT_WINDOW_MS = 36 * HOUR_MS;
const HIGH_CONFIDENCE_SINGLE_MAX_AGE_MS = 12 * HOUR_MS;
const FUTURE_SKEW_MS = 15 * 60 * 1000;
const FEEDBACK_WINDOW_MS = 30 * DAY_MS;
const FEEDBACK_HALF_LIFE_MS = 14 * DAY_MS;
const GENERIC_EVENT_TERMS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "is", "it", "of", "on", "or", "that", "the", "to", "with",
  "announce", "announced", "announcement", "breaking", "launch", "launched", "new", "news", "official",
  "release", "released", "report", "reported", "update", "updated",
  "发布", "發佈", "推出", "上线", "上線", "更新", "宣布", "正式", "最新", "消息", "报道", "報道", "新闻", "新聞",
]);
const HIGH_IMPACT = /(?:地震|台风|颱風|洪水|火灾|火災|战争|戰爭|冲突|衝突|袭击|襲擊|事故|灾害|災害|疫情|召回|漏洞|数据泄露|資料外洩|宕机|當機|中断|中斷|禁令|制裁|判决|判決|监管|監管|政策|法律|法规|法規|选举|選舉|辞职|辭職|破产|破產|裁员|裁員|并购|併購|停产|停產|涨价|漲價|降价|降價|earthquake|typhoon|flood|wildfire|war|conflict|attack|outage|breach|vulnerability|recall|ban|sanction|regulation|law|election|resign|bankrupt|layoff|acquisition)/i;
const MATERIAL_CHANGE = /(?:发布|發佈|推出|上线|上線|开放|開放|关闭|關閉|停止|终止|終止|取消|调整|調整|更新|突破|正式|宣布|release|launch|announce|discontinue|shutdown|update)/i;
const PROMOTIONAL = /(?:广告|廣告|推广|推廣|赞助|贊助|优惠|優惠|折扣|促销|促銷|秒杀|秒殺|领券|領券|众筹|眾籌|预购|預購|开售|開售|好价|好價|购买指南|購買指南|advertorial|sponsored|sale|discount|coupon|pre-?order|buying guide)/i;
const SOFT_CONTENT = /(?:开箱|開箱|体验|體驗|上手|测评|測評|评测|評測|教程|技巧|清单|清單|盘点|盤點|推荐|推薦|随笔|隨筆|游记|遊記|周报|週報|月报|月報|壁纸|桌面|效率工具|unboxing|hands-on|review|tutorial|tips|roundup|recommend|best\s+\d+|top\s+\d+)/i;
const UNCERTAIN = /(?:传闻|傳聞|爆料|据称|據稱|或将|或將|可能|疑似|rumou?r|leak|reportedly|may\s|might\s)/i;

export function rankNewsItems(items, options = {}) {
  const now = finiteTime(options.now, Date.now());
  const profile = buildPersonalizationProfile(options.feedback, now);
  const personalized = options.personalizedRankingEnabled !== false;
  const aiRankingEnabled = options.aiRankingEnabled === true;
  const scored = (Array.isArray(items) ? items : []).map((item) => {
    const neutral = scoreNewsArticle(item, now);
    const personalization = personalized ? personalizationAdjustment(item, profile) : 0;
    return {
      ...item,
      neutralImportanceScore: neutral.score,
      baseImportanceScore: clampScore(neutral.score + (aiRankingEnabled ? 0 : personalization)),
      rankingEligible: neutral.rankingEligible,
      scorePolicyVersion: NEWS_RANKING_POLICY_VERSION,
      scoreBreakdown: {
        ...neutral.breakdown,
        corroboration: 0,
        personalization,
      },
    };
  });
  return annotateEventClusters(scored, now)
    .sort((left, right) => Number(right.score || 0) - Number(left.score || 0)
      || (aiRankingEnabled
        ? Number(right.scoreBreakdown?.personalization || 0) - Number(left.scoreBreakdown?.personalization || 0)
        : 0)
      || verifiedTime(right) - verifiedTime(left));
}

export function scoreNewsArticle(item, nowValue = Date.now()) {
  const now = finiteTime(nowValue, Date.now());
  const published = verifiedTime(item);
  const age = published ? now - published : Number.POSITIVE_INFINITY;
  const futureInvalid = Boolean(published && age < -FUTURE_SKEW_MS);
  const effectiveAge = published ? Math.max(0, age) : Number.POSITIVE_INFINITY;
  const freshness = freshnessScore(effectiveAge);
  const title = String(item?.title || "").trim();
  const excerpt = String(item?.excerpt || "").trim();
  const summaryText = Array.isArray(item?.summary) ? item.summary.join(" ").trim() : "";
  const searchable = `${title} ${excerpt}`.toLowerCase();
  const titleImpact = HIGH_IMPACT.test(title);
  const bodyImpact = HIGH_IMPACT.test(searchable);
  const material = MATERIAL_CHANGE.test(searchable);
  const evidence = /(?:\b\d+(?:[.,]\d+)?%?\b|\d+[万萬亿億]|million|billion|trillion)/i.test(searchable);
  const impact = Math.min(32,
    (titleImpact ? 24 : (bodyImpact ? 18 : 0))
    + (material ? (bodyImpact ? 5 : 2) : 0)
    + (evidence && bodyImpact ? 3 : 0));
  const bodyLength = Array.from(excerpt || summaryText).length;
  const informationQuality = Math.min(18,
    (published ? 5 : 0)
    + (bodyLength >= 80 ? 7 : (bodyLength >= 30 ? 4 : 0))
    + (Array.from(title).length >= 12 && Array.from(title).length <= 180 ? 4 : 0)
    + (publisherIdentity(item) ? 2 : 0));
  const position = Math.max(0, 3 - Math.max(0, Number(item?.feedPosition || 0)));
  const promotionalPenalty = PROMOTIONAL.test(`${title} ${excerpt.slice(0, 180)}`) ? 35 : 0;
  const softContentPenalty = SOFT_CONTENT.test(title) ? 18 : 0;
  const uncertainPenalty = UNCERTAIN.test(title) ? 10 : 0;
  const unverifiedPenalty = published ? 0 : 12;
  const futurePenalty = futureInvalid ? 20 : 0;
  const emptyPenalty = !bodyLength && !bodyImpact ? 8 : 0;
  const penalties = promotionalPenalty + softContentPenalty + uncertainPenalty + unverifiedPenalty + futurePenalty + emptyPenalty;
  const score = clampScore(freshness + impact + informationQuality + position - penalties);
  const meaningfulTitle = Array.from(title).length >= 8;
  const readableOrImportant = bodyLength >= 30 || impact >= 18;
  return {
    score,
    rankingEligible: Boolean(published && !futureInvalid && meaningfulTitle && !promotionalPenalty && readableOrImportant),
    breakdown: {
      freshness,
      impact,
      informationQuality,
      position,
      penalties,
    },
  };
}

export function buildDailyCandidates(items, options = {}) {
  const now = finiteTime(options.now, Date.now());
  const limit = Math.max(1, Math.min(24, Math.floor(Number(options.limit) || 12)));
  const recentLimit = Math.max(0, Math.floor(options.recentLimit === undefined ? 3 : Number(options.recentLimit) || 0));
  const publisherLimit = Math.max(0, Math.min(10, Math.floor(Number(options.publisherLimit) || 0)));
  const aiRankingEnabled = options.aiRankingEnabled === true;
  const representatives = uniqueByEvent((Array.isArray(items) ? items : [])
    .filter((item) => item?.eventRepresentative !== false)
    .filter((item) => item?.rankingEligible === true)
    .map((item) => ({ ...item, timeScope: newsTimeScope(item, now) }))
    .filter((item) => item.timeScope));
  const compare = (left, right) => (aiRankingEnabled
    ? publicImportance(right) - publicImportance(left)
      || Number(right.scoreBreakdown?.personalization || 0) - Number(left.scoreBreakdown?.personalization || 0)
    : localImportance(right) - localImportance(left))
    || verifiedTime(right) - verifiedTime(left);
  const today = representatives.filter((item) => item.timeScope === "today").sort(compare);
  const recent = representatives.filter((item) => item.timeScope === "recent").sort(compare).slice(0, recentLimit);
  return diversifyPublishers([...today, ...recent], limit, publisherLimit);
}

export function newsTimeScope(item, nowValue = Date.now()) {
  const now = finiteTime(nowValue, Date.now());
  const published = verifiedTime(item);
  if (!published || published - now > FUTURE_SKEW_MS) return "";
  if (localDateKey(published) === localDateKey(now)) return "today";
  return now - published <= DAY_MS ? "recent" : "";
}

export function dailyCandidateFingerprint(items, options = {}) {
  const policy = Number(options.policyVersion || NEWS_RANKING_POLICY_VERSION);
  const publisherLimit = Math.max(0, Math.floor(Number(options.publisherLimit) || 0));
  const content = (Array.isArray(items) ? items : []).map((item) => [
    item.eventId || item.articleId || item.entryKey || item.url || "",
    item.publishedAt || "",
    Number(item.eventSourceCount || 1),
    item.eventConfidence || "single-source",
    item.timeScope || "",
  ].join("|")).join("\n");
  return `ranking-${policy}-${stableHash(`${publisherLimit}\n${content}`)}`;
}

export function publisherIdentity(item) {
  return String(item?.publisherHost || item?.publisher || item?.host || item?.sourceKey || item?.source || "")
    .trim().toLowerCase();
}

export function publicImportance(item) {
  const score = Number(item?.publicImportanceScore ?? item?.neutralImportanceScore ?? item?.baseImportanceScore ?? item?.score ?? 0);
  return Number.isFinite(score) ? score : 0;
}

function localImportance(item) {
  const score = Number(item?.localImportanceScore ?? item?.baseImportanceScore ?? item?.score ?? 0);
  return Number.isFinite(score) ? score : 0;
}

export function localDateKey(value = Date.now()) {
  const date = new Date(finiteTime(value, Date.now()));
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function annotateEventClusters(items, now) {
  const ordered = [...items].sort((left, right) => Number(right.neutralImportanceScore || 0) - Number(left.neutralImportanceScore || 0)
    || verifiedTime(right) - verifiedTime(left));
  const clusters = [];
  for (const item of ordered) {
    const signature = eventSignature(item.title);
    const published = verifiedTime(item);
    let cluster = null;
    if (signature.core && published) {
      let bestScore = -1;
      for (const candidate of clusters) {
        const nextOldest = Math.min(candidate.oldestPublished, published);
        const nextNewest = Math.max(candidate.newestPublished, published);
        if (nextNewest - nextOldest > EVENT_WINDOW_MS) continue;
        if (candidate.entries.some((entry) => numbersConflict(entry.signature.numericFacts, signature.numericFacts))) continue;
        const score = Math.max(...candidate.entries.map((entry) => signatureMatchScore(entry.signature, signature)));
        if (score > bestScore) {
          cluster = candidate;
          bestScore = score;
        }
      }
    }
    if (!cluster) {
      cluster = {
        oldestPublished: published || now,
        newestPublished: published || now,
        entries: [],
      };
      clusters.push(cluster);
    }
    cluster.oldestPublished = Math.min(cluster.oldestPublished, published || now);
    cluster.newestPublished = Math.max(cluster.newestPublished, published || now);
    cluster.entries.push({ item, signature, published });
  }
  const output = [];
  for (const cluster of clusters) {
    const representativeEntry = [...cluster.entries].sort((left, right) => compareRepresentative(left.item, right.item))[0];
    const representative = representativeEntry.item;
    const publisherCount = new Set(cluster.entries.map((entry) => publisherIdentity(entry.item)).filter(Boolean)).size || 1;
    const corroboration = publisherCount >= 4 ? 12 : (publisherCount === 3 ? 9 : (publisherCount === 2 ? 6 : 0));
    const signatureIdentity = [
      representativeEntry.signature.core,
      numericFactIdentity(representativeEntry.signature.numericFacts),
      Math.floor(cluster.oldestPublished / EVENT_WINDOW_MS).toString(36),
    ].filter(Boolean).join("|");
    const eventId = `event-${stableHash(signatureIdentity || representative.articleId || representative.url || representative.title)}`;
    for (const { item } of cluster.entries) {
      const eventRepresentative = item === representative;
      const publicScore = clampScore(Number(item.neutralImportanceScore || 0) + (eventRepresentative ? corroboration : 0));
      const localScore = clampScore(Number(item.baseImportanceScore || item.neutralImportanceScore || 0) + (eventRepresentative ? corroboration : 0));
      const eventConfidence = publisherCount >= 2
        ? "corroborated"
        : (eventRepresentative && isHighConfidenceSingleSource(item, now)
            ? "high-confidence-single"
            : "single-source");
      output.push({
        ...item,
        eventId,
        eventRepresentative,
        eventSourceCount: publisherCount,
        eventArticleCount: cluster.entries.length,
        eventConfidence,
        publicImportanceScore: publicScore,
        localImportanceScore: localScore,
        score: localScore,
        rankingEligible: item.rankingEligible === true || Boolean(
          publisherCount >= 2
          && verifiedTime(item)
          && verifiedTime(item) - now <= FUTURE_SKEW_MS
          && Array.from(String(item.title || "")).length >= 8
          && Number(item.scoreBreakdown?.penalties || 0) < 35
        ),
        scoreBreakdown: {
          ...(item.scoreBreakdown || {}),
          corroboration: eventRepresentative ? corroboration : 0,
        },
      });
    }
  }
  return output;
}

function isHighConfidenceSingleSource(item, now) {
  const published = verifiedTime(item);
  const age = published ? now - published : Number.POSITIVE_INFINITY;
  return item?.rankingEligible === true
    && published > 0
    && age >= 0
    && age <= HIGH_CONFIDENCE_SINGLE_MAX_AGE_MS
    && localDateKey(published) === localDateKey(now)
    && Array.from(String(item?.excerpt || "").trim()).length >= 30
    && Number(item?.neutralImportanceScore || 0) >= 70
    && Number(item?.scoreBreakdown?.impact || 0) >= 24
    && Number(item?.scoreBreakdown?.penalties || 0) === 0
    && Boolean(publisherIdentity(item));
}

function compareRepresentative(left, right) {
  const qualityDelta = contentQuality(right) - contentQuality(left);
  return qualityDelta
    || Number(right.neutralImportanceScore || 0) - Number(left.neutralImportanceScore || 0)
    || verifiedTime(right) - verifiedTime(left);
}

function contentQuality(item) {
  const excerptLength = Array.from(String(item?.excerpt || "")).length;
  return (item?.publishedAt ? 8 : 0) + Math.min(8, Math.floor(excerptLength / 40)) + (item?.imageUrl ? 1 : 0);
}

function eventSignature(value) {
  const normalized = String(value || "").normalize("NFKC").toLowerCase()
    .replace(/\s*(?:[|｜·•»]|-{1,2}|–|—)\s*([^|｜·•»–—-]{1,40})$/u, (match, suffix) => (/\d/.test(suffix) ? match : " "))
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  const terms = new Set(normalized.split(/\s+/).filter((term) => (
    term.length > 1
    && !/^\d+(?:[.,]\d+)?$/u.test(term)
    && !/\p{Script=Han}/u.test(term)
    && !GENERIC_EVENT_TERMS.has(term)
  )));
  try {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
    for (const segment of segmenter.segment(normalized)) {
      const term = String(segment.segment || "").trim();
      if (segment.isWordLike
        && term.length > 1
        && !/^\d+(?:[.,]\d+)?$/u.test(term)
        && !GENERIC_EVENT_TERMS.has(term)) terms.add(term);
    }
  } catch {}
  for (const sequence of normalized.match(/[\p{Script=Han}]{2,}/gu) || []) {
    for (let index = 0; index < sequence.length - 1; index += 1) {
      const term = sequence.slice(index, index + 2);
      if (!GENERIC_EVENT_TERMS.has(term)) terms.add(term);
    }
  }
  return { core: [...terms].sort().join(" "), terms, numericFacts: materialNumericFacts(normalized) };
}

function signatureMatchScore(left, right) {
  if (!left.core || !right.core) return -1;
  if (numbersConflict(left.numericFacts, right.numericFacts)) return -1;
  if (left.core === right.core) return 1;
  const shared = [...left.terms].filter((term) => right.terms.has(term));
  if (shared.length < 2) return -1;
  const union = new Set([...left.terms, ...right.terms]).size;
  const jaccard = union ? shared.length / union : 0;
  const dice = (left.terms.size + right.terms.size) ? (2 * shared.length) / (left.terms.size + right.terms.size) : 0;
  return jaccard >= .45 || dice >= .6 ? Math.max(jaccard, dice) : -1;
}

function numbersConflict(left, right) {
  if (!(left instanceof Map) || !(right instanceof Map) || !left.size || !right.size) return false;
  for (const [context, leftValues] of left) {
    const rightValues = right.get(context);
    if (!rightValues?.size) continue;
    if (![...leftValues].some((value) => rightValues.has(value))) return true;
  }
  return false;
}

function materialNumericFacts(value) {
  const text = String(value || "")
    .replace(/\b(?:19|20)\d{2}\s*年(?:\s*\d{1,2}\s*月(?:\s*\d{1,2}\s*日)?)?/gu, " ")
    .replace(/\b(?:19|20)\d{2}[./-]\d{1,2}(?:[./-]\d{1,2})?\b/gu, " ")
    .replace(/\b\d{1,2}\s*月\s*\d{1,2}\s*日\b/gu, " ")
    .replace(/\b\d{1,2}[./-]\d{1,2}\b/gu, " ")
    .replace(/\b\d{1,2}:\d{2}\b/gu, " ");
  const facts = new Map();
  for (const match of text.matchAll(/([a-z]{2,24})[-_.]?(\d+(?:\.\d+)*)/giu)) {
    const label = String(match[1] || "").toLowerCase();
    if (!label || label === "第") continue;
    addNumericFact(facts, `model:${label}`, match[2]);
  }
  for (const match of text.matchAll(/\d+(?:[.,]\d+)?/gu)) {
    const valueText = String(match[0] || "").replace(/,/g, "");
    const index = Number(match.index || 0);
    const windowStart = Math.max(0, index - 14);
    const window = text.slice(windowStart, index + match[0].length + 14);
    const context = numericContext(window, text.slice(0, index), index - windowStart);
    if (context) addNumericFact(facts, context, valueText);
  }
  return facts;
}

function numericContext(window, before, numberOffset) {
  const value = String(window || "").toLowerCase();
  const contexts = [
    ["death", /(?:死亡|遇难|遇難|罹难|罹難|身亡|丧生|喪生|dead|death|deaths|killed)/i],
    ["injury", /(?:受伤|受傷|伤者|傷者|injur(?:y|ed|ies))/i],
    ["cases", /(?:病例|确诊|確診|感染|cases?|infect(?:ed|ions?))/i],
    ["money", /(?:美元|人民币|人民幣|亿元|億元|万元|萬元|元|usd|dollars?|million|billion|trillion)/i],
    ["percent", /(?:%|％|百分之|percent)/i],
    ["magnitude", /(?:震级|震級|级地震|級地震|magnitude)/i],
    ["version", /(?:版本|型号|型號|第\s*\d+\s*代|version|model)/i],
  ];
  const matched = contexts.map(([context, pattern]) => {
    const match = value.match(pattern);
    return match ? { context, distance: Math.abs(Number(match.index || 0) - Number(numberOffset || 0)) } : null;
  }).filter(Boolean).sort((left, right) => left.distance - right.distance)[0];
  if (matched) return matched.context;
  const genericContexts = [
    ["people", /(?:\d\s*(?:人|名|例)|(?:people|persons?))/i],
    ["distance", /(?:公里|千米|米|km|kilomet(?:er|re)s?|meters?)/i],
    ["duration", /(?:小时|小時|分钟|分鐘|天|days?|hours?|minutes?)/i],
  ];
  const generic = genericContexts.find(([, pattern]) => pattern.test(value));
  if (generic) return generic[0];
  const adjacentLatin = String(before || "").match(/([a-z][a-z0-9-]{1,20})\s*$/i)?.[1]?.toLowerCase() || "";
  if (adjacentLatin && !GENERIC_EVENT_TERMS.has(adjacentLatin)) return `model:${adjacentLatin}`;
  try {
    const terms = [...new Intl.Segmenter(undefined, { granularity: "word" }).segment(String(before || ""))]
      .filter((segment) => segment.isWordLike)
      .map((segment) => String(segment.segment || "").trim().toLowerCase())
      .filter((term) => term.length > 1 && !GENERIC_EVENT_TERMS.has(term));
    const adjacent = terms.at(-1) || "";
    if (adjacent) return `model:${adjacent}`;
  } catch {}
  return "";
}

function addNumericFact(facts, context, value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!context || !normalized) return;
  if (!facts.has(context)) facts.set(context, new Set());
  facts.get(context).add(normalized);
}

function numericFactIdentity(facts) {
  if (!(facts instanceof Map)) return "";
  return [...facts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([context, values]) => `${context}:${[...values].sort().join(",")}`)
    .join("|");
}

function uniqueByEvent(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.eventId || item.articleId || item.entryKey || item.url;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function diversifyPublishers(items, limit, publisherLimit) {
  const list = Array.isArray(items) ? items : [];
  if (!publisherLimit) return list.slice(0, limit);
  const selected = [];
  const deferred = [];
  const counts = new Map();
  for (const item of list) {
    const publisher = publisherIdentity(item) || "unknown";
    if ((counts.get(publisher) || 0) >= publisherLimit) {
      deferred.push(item);
      continue;
    }
    counts.set(publisher, (counts.get(publisher) || 0) + 1);
    selected.push(item);
    if (selected.length >= limit) return selected;
  }
  for (const item of deferred) {
    selected.push(item);
    if (selected.length >= limit) break;
  }
  return selected;
}

function buildPersonalizationProfile(feedback, now) {
  const source = new Map();
  const category = new Map();
  const weights = { opened: .5, queued: 1.25, read: 1, dismissed: -3, more_like_this: 2 };
  for (const record of Array.isArray(feedback) ? feedback : []) {
    const recordedAt = Date.parse(String(record?.recordedAt || ""));
    const age = Number.isFinite(recordedAt) ? Math.max(0, now - recordedAt) : Number.POSITIVE_INFINITY;
    if (age > FEEDBACK_WINDOW_MS) continue;
    const base = Number(weights[record?.action] || 0);
    if (!base) continue;
    const value = base * Math.pow(.5, age / FEEDBACK_HALF_LIFE_MS);
    addProfileValue(source, record.source, value);
    addProfileValue(category, record.category, value);
  }
  return { source, category };
}

function addProfileValue(map, key, value) {
  const normalized = String(key || "").trim().toLowerCase();
  if (normalized) map.set(normalized, (map.get(normalized) || 0) + value);
}

function personalizationAdjustment(item, profile) {
  const sourceKey = String(item?.publisher || item?.source || "").trim().toLowerCase();
  const categoryKey = String(item?.category || item?.categoryKey || "").trim().toLowerCase();
  const value = Number(profile.source.get(sourceKey) || 0) * .7 + Number(profile.category.get(categoryKey) || 0) * .3;
  return Math.round(Math.max(-4, Math.min(4, value)));
}

function freshnessScore(age) {
  if (!Number.isFinite(age)) return 0;
  if (age <= 2 * HOUR_MS) return 30;
  if (age <= 6 * HOUR_MS) return 27;
  if (age <= 12 * HOUR_MS) return 23;
  if (age <= 24 * HOUR_MS) return 18;
  if (age <= 48 * HOUR_MS) return 10;
  if (age <= 96 * HOUR_MS) return 4;
  return 0;
}

function verifiedTime(item) {
  if (item?.timeUnverified === true) return 0;
  const time = Date.parse(String(item?.publishedAt || ""));
  return Number.isFinite(time) ? time : 0;
}

function finiteTime(value, fallback) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : fallback;
  const number = Number(value);
  if (Number.isFinite(number)) return number;
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampScore(value) {
  return Math.round(Math.max(0, Math.min(100, Number(value) || 0)));
}

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value || "")) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

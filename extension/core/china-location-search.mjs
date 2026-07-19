const RESULT_LIMIT = 5;
const FEATURE_RANK = Object.freeze({ PPLC: 0, PPLA: 1, PPLA2: 2, PPLA3: 3 });
const ADMIN_SUFFIX_PATTERN = /(?:特别行政区|自治州|自治县|自治区|地区|街道|省|市|区|县|盟|旗)$/u;

export function searchChinaLocationRecords(records, queryValue, localeValue, limit = RESULT_LIMIT) {
  const query = normalizeSearchKey(queryValue);
  if (!query || !Array.isArray(records)) return [];
  const strippedQuery = stripAdminSuffix(query);
  const useChinese = String(localeValue || "").toLowerCase().startsWith("zh");
  const matches = [];
  for (const record of records) {
    const score = locationMatchScore(record, query, strippedQuery);
    if (score === null) continue;
    matches.push({ record, score });
  }
  matches.sort((left, right) => (
    left.score - right.score
    || featureRank(left.record.f) - featureRank(right.record.f)
    || Number(right.record.p || 0) - Number(left.record.p || 0)
    || String(left.record.zh).localeCompare(String(right.record.zh), "zh-CN")
  ));
  return matches.slice(0, boundedLimit(limit)).map(({ record }) => ({
    id: `geonames:${record.id}`,
    name: useChinese ? record.zh : record.en,
    admin1: useChinese ? record.a1zh : record.a1en,
    admin2: useChinese ? record.a2zh : record.a2en,
    country: useChinese ? "中国" : "China",
    countryCode: "CN",
    featureCode: record.f,
    population: Number(record.p || 0),
    source: "geonames",
    confidence: "high",
    latitude: record.lat,
    longitude: record.lon,
  }));
}

function locationMatchScore(record, query, strippedQuery) {
  const name = normalizeSearchKey(record.zh);
  const strippedName = stripAdminSuffix(name);
  if (name === query) return 0;
  if (strippedName && strippedName === strippedQuery) return query === strippedQuery ? 0 : 1;
  const keys = Array.isArray(record.keys) ? record.keys : [];
  if (keys.includes(query)) return 2;
  if (strippedQuery && keys.some((key) => stripAdminSuffix(key) === strippedQuery)) return 3;
  if (query.length >= 2 && name.startsWith(query)) return 4;
  return null;
}

function normalizeSearchKey(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function stripAdminSuffix(value) {
  return String(value || "").replace(ADMIN_SUFFIX_PATTERN, "");
}

function featureRank(value) {
  return FEATURE_RANK[value] ?? 9;
}

function boundedLimit(value) {
  const limit = Number(value);
  return Number.isInteger(limit) && limit > 0 ? Math.min(limit, RESULT_LIMIT) : RESULT_LIMIT;
}

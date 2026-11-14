export const TRACKED_TOPICS_KEY = "dash.topics.state.v1";
export const TOPIC_LIMIT = 8;
export const TOPIC_NAME_LIMIT = 24;
export const TOPIC_KEYWORDS_LIMIT = 200;
export const TOPIC_ITEM_LIMIT = 1000;
export const TOPIC_READ_LIMIT = 1000;
const SOURCES = ["all", "bookmarks", "public"];
const validId = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const text = (value, limit) => typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, limit) : "";
export const topicComparable = value => String(value || "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
export function topicKeywords(value) {
  const values = Array.isArray(value) ? value : typeof value === "string" ? value.slice(0, TOPIC_KEYWORDS_LIMIT).split(/[,，、\n]/) : [];
  const seen = new Set();
  return values.slice(0, 30).map(word => text(word, 60)).filter(word => {
    const key = topicComparable(word);
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0, 12);
}
export function normalizeTrackedTopics(value) {
  const topics = [], ids = new Set(), names = new Set();
  for (const item of Array.isArray(value?.topics) ? value.topics.slice(0, 40) : []) {
    const name = text(item?.name, TOPIC_NAME_LIMIT), words = topicKeywords(item?.words), key = topicComparable(name);
    if (!validId(item?.id) || !name || !words.length || ids.has(item.id) || names.has(key)) continue;
    ids.add(item.id); names.add(key);
    topics.push({ id: item.id, name, words, source: SOURCES.includes(item.source) ? item.source : "all",
      revision: Number.isSafeInteger(item.revision) && item.revision >= 0 ? item.revision : 0 });
    if (topics.length >= TOPIC_LIMIT) break;
  }
  const read = new Map();
  for (const entry of Array.isArray(value?.read) ? value.read.slice(-TOPIC_READ_LIMIT * 2) : []) {
    if (typeof entry?.key !== "string" || !entry.key || entry.key.length > 256 || !Number.isFinite(entry.at) || entry.at <= 0) continue;
    read.set(entry.key, { key: entry.key, at: entry.at });
  }
  return { revision: Number.isSafeInteger(value?.revision) && value.revision >= 0 ? value.revision : 0, topics,
    read: [...read.values()].sort((a, b) => a.at - b.at).slice(-TOPIC_READ_LIMIT) };
}

export function applyTopicAction(value, action, { createId = () => globalThis.crypto.randomUUID() } = {}) {
  const state = normalizeTrackedTopics(value);
  const fail = reason => ({ ok: false, reason, state });
  if (action?.type === "save") {
    const name = text(action.name, TOPIC_NAME_LIMIT), words = topicKeywords(action.words);
    if (!name) return fail("nameRequired");
    if (!words.length) return fail("keywordsRequired");
    const rawWords = Array.isArray(action.words) ? action.words : typeof action.words === "string" ? action.words.split(/[,，、\n]/) : [];
    const uniqueWords = [...new Set(rawWords.map(word => topicComparable(word)).filter(Boolean))];
    if (uniqueWords.length > 12 || uniqueWords.some(word => word.length > 60) || rawWords.join(",").length > TOPIC_KEYWORDS_LIMIT) return fail("keywordsLimit");
    if (!SOURCES.includes(action.source)) return fail("invalid");
    const current = action.id ? state.topics.find(topic => topic.id === action.id) : null;
    if (action.id && !current) return fail("removed");
    if (current && action.revision !== current.revision) return fail("changed");
    if (!current && state.topics.length >= TOPIC_LIMIT) return fail("limit");
    if (state.topics.some(topic => topic.id !== action.id && topicComparable(topic.name) === topicComparable(name))) return fail("duplicate");
    const topic = { id: current?.id || createId(), name, words, source: action.source, revision: (current?.revision || 0) + 1 };
    state.topics = current ? state.topics.map(item => item.id === topic.id ? topic : item) : [...state.topics, topic];
    state.revision += 1;
    return { ok: true, state, id: topic.id };
  }
  if (action?.type === "remove") {
    const current = state.topics.find(topic => topic.id === action.id);
    if (!current) return fail("removed");
    if (current.revision !== action.revision) return fail("changed");
    state.topics = state.topics.filter(topic => topic.id !== action.id);
  } else return fail("invalid");
  state.revision += 1;
  return { ok: true, state };
}

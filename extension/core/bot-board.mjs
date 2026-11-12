import { boundedReferences } from "./bot-task-context.mjs";
export const BOT_CONNECTION_KEY = "ampira.bot.connection.v1";
export const BOT_LOCAL_ORIGIN = "http://127.0.0.1/*";
export const BOT_DEFAULT_ENDPOINT = "http://127.0.0.1:43123";
export const BOT_MODULES = Object.freeze(["today", "replies"]);
export const BOT_OUTBOX_LIMIT = 150;

export function botError(code) {
  return Object.assign(new Error(code), { code, messageKey: `background.bot.${code}` });
}

export function normalizeBotConnection(value = {}) {
  const endpoint = typeof value.endpoint === "string" ? value.endpoint.trim().replace(/\/$/, "") : "";
  const match = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/.exec(endpoint);
  if (!match || Number(match[1]) > 65535) throw botError("invalidConnection");
  const boardId = value.boardId || "";
  if (boardId && (typeof boardId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(boardId))) throw botError("invalidConnection");
  return { endpoint, ...(boardId ? { boardId } : {}) };
}

export function botConnectionId(connection) {
  const value = normalizeBotConnection(connection);
  return `${value.endpoint}/${value.boardId || ""}`;
}

export function botFileUrl(connection, path) {
  const value = normalizeBotConnection(connection);
  if (!/^(?:today|replies|summaries|briefs|runner)\.json$/.test(path)
    && !/^inbox\/[a-zA-Z0-9_-]{1,100}\.json$/.test(path)) throw botError("invalidData");
  return `${value.endpoint}/v1/${path}`;
}

export function normalizeBotRunner(value) {
  if (!value || !["manual", "codex"].includes(value.mode) || !["idle", "running", "failed"].includes(value.status)) throw botError("invalidData");
  return { mode: value.mode, status: value.status, kind: ["question", "brief"].includes(value.kind) ? value.kind : "",
    messageIds: Array.isArray(value.messageIds) ? value.messageIds.filter(id => typeof id === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(id)).slice(0, 4) : [],
    error: ["unavailable", "auth", "quota", "timeout", "invalidResult", "interrupted", "failed"].includes(value.error) ? value.error : "failed" };
}

export function normalizeBotModule(kind, value) {
  if (!BOT_MODULES.includes(kind) || value?.schemaVersion !== 1
    || !value.data || typeof value.data !== "object" || Array.isArray(value.data)) throw botError("invalidData");
  const updatedAt = date(value.updatedAt, true);
  const common = { schemaVersion: 1, updatedAt, bot: text(value.bot, 100), data: null };
  const data = value.data;
  if (kind === "today") {
    if (Object.keys(data).some(key => !["brief", "nativeBrief"].includes(key))) throw botError("invalidData");
    common.data = { brief: data.brief == null ? null : text(data.brief, 6000),
      ...(data.nativeBrief ? { nativeBrief: normalizeNativeBrief(data.nativeBrief) } : {}) };
  } else {
    common.data = { items: uniqueRecords(data.items, 300, (item) => ({
      id: identifier(item.id), replyTo: identifier(item.replyTo), text: requiredText(item.text, 16000),
      bot: text(item.bot || value.bot, 100), createdAt: date(item.createdAt, true),
    })) };
  }
  return common;
}

function normalizeNativeBrief(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value?.date || "") || !["en", "zh-CN", "zh-Hant"].includes(value.locale)) throw botError("invalidData");
  return { taskId: identifier(value.taskId), owner: identifier(value.owner), date: value.date, locale: value.locale,
    sources: uniqueRecords(value.sources || [], 12, item => ({ id: identifier(item.id), title: requiredText(item.title, 300), url: safeBotUrl(item.url) })) };
}

export function createBotAction(input, { id, now = new Date().toISOString() }) {
  const base = { schemaVersion: 1, id: identifier(id), createdAt: date(now, true), type: input?.type };
  if (base.type === "message") return { ...base, text: requiredText(input.text, 6000), replyTo: text(input.replyTo, 100),
    ...(input.conversationId ? { conversationId: identifier(input.conversationId) } : {}),
    ...(input.locale ? { locale: ["zh-CN", "zh-Hant", "en"].includes(input.locale) ? input.locale : "zh-CN" } : {}),
    ...(Array.isArray(input.references) ? { references: boundedReferences(input.references) } : {}),
    ...(input.contextNotice ? { contextNotice: text(input.contextNotice, 180) } : {}),
  };
  throw botError("invalidData");
}

export function botActionAcknowledged(action, modules = {}) {
  return (modules.replies?.data?.items || []).some((item) => item.replyTo === action.id);
}

export function safeBotUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && !url.username && !url.password && url.href.length <= 2048 ? url.href : "";
  } catch { return ""; }
}

export function botDashboardPayload(base, board, locale = "zh-CN") {
  if (board.mcpEnabled !== true || board.mode !== "bot" || board.botGenerateBrief === false) return { ...base, bot: board };
  const today = board.modules?.today;
  const brief = today?.data?.brief || "";
  return { ...base, bot: board,
    nativeDailyDigest: base.dailyDigest,
    dailyDigest: { status: "bot", locale, generatedAt: today?.updatedAt || "", overview: brief ? [brief] : [],
      sourceLinks: today?.data?.nativeBrief?.sources || [], taskStatus: board.brief?.status || "", items: [] },
  };
}

function uniqueRecords(value, max, normalize) {
  const seen = new Set();
  return records(value, max).map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw botError("invalidData");
    const item = normalize(value);
    if (seen.has(item.id)) throw botError("invalidData");
    seen.add(item.id);
    return item;
  });
}
function records(value, max) {
  if (!Array.isArray(value) || value.length > max) throw botError("invalidData");
  return value;
}
function identifier(value) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) throw botError("invalidData");
  return value;
}
function text(value, max) { return typeof value === "string" ? Array.from(value.trim()).slice(0, max).join("") : ""; }
function requiredText(value, max) {
  const result = text(value, max);
  if (!result) throw botError("invalidData");
  return result;
}
function date(value, required = false) {
  if (!value && !required) return "";
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw botError("invalidData");
  return new Date(value).toISOString();
}

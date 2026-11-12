import { BOT_MODULES } from "../../extension/core/bot-board.mjs";
import { shortText } from "../../extension/core/bot-task-context.mjs";
import { fail, isId } from "./patch.mjs";
import { digest } from "./tasks.mjs";

export const MODULE_RESPONSE_LIMIT = 6000;

export function readMcpModule(store, args) {
  if (!args || ![...BOT_MODULES, "context"].includes(args.module)
    || Object.keys(args).some(key => !["module", "taskId", "ids", "query", "cursor", "limit"].includes(key))) fail("invalid-module-query");
  if (args.ids !== undefined && (!Array.isArray(args.ids) || args.ids.length > 20 || args.ids.some(id => !isId(id)))) fail("invalid-ids");
  if (args.query !== undefined && (typeof args.query !== "string" || args.query.length > 200)) fail("invalid-query");
  if (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 20)) fail("invalid-limit");
  if (args.module === "context" && !isId(args.taskId)) fail("task-required");
  const module = args.module === "context" ? { data: { items: store.taskReferences(args.taskId) } } : store.module(args.module);
  if (!module) return { module: args.module, items: [], nextCursor: null };
  const detailed = Boolean(args.ids?.length), limit = args.limit || 10;
  const records = module.data.items || [];
  const query = (args.query || "").toLowerCase();
  const selected = records.filter(item => (!args.ids?.length || args.ids.includes(item.id))
    && (!query || `${item.title || ""} ${item.text || item.summary || item.excerpt || ""}`.toLowerCase().includes(query)));
  const revision = digest([args.module, args.taskId || "", args.ids || [], query, module]).slice(0, 16);
  let offset = 0;
  if (args.cursor !== undefined) {
    const match = /^([a-f0-9]{16}):(\d{1,6})$/.exec(String(args.cursor));
    if (!match || match[1] !== revision) fail("stale-cursor");
    offset = Number(match[2]); if (offset > selected.length) fail("invalid-cursor");
  }
  const result = { module: args.module, updatedAt: module.updatedAt || "", items: [], total: selected.length, nextCursor: null };
  if (!offset && args.module === "today" && (!detailed || args.ids.includes("brief"))) {
    result.brief = shortText(module.data.brief, detailed ? 4500 : 1200);
    result.briefTruncated = String(module.data.brief || "").length > result.brief.length;
  }
  for (const item of selected.slice(offset, offset + limit)) {
    const value = project(item, detailed);
    result.items.push(value);
    const nextOffset = offset + result.items.length;
    result.nextCursor = nextOffset < selected.length ? `${revision}:${nextOffset}` : null;
    if (JSON.stringify(result).length > MODULE_RESPONSE_LIMIT) { result.items.pop(); break; }
  }
  const next = offset + result.items.length;
  result.nextCursor = next < selected.length ? `${revision}:${next}` : null;
  if (next === offset && next < selected.length) fail("result-too-large");
  return result;
}
function project(item, detailed) {
  const value = { id: item.id };
  for (const key of ["title", "text", "summary", "excerpt", "source", "publishedAt", "replyTo", "createdAt"]) {
    if (item[key] !== undefined) {
      const raw = Array.isArray(item[key]) ? item[key].join("\n") : String(item[key]);
      value[key] = shortText(raw, detailed ? 1000 : key === "title" ? 120 : 160);
      if (raw.length > value[key].length) value.truncated = true;
    }
  }
  if (detailed && item.url) value.url = shortText(item.url, 2048);
  return value;
}

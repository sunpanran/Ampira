import { normalizeBotModule } from "../../extension/core/bot-board.mjs";

const FIELDS = Object.freeze({ today: ["brief"], replies: [] });
const COLLECTIONS = Object.freeze({ today: {}, replies: { items: 300 } });

export function applyBotPatch(previous, patch, now) {
  assertPlainData(patch);
  if (patch?.schemaVersion !== 1 || !Object.hasOwn(FIELDS, patch.module) || !isId(patch.id)
    || !validDate(patch.createdAt) || typeof patch.bot !== "string" || !patch.bot.trim() || patch.bot.length > 100) fail("invalid-patch");
  const allowed = new Set(["schemaVersion", "id", "module", "createdAt", "bot", "set", "upsert", "remove"]);
  if (Object.keys(patch).some((key) => !allowed.has(key))) fail("unknown-patch-field");
  const baseline = previous ? normalizeBotModule(patch.module, previous) : null;
  const data = structuredClone(baseline?.data || emptyData(patch.module));
  const set = object(patch.set || {});
  if (Object.keys(set).some((key) => !FIELDS[patch.module].includes(key))) fail("invalid-set-field");
  for (const [key, value] of Object.entries(set)) data[key] = value;
  const upsert = object(patch.upsert || {}), remove = object(patch.remove || {});
  const collections = COLLECTIONS[patch.module];
  if ([...Object.keys(upsert), ...Object.keys(remove)].some((key) => !Object.hasOwn(collections, key))) fail("invalid-collection");
  for (const [key, limit] of Object.entries(collections)) {
    const changes = array(upsert[key] || [], 100);
    const deletes = array(remove[key] || [], 300);
    if (deletes.some((id) => !isId(id))) fail("invalid-remove-id");
    const changedIds = new Set();
    const current = new Map((data[key] || []).map((item) => [item.id, item]));
    const added = [];
    for (const item of changes) {
      object(item);
      if (!isId(item.id) || changedIds.has(item.id) || deletes.includes(item.id)) fail("duplicate-change-id");
      changedIds.add(item.id);
      if (!current.has(item.id)) added.push(item.id);
      current.set(item.id, { ...(current.get(item.id) || {}), ...item });
    }
    deletes.forEach((id) => current.delete(id));
    const order = [...added, ...(data[key] || []).map((item) => item.id)];
    data[key] = order.filter((id) => current.has(id)).slice(0, limit).map((id) => current.get(id));
  }
  const normalized = normalizeBotModule(patch.module, { schemaVersion: 1, updatedAt: now, bot: patch.bot, data });
  // Duplicate/no-op patches do not churn module timestamps or force the board to refresh.
  if (baseline && JSON.stringify(baseline.data) === JSON.stringify(normalized.data)) return baseline;
  return normalized;
}

function emptyData(module) {
  if (module === "today") return { brief: null };
  if (module === "replies") return { items: [] };
  return {};
}
export function assertPlainData(value, depth = 0) {
  if (depth > 30) fail("data-too-deep");
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (["__proto__", "constructor", "prototype"].includes(key)) fail("unsafe-key");
    assertPlainData(item, depth + 1);
  }
}
export function isId(value) { return typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value); }
export function validDate(value) { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
export function fail(code) { throw Object.assign(new Error(code), { code }); }
function object(value) { if (!value || typeof value !== "object" || Array.isArray(value)) fail("invalid-object"); return value; }
function array(value, max) { if (!Array.isArray(value) || value.length > max) fail("too-many-changes"); return value; }

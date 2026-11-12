import { aiOutputPartsMatchLocale } from "../../extension/core/ai-output-language.mjs";
import { boundedReferences, BRIEF_CONTEXT_LIMIT } from "../../extension/core/bot-task-context.mjs";
import { applyBotPatch, assertPlainData, fail, isId } from "./patch.mjs";

const LIFETIME = 10 * 60 * 1000;

export function syncBrief(state, input, now = Date.now()) {
  assertPlainData(input);
  if (!isId(input?.owner)) fail("invalid-owner");
  state.briefs ||= [];
  if (input.invalidateIds !== undefined) {
    if (!Array.isArray(input.invalidateIds) || input.invalidateIds.length > 30 || input.invalidateIds.some(id => !isId(id))) fail("invalid-task-ids");
    for (const job of state.briefs) if (job.owner === input.owner && input.invalidateIds.includes(job.id)) {
      job.status = "cancelled";
      if (state.modules.today?.data?.nativeBrief?.taskId === job.id) {
        state.modules.today.data.brief = ""; delete state.modules.today.data.nativeBrief;
      }
    }
    if (!input.request) return { job: null };
  }
  if (input.cancel === true) {
    for (const job of state.briefs) if (job.owner === input.owner && job.status === "pending") job.status = "cancelled";
    return { job: null };
  }
  const request = input.request;
  if (!isId(request?.id) || !isId(request.fingerprint) || !/^\d{4}-\d{2}-\d{2}$/.test(request.date || "")
    || !["en", "zh-CN", "zh-Hant"].includes(request.locale) || !Array.isArray(request.context) || !request.context.length || request.context.length > 12
    || JSON.stringify(request.context).length > BRIEF_CONTEXT_LIMIT || !Array.isArray(request.references) || request.references.length > 12) fail("invalid-brief");
  const references = boundedReferences(request.references, 12, 12000);
  if (request.context.some(item => !isId(item?.id) || !references.some(ref => ref.id === item.id)
    || typeof item.title !== "string" || typeof item.excerpt !== "string")) fail("invalid-brief-context");
  const day = state.briefs.filter(job => job.owner === input.owner && job.date === request.date && job.locale === request.locale && job.status !== "cancelled");
  const active = day.find(job => job.status === "pending");
  const latest = day.findLast(job => job.status === "completed");
  let job = active || (latest && (!input.force || latest.fingerprint === request.fingerprint) ? latest : null);
  if (!job) {
    job = state.briefs.find(value => value.id === request.id && value.owner === input.owner);
    if (job && job.fingerprint !== request.fingerprint) fail("conflict");
    if (job) { job.status = "pending"; delete job.result; }
    else { job = { ...request, references, owner: input.owner, status: "pending", createdAt: new Date(now).toISOString() }; state.briefs.push(job); }
  }
  if (!job.expiresAt || job.expiresAt - now < LIFETIME / 2) job.expiresAt = now + LIFETIME;
  while (state.briefs.length > 30) {
    const index = state.briefs.findIndex(item => item !== job && (item.status !== "pending" || item.expiresAt <= now));
    if (index < 0) fail("storage-full");
    state.briefs.splice(index, 1);
  }
  return { job: { id: job.id, date: job.date, locale: job.locale, fingerprint: job.fingerprint, status: job.status,
    ...(job.status === "completed" ? { snapshot: briefSnapshot(job) } : {}) } };
}
export function pendingBrief(state, now = Date.now()) {
  const job = (state.briefs || []).find(item => item.status === "pending" && item.expiresAt > now);
  return job ? { id: job.id, kind: "brief", locale: job.locale, date: job.date, collectedAt: job.createdAt, context: job.context } : null;
}
export function completeBrief(state, input, now) {
  assertPlainData(input);
  const job = (state.briefs || []).find(item => item.id === input?.taskId);
  if (!job || job.status === "cancelled" || job.expiresAt <= Date.parse(now)) fail("stale-task");
  if (typeof input.brief !== "string" || !input.brief.trim() || input.brief.length > 2000
    || Object.keys(input).some(key => !["taskId", "brief", "sourceIds"].includes(key))
    || !aiOutputPartsMatchLocale(input.brief.split(/\n+/).filter(Boolean), job.locale)) fail("invalid-brief-result");
  const sourceIds = input.sourceIds || job.context.map(item => item.id);
  if (!Array.isArray(sourceIds) || sourceIds.length > 12 || sourceIds.some(id => !job.context.some(item => item.id === id))) fail("invalid-source-id");
  const result = { brief: input.brief.trim(), sourceIds: [...new Set(sourceIds)] };
  if (job.status === "completed") {
    if (JSON.stringify(job.result) !== JSON.stringify(result)) fail("conflict");
    return { completed: job.id, duplicate: true };
  }
  const timestamp = new Date(Math.max(Date.parse(now), Date.parse(state.modules.today?.updatedAt || "") || 0)).toISOString();
  const module = applyBotPatch(state.modules.today, { schemaVersion: 1, id: job.id, module: "today", createdAt: timestamp, bot: "Bot", set: { brief: result.brief } }, timestamp);
  module.data.nativeBrief = { taskId: job.id, owner: job.owner, date: job.date, locale: job.locale,
    sources: job.references.filter(item => sourceIds.includes(item.id)).map(({ id, title, url }) => ({ id, title, url })) };
  if (Buffer.byteLength(JSON.stringify(module)) > 700 * 1024) fail("snapshot-too-large");
  state.modules.today = module;
  job.result = result; job.completedAt = timestamp; job.status = "completed";
  return { completed: job.id, duplicate: false };
}
function briefSnapshot(job) {
  return { schemaVersion: 1, bot: "Bot", updatedAt: job.completedAt || job.createdAt,
    data: { brief: job.result.brief, nativeBrief: { taskId: job.id, owner: job.owner, date: job.date, locale: job.locale,
      sources: job.references.filter(item => job.result.sourceIds.includes(item.id)).map(({ id, title, url }) => ({ id, title, url })) } } };
}

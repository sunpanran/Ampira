import { validTranslation } from "../../extension/core/feed-localization.mjs";
import { CARD_SUMMARY_WRITING_RULES, normalizeCardSummary } from "../../extension/core/card-summary-format.mjs";
import { assertPlainData, fail, isId } from "./patch.mjs";
import { digest } from "./tasks.mjs";

const LIFETIME = 10 * 60 * 1000;

export function syncSummaries(state, input, now = Date.now()) {
  assertPlainData(input);
  const requests = list(input?.requests || [], 5), cancelIds = list(input?.cancelIds || [], 100), resultIds = list(input?.resultIds || [], 12);
  if ([...cancelIds, ...resultIds].some(id => !isId(id))) fail("invalid-id");
  state.summaries ||= [];
  for (const job of state.summaries) {
    if (job.status !== "completed" && (cancelIds.includes(job.id) || job.status === "pending" && job.expiresAt <= now)) job.status = "cancelled";
  }
  for (const request of requests) {
    if (!isId(request?.id) || !["zh-CN", "zh-Hant", "en"].includes(request.locale)
      || typeof request.title !== "string" || !request.title.trim() || request.title.length > 200
      || typeof request.excerpt !== "string" || !request.excerpt.trim() || request.excerpt.length > 2000
      || request.manual !== undefined && typeof request.manual !== "boolean"
      || Object.keys(request).some(key => !["id", "locale", "title", "excerpt", "manual"].includes(key))) fail("invalid-summary-request");
    const { manual, ...content } = request;
    const hash = digest(content);
    const previous = state.summaries.find(job => job.id === request.id);
    if (previous) {
      if (previous.hash !== hash) fail("conflict");
      previous.manual ||= manual === true;
      if (previous.status === "cancelled" || previous.status === "failed" && input.retry === true) {
        previous.status = "pending"; previous.attempts = 0; previous.taskId = "";
      }
      if (previous.expiresAt - now < LIFETIME / 2) previous.expiresAt = now + LIFETIME;
    } else state.summaries.push({ ...request, hash, status: "pending", attempts: 0, expiresAt: now + LIFETIME });
  }
  while (state.summaries.length > 200) {
    const index = state.summaries.findIndex(job => job.status !== "pending" && !resultIds.includes(job.id));
    if (index < 0) fail("storage-full");
    state.summaries.splice(index, 1);
  }
  prepareBatch(state, now);
  return { results: state.summaries.filter(job => resultIds.includes(job.id)).map(job => ({ id: job.id, status: job.status, ...(job.status === "completed" ? { result: job.result } : {}) })) };
}

export function pendingSummary(state, now = Date.now()) {
  const batch = state.summaryBatch;
  if (!batch) return null;
  const items = state.summaries.filter(job => batch.ids.includes(job.id) && job.taskId === batch.id && job.status === "pending" && job.expiresAt > now)
    .map(({ id, title, excerpt }) => ({ id, title, excerpt }));
  return items.length ? { id: batch.id, kind: "summary", locale: batch.locale, items,
    instructions: `${CARD_SUMMARY_WRITING_RULES} Submit taskId and summaries [{id,title,summary:[lines]}] through ampira_complete_task. Retry only rejected items once.` } : null;
}

export function completeSummaries(state, input, now = Date.now()) {
  assertPlainData(input);
  if (!isId(input?.taskId) || Object.keys(input).some(key => !["taskId", "summaries"].includes(key))) fail("invalid-task");
  const values = list(input.summaries, 5), completed = [], errors = [];
  if (!values.length || new Set(values.map(item => item?.id)).size !== values.length) fail("invalid-summaries");
  for (const value of values) {
    const job = state.summaries?.find(item => item.id === value?.id && item.taskId === input.taskId);
    if (!job || !["pending", "completed"].includes(job.status) || job.expiresAt <= now) { errors.push({ id: isId(value?.id) ? value.id : "", code: "stale-task" }); continue; }
    if (job.status === "completed") {
      const normalized = normalizeCardSummary(value), previous = normalizeCardSummary(job.result);
      const same = validTranslation(value, job.locale) && value.title.length <= 64 && value.summary.join("").length <= 200
        && normalized.title === previous.title && JSON.stringify(normalized.summary) === JSON.stringify(previous.summary);
      if (same) completed.push(job.id); else errors.push({ id: job.id, code: "conflict" });
      continue;
    }
    const normalized = normalizeCardSummary(value);
    if (!validTranslation(value, job.locale) || !validTranslation(normalized, job.locale) || value.title.length > 64 || value.summary.join("").length > 200
      || Object.keys(value).some(key => !["id", "title", "summary"].includes(key))) {
      job.attempts += 1;
      if (job.attempts >= 2) job.status = "failed";
      errors.push({ id: job.id, code: "invalid-summary" }); continue;
    }
    const result = { ...normalized, locale: job.locale };
    job.result = result; job.status = "completed"; completed.push(job.id);
  }
  prepareBatch(state, now);
  return { completed, errors };
}

function prepareBatch(state, now) {
  if (state.summaryBatch?.ids.some(id => state.summaries.some(job => job.id === id && job.taskId === state.summaryBatch.id && job.status === "pending" && job.expiresAt > now))) return;
  const eligible = state.summaries.filter(job => job.status === "pending" && job.expiresAt > now)
    .sort((a, b) => Number(b.manual === true) - Number(a.manual === true));
  const first = eligible[0];
  if (!first) { state.summaryBatch = null; return; }
  const jobs = eligible.filter(job => job.locale === first.locale).slice(0, 5);
  const ids = jobs.map(job => job.id), id = `summary-${digest([ids, now]).slice(0, 32)}`;
  state.summaryBatch = { id, ids, locale: first.locale };
  for (const job of jobs) job.taskId = id;
}
function list(value, max) { if (!Array.isArray(value) || value.length > max) fail("invalid-list"); return value; }

import { FOCUS_STATE_KEY, applyFocusAction, settleFocus } from "../core/focus.mjs";
import { TRACKED_TOPICS_KEY, applyTopicAction, normalizeTrackedTopics } from "../core/tracked-topics.mjs";
import { normalizeTodoItems } from "../core/todo.mjs";
import { CALENDAR_STATE_KEY, applyCalendarAction, normalizeCalendarState } from "../core/calendar.mjs";
import { NOTES_STATE_KEY, applyNoteAction, normalizeNotesState } from "../core/notes.mjs";
import { WORLD_CLOCK_STATE_KEY, applyWorldClockAction, normalizeWorldClockState } from "../core/world-clock.mjs";

const TODO_KEY = "dash.utility.todos.v1";
const parse = value => { try { return JSON.parse(value); } catch { return null; } };
const policies = {
  calendar: { key: CALENDAR_STATE_KEY, normalize: normalizeCalendarState, apply: applyCalendarAction },
  notes: { key: NOTES_STATE_KEY, normalize: normalizeNotesState, apply: applyNoteAction },
  worldClock: { key: WORLD_CLOCK_STATE_KEY, normalize: normalizeWorldClockState, apply: applyWorldClockAction },
};

export function createPersonalCardsService({ clientStateStore, broadcast, contentSyncService, now = Date.now, createId }) {
  async function transact(payload, update) {
    const policy = Object.hasOwn(policies, payload?.kind) ? policies[payload.kind] : null;
    const retrySync = update && policy && payload.action?.type === "sync";
    const key = payload?.kind === "focus" ? FOCUS_STATE_KEY : payload?.kind === "topics" ? TRACKED_TOPICS_KEY
      : policy?.key || "";
    if (!key) throw new Error("INVALID_PERSONAL_CARD");
    const result = await clientStateStore.mutate(current => {
      const stored = parse(current[key]);
      const options = { now: now(), ...(createId ? { createId } : {}), todos: normalizeTodoItems(parse(current[TODO_KEY])) };
      const outcome = update && !retrySync
        ? payload.kind === "focus" ? applyFocusAction(stored, payload.action, options)
          : payload.kind === "topics" ? applyTopicAction(stored, payload.action, options) : policy.apply(stored, payload.action, options)
        : { ok: true, state: payload.kind === "focus" ? settleFocus(stored, options.now)
          : payload.kind === "topics" ? normalizeTrackedTopics(stored) : policy.normalize(stored) };
      const serialized = JSON.stringify(outcome.state);
      const values = current[key] !== serialized ? { [key]: serialized } : {};
      if (outcome.todos) values[TODO_KEY] = JSON.stringify(outcome.todos);
      const { todos, ...data } = outcome;
      return { values, result: { ...data, values } };
    });
    if (Object.keys(result.values).length) broadcast("personal-cards.changed", { values: result.values });
    const syncKeys = [TODO_KEY, TRACKED_TOPICS_KEY, CALENDAR_STATE_KEY, NOTES_STATE_KEY, WORLD_CLOCK_STATE_KEY]
      .filter(syncKey => Object.hasOwn(result.values, syncKey));
    if (retrySync && !syncKeys.includes(key)) syncKeys.push(key);
    if (syncKeys.length) {
      const patch = Object.fromEntries(syncKeys.map(syncKey => [syncKey, result.values[syncKey] ?? JSON.stringify(result.state)]));
      if (policy) result.syncError = null;
      try { await contentSyncService?.handleLocalPatch(patch); }
      catch (error) {
        if (policy) result.syncError = {
          code: error.code || "CALENDAR_SYNC_FAILED", message: error.message || "",
          messageKey: error.messageKey || "", messageParams: error.messageParams || {},
        };
      }
      const latest = await clientStateStore.read();
      for (const syncKey of syncKeys) result.values[syncKey] = latest[syncKey] ?? patch[syncKey];
      if (syncKeys.includes(TRACKED_TOPICS_KEY)) result.state = normalizeTrackedTopics(parse(result.values[TRACKED_TOPICS_KEY]));
      if (policy && syncKeys.includes(key)) result.state = policy.normalize(parse(result.values[key]));
    }
    return result;
  }
  return { read: payload => transact(payload, false), change: payload => transact(payload, true) };
}

import { countdownDateOrdinal, countdownToday } from "./countdown.mjs";

export const CALENDAR_STATE_KEY = "dash.calendar.state.v1";
export const CALENDAR_EVENT_LIMIT = 200;
export const CALENDAR_TITLE_LIMIT = 80;
export const calendarToday = countdownToday;
const idText = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value) ? value : "";
const revision = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const titleText = value => typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
const validTime = value => value === "" || typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);

export function normalizeCalendarState(value) {
  const state = { revision: revision(value?.revision), items: [] };
  const ids = new Set();
  for (const item of Array.isArray(value?.items) ? value.items.slice(0, 1000) : []) {
    const id = idText(item?.id), title = titleText(item?.title).slice(0, CALENDAR_TITLE_LIMIT);
    if (!id || ids.has(id) || !title || countdownDateOrdinal(item.date) === null || !validTime(item.time ?? "")) continue;
    ids.add(id);
    state.items.push({ id, revision: revision(item.revision), title, date: item.date, time: item.time || "" });
    if (state.items.length === CALENDAR_EVENT_LIMIT) break;
  }
  return state;
}

export function calendarEventsOnDate(state, date) {
  return state.items.filter(item => item.date === date)
    .sort((left, right) => left.time.localeCompare(right.time) || left.title.localeCompare(right.title) || left.id.localeCompare(right.id));
}

export function applyCalendarAction(value, action, { createId = () => globalThis.crypto.randomUUID() } = {}) {
  const state = normalizeCalendarState(value);
  const fail = reason => ({ ok: false, reason, state });
  if (!["save", "remove"].includes(action?.type)) return fail("invalid");
  const id = idText(action.id);
  if (action.id && !id) return fail("invalid");
  const existing = id ? state.items.find(item => item.id === id) : null;
  if (id && !existing) return fail("removed");
  if (existing && action.revision !== existing.revision) return fail("changed");
  if (action.type === "remove") {
    if (!existing) return fail("removed");
    state.items = state.items.filter(item => item.id !== id);
  } else {
    const title = titleText(action.title), time = action.time ?? "";
    if (!title) return fail("titleRequired");
    if (title.length > CALENDAR_TITLE_LIMIT) return fail("titleLimit");
    if (countdownDateOrdinal(action.date) === null) return fail("dateRequired");
    if (!validTime(time)) return fail("timeInvalid");
    if (!existing && state.items.length >= CALENDAR_EVENT_LIMIT) return fail("limit");
    const nextId = existing?.id || idText(createId());
    if (!nextId || !existing && state.items.some(item => item.id === nextId)) return fail("invalid");
    const item = { id: nextId, revision: (existing?.revision || 0) + 1, title, date: action.date, time };
    state.items = existing ? state.items.map(current => current.id === id ? item : current) : [...state.items, item];
    state.revision += 1;
    return { ok: true, id: item.id, state };
  }
  state.revision += 1;
  return { ok: true, id, state };
}

import { normalizeTodoItems, normalizeTodoText, TODO_ITEM_LIMIT, TODO_TEXT_LIMIT } from "./todo.mjs";

export const NOTES_STATE_KEY = "dash.notes.state.v1";
export const NOTE_LIMIT = 50;
export const NOTE_TEXT_LIMIT = 2000;
const idText = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(value) ? value : "";
const revision = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const timestamp = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
export const normalizeNoteText = value => typeof value === "string" ? value.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "") : "";

export function normalizeNotesState(value) {
  const state = { revision: revision(value?.revision), items: [] }, ids = new Set();
  for (const item of Array.isArray(value?.items) ? value.items.slice(0, 1000) : []) {
    const id = idText(item?.id), text = normalizeNoteText(item?.text);
    if (!id || ids.has(id) || !text.trim() || text.length > NOTE_TEXT_LIMIT) continue;
    ids.add(id);
    state.items.push({ id, revision: revision(item.revision), text, pinned: item.pinned === true,
      createdAt: timestamp(item.createdAt), updatedAt: timestamp(item.updatedAt) });
    if (state.items.length === NOTE_LIMIT) break;
  }
  return state;
}

export function sortedNotes(state) {
  return [...state.items].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
}

export function applyNoteAction(value, action, { now = Date.now(), todos = [] } = {}) {
  const state = normalizeNotesState(value), fail = reason => ({ ok: false, reason, state });
  if (!["create", "save", "pin", "remove", "todo"].includes(action?.type)) return fail("invalid");
  const id = idText(action.id), item = state.items.find(item => item.id === id);
  if (!id) return fail("invalid");
  const text = normalizeNoteText(action.text);
  if (action.type === "create" && item && item.text === text) return { ok: true, id, state };
  if (action.type !== "create" && !item) return fail("removed");
  if (item && (action.type === "create" || item.revision !== action.revision)) return fail("changed");
  if (["create", "save"].includes(action.type)) {
    if (!text.trim()) return fail("textRequired");
    if (text.length > NOTE_TEXT_LIMIT) return fail("textLimit");
    if (!item && state.items.length >= NOTE_LIMIT) return fail("limit");
    if (item?.text === text) return { ok: true, id, state };
    const next = { id, revision: (item?.revision || 0) + 1, text, pinned: item?.pinned || false,
      createdAt: item?.createdAt ?? now, updatedAt: now };
    state.items = item ? state.items.map(current => current.id === id ? next : current) : [...state.items, next];
  } else if (action.type === "remove") state.items = state.items.filter(current => current.id !== id);
  else if (action.type === "pin") {
    state.items = state.items.map(current => current.id === id ? { ...current, pinned: !current.pinned, revision: current.revision + 1 } : current);
  } else {
    const items = normalizeTodoItems(todos), todoId = "note-" + id;
    if (items.some(todo => todo.id === todoId)) return { ok: true, id, state };
    if (items.length >= TODO_ITEM_LIMIT) return fail("todoLimit");
    const firstLine = item.text.trim().split("\n")[0];
    return { ok: true, id, state, todos: [...items, { id: todoId, text: normalizeTodoText(firstLine, TODO_TEXT_LIMIT),
      completed: false, createdAt: new Date(now).toISOString(), completedAt: "" }] };
  }
  state.revision++;
  return { ok: true, id, state };
}

import { COUNTDOWN_ITEMS_KEY, COUNTDOWN_ITEM_LIMIT, countdownDateOrdinal, countdownToday,
  normalizeCountdownItems, normalizeCountdownTitle, selectCountdownItems } from "../../extension/core/countdown.mjs";
import { readJson } from "./storage.mjs";

export function createCountdownCardState({ writeJson, notify, now = () => new Date(),
  createId = () => globalThis.crypto.randomUUID(), initialItems = readJson(COUNTDOWN_ITEMS_KEY, []) }) {
  let items = normalizeCountdownItems(initialItems), day = countdownToday(now());
  function persist(next) {
    items = next;
    writeJson(COUNTDOWN_ITEMS_KEY, items);
    notify();
  }
  return {
    read: () => selectCountdownItems(items, countdownToday(now())),
    today: () => countdownToday(now()),
    syncFromStorage() {
      const next = normalizeCountdownItems(readJson(COUNTDOWN_ITEMS_KEY, []));
      if (JSON.stringify(next) === JSON.stringify(items)) return;
      items = next; notify();
    },
    refreshDay() {
      const next = countdownToday(now());
      if (next === day) return false;
      day = next; notify(); return true;
    },
    save(draft, id = "") {
      const title = normalizeCountdownTitle(draft?.title), date = draft?.date;
      if (!title) return { ok: false, reason: "titleRequired" };
      if (countdownDateOrdinal(date) === null) return { ok: false, reason: "dateRequired" };
      if (id && !items.some(item => item.id === id)) return { ok: false, reason: "removed" };
      if (!id && items.length >= COUNTDOWN_ITEM_LIMIT) return { ok: false, reason: "limit" };
      const item = { id: id || createId(), title, date };
      persist(id ? items.map(current => current.id === id ? item : current) : [...items, item]);
      return { ok: true, id: item.id };
    },
    remove(id) {
      if (!items.some(item => item.id === id)) return false;
      persist(items.filter(item => item.id !== id)); return true;
    },
  };
}

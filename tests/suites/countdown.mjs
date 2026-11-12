import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { COUNTDOWN_ITEM_LIMIT, COUNTDOWN_ITEMS_KEY, COUNTDOWN_TITLE_LIMIT, countdownDateOrdinal,
  countdownDays, countdownToday, normalizeCountdownItems, normalizeCountdownTitle, selectCountdownItems } from "../../extension/core/countdown.mjs";
import { createCountdownCardState } from "../../assets/client/countdown-card-state.mjs";
import { applyExternalStoragePatch } from "../../assets/client/storage.mjs";

export function runCountdownTests() {
  assert.equal(normalizeCountdownTitle("  项目\n 交付  "), "项目 交付");
  assert.equal(normalizeCountdownTitle("x".repeat(200)).length, COUNTDOWN_TITLE_LIMIT);
  assert.equal(normalizeCountdownTitle({}), "");
  for (const date of ["2026-02-29", "1900-02-29", "2026-04-31", "0000-01-01", "2026-00-01", "2026-01-00", "2026-13-01", "2026-1-01", "2026-01-01T00:00:00Z", null, {}]) {
    assert.equal(countdownDateOrdinal(date), null, String(date));
  }
  for (const date of ["0001-01-01", "0099-12-31", "2000-02-29", "2024-02-29", "9999-12-31"]) assert.notEqual(countdownDateOrdinal(date), null);
  assert.equal(countdownDays("2026-11-12", "2026-11-12"), 0);
  assert.equal(countdownDays("2026-11-13", "2026-11-12"), 1);
  assert.equal(countdownDays("2026-11-11", "2026-11-12"), -1);
  assert.equal(countdownDays("2027-01-01", "2026-12-31"), 1);
  assert.equal(countdownDays("2024-03-01", "2024-02-28"), 2);
  assert.equal(countdownDays("0100-01-01", "0099-12-31"), 1);
  assert.equal(countdownDays("2026-03-09", "2026-03-08"), 1, "spring DST must not shorten calendar days");
  assert.equal(countdownDays("2026-11-02", "2026-11-01"), 1, "autumn DST must not lengthen calendar days");
  assert.equal(countdownDays("invalid", "2026-11-12"), null);
  assert.equal(countdownToday(new Date(2026, 10, 12, 23, 59, 59)), "2026-11-12");

  const entry = (id, date = "2026-11-12") => ({ id, title: id, date });
  const normalized = normalizeCountdownItems([entry("a"), entry("a"), { ...entry("b"), title: " " }, { ...entry("c"), date: "bad" }, entry("<bad>"), entry("d")]);
  assert.deepEqual(normalized.map(item => item.id), ["a", "d"]);
  assert.deepEqual(normalizeCountdownItems(null), []);
  assert.equal(normalizeCountdownItems(Array.from({ length: 30 }, (_, i) => entry(`item-${i}`))).length, COUNTDOWN_ITEM_LIMIT);
  assert.deepEqual(selectCountdownItems([entry("past", "2026-11-10"), entry("later", "2026-12-01"), entry("tomorrow", "2026-11-13"),
    entry("today"), entry("yesterday", "2026-11-11"), entry("same-day")], "2026-11-12").map(item => item.id),
  ["today", "same-day", "tomorrow", "later", "yesterday", "past"]);

  let clock = new Date(2026, 10, 12, 23, 59), serial = 0, notifications = 0;
  const writes = [];
  const options = { initialItems: [], now: () => clock, createId: () => `item-${++serial}`,
    writeJson: (key, value) => writes.push({ key, value: structuredClone(value) }), notify: () => notifications++ };
  const state = createCountdownCardState(options);
  assert.deepEqual(state.save({ title: " ", date: "2026-11-13" }), { ok: false, reason: "titleRequired" });
  assert.deepEqual(state.save({ title: "Test", date: "bad" }), { ok: false, reason: "dateRequired" });
  assert.equal(writes.length, 0);
  const one = state.save({ title: "交付", date: "2026-11-13" });
  assert(one.ok); assert.equal(state.read()[0].days, 1);
  assert.equal(writes[0].key, COUNTDOWN_ITEMS_KEY);
  assert.deepEqual(Object.keys(writes[0].value[0]).sort(), ["date", "id", "title"], "derived day counts are never persisted");
  assert.equal(state.refreshDay(), false); assert.equal(notifications, 1);
  clock = new Date(2026, 10, 13, 0, 1);
  assert.equal(state.refreshDay(), true); assert.equal(state.read()[0].days, 0);
  assert.equal(state.refreshDay(), false); assert.equal(writes.length, 1, "day rollover updates views without storage writes");
  clock = new Date(2026, 10, 14, 12);
  assert.equal(state.read()[0].days, -1, "opening an inactive card uses the current local date");
  state.save({ title: "新交付", date: "2026-11-20" }, one.id);
  assert.equal(state.read()[0].id, one.id); assert.equal(state.read()[0].days, 6);
  const snapshot = createCountdownCardState({ ...options, initialItems: writes.at(-1).value });
  assert.deepEqual(snapshot.read(), state.read(), "saved items survive hydration");
  const detached = state.read(); detached[0].title = "Unrelated edit";
  assert.equal(state.read()[0].title, "新交付", "one card cannot mutate another card's stored draft through a read");
  assert.equal(state.remove(one.id), true); assert.equal(state.remove(one.id), false);
  assert.deepEqual(state.save({ title: "Deleted draft", date: "2026-11-20" }, one.id), { ok: false, reason: "removed" });
  for (let i = 0; i < COUNTDOWN_ITEM_LIMIT; i++) assert(state.save({ title: `Item ${i}`, date: "2026-11-20" }).ok);
  assert.deepEqual(state.save({ title: "Overflow", date: "2026-11-20" }), { ok: false, reason: "limit" });
  assert(state.save({ title: "Edit at capacity", date: "2026-12-01" }, state.read()[0].id).ok);

  const writesBeforeSync = writes.length, notificationsBeforeSync = notifications;
  const syncItem = entry("synced", "2026-11-20");
  applyExternalStoragePatch({ [COUNTDOWN_ITEMS_KEY]: JSON.stringify([syncItem]) });
  state.syncFromStorage();
  assert.deepEqual(state.read().map(({ days, ...item }) => item), [syncItem]);
  assert.equal(notifications, notificationsBeforeSync + 1, "remote items refresh all mounted countdown cards");
  state.syncFromStorage();
  assert.equal(notifications, notificationsBeforeSync + 1, "unchanged storage broadcasts do not rerender cards");
  applyExternalStoragePatch({ [COUNTDOWN_ITEMS_KEY]: "[]" });
  state.syncFromStorage();
  assert.deepEqual(state.read(), []);
  assert.deepEqual(state.save({ title: "Stale draft", date: "2026-11-20" }, syncItem.id), { ok: false, reason: "removed" });
  assert.equal(writes.length, writesBeforeSync, "receiving synced content never writes it back");

  const moduleUrl = new URL("../../extension/core/countdown.mjs", import.meta.url).href;
  const script = `import { countdownToday, countdownDays } from ${JSON.stringify(moduleUrl)};
    const today = countdownToday(new Date('2026-11-12T16:01:00Z'));
    console.log(JSON.stringify([today, countdownDays('2026-11-14', today)]));`;
  for (const [timezone, expected] of [["Asia/Shanghai", ["2026-11-13", 1]], ["America/New_York", ["2026-11-12", 2]]]) {
    const actual = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], { env: { ...process.env, TZ: timezone }, encoding: "utf8" }));
    assert.deepEqual(actual, expected, `date-only countdowns follow ${timezone}`);
  }
}

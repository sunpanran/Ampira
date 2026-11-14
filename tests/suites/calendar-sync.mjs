import assert from "node:assert/strict";
import { createClientStateStore } from "../../extension/core/client-state.mjs";
import { CONTENT_SYNC_DATASETS, createContentSyncService, contentSyncStorageKey, parseLocalEntries, selectSyncEntries } from "../../extension/core/content-sync.mjs";
import { CALENDAR_EVENT_LIMIT, CALENDAR_STATE_KEY, normalizeCalendarState } from "../../extension/core/calendar.mjs";
import { createPersonalCardsService } from "../../extension/runtime/personal-cards-service.mjs";
import { createCalendarCardState } from "../../assets/client/calendar-card-state.mjs";

const previousLocation = globalThis.location;
globalThis.location = { protocol: "https:" };
try {
  await lifecycle();
  await mergeAndPendingChanges();
  await quotasAndRetry();
  await remoteValidation();
} finally {
  if (previousLocation === undefined) delete globalThis.location;
  else globalThis.location = previousLocation;
}

const maximum = Array.from({ length: CALENDAR_EVENT_LIMIT }, (_, index) => ({ ...event(String(index).padStart(100, "x")), title: "测".repeat(80) }));
assert.equal(selectSyncEntries("calendar", parseLocalEntries("calendar", { items: maximum })).length, CALENDAR_EVENT_LIMIT,
  "calendar selection must not silently omit supported events to satisfy a byte budget");
console.log("calendar sync tests passed");

async function lifecycle() {
  const cloud = memoryStorage(), first = device(cloud, "first", { revision: 40, items: [event("shared", 7)] });
  await first.sync.initialize();
  let result = await first.cards.change({ kind: "calendar", action: { type: "save", ...first.state().items[0], title: "Local only" } });
  assert(result.ok); assert.deepEqual(await cloud.get(), {}, "default-off changes never upload");
  await first.enable(true);
  const values = Object.values(await cloud.get());
  assert.equal(values.length, 1);
  assert.deepEqual(Object.keys(values[0].value).sort(), ["date", "id", "time", "title"], "local revisions and editor state must not leave the device");
  const second = device(cloud, "second", { revision: 100 }, true);
  await second.sync.initialize();
  assert.equal(second.state().items[0].title, "Local only"); assert.equal(second.state().revision, 101);
  const old = structuredClone(first.state().items[0]);
  result = await second.cards.change({ kind: "calendar", action: { type: "save", ...second.state().items[0], title: "Remote edit", date: "2028-02-29", time: "" } });
  assert(result.ok);
  const key = await contentSyncStorageKey("calendar", "shared");
  first.sync.handleStorageChanged({ [key]: { newValue: (await cloud.get())[key] } }, "sync");
  await until(() => first.state().items[0]?.title === "Remote edit");
  assert.equal(first.state().items[0].date, "2028-02-29"); assert.equal(first.state().items[0].time, "");
  assert(first.state().items[0].revision > old.revision, "remote edits invalidate open local forms");
  assert.equal((await first.cards.change({ kind: "calendar", action: { type: "save", ...old, title: "Stale" } })).reason, "changed");
  assert(first.events.some(([type, payload]) => type === "content-sync.changed" && payload.values[CALENDAR_STATE_KEY]));
  await second.cards.change({ kind: "calendar", action: { type: "remove", ...second.state().items[0] } });
  assert.equal((await cloud.get())[key].deleted, true);
  await first.refresh(); assert.deepEqual(first.state().items, [], "remote deletion must not be resurrected");
  await first.cards.change({ kind: "calendar", action: { type: "save", title: "Keep on this device", date: "2026-11-14", time: "09:00" } });
  const retained = first.state();
  await cloud.set({ "ampira.content.countdowns.v1.unrelated": { fixture: true } });
  await first.enable(false);
  assert.deepEqual(first.state(), retained);
  assert.deepEqual(Object.keys(await cloud.get()), ["ampira.content.countdowns.v1.unrelated"], "disabling calendar removes its live records and tombstones only");
}

async function mergeAndPendingChanges() {
  const cloud = memoryStorage(), first = device(cloud, "first", { items: [event("a")] }, true);
  await first.sync.initialize();
  const second = device(cloud, "second", { items: [event("b")] }, true);
  const result = await second.cards.change({ kind: "calendar", action: { type: "save", title: "Third event", date: "2026-11-15", time: "" } });
  assert.equal(result.state.items.length, 3, "save replies include events merged while synchronizing");
  assert.deepEqual(JSON.parse(result.values[CALENDAR_STATE_KEY]), result.state);
  await first.refresh(); assert.deepEqual(eventValues(first), eventValues(second));
  const key = await contentSyncStorageKey("calendar", "a");
  await cloud.set({ [key]: { ...(await cloud.get())[key], deleted: true, updatedAt: 2000, revision: "2000:remote-delete" } });
  const pending = first.state(), item = pending.items.find(item => item.id === "a");
  item.title = "Pending local edit"; item.revision++; pending.revision++;
  await first.store.save({ values: { [CALENDAR_STATE_KEY]: JSON.stringify(pending) } });
  await first.refresh();
  assert.equal(first.state().items.find(item => item.id === "a").title, "Pending local edit");
  assert.equal((await cloud.get())[key].value.title, "Pending local edit", "unsynced changes survive an unseen older deletion");
}

async function quotasAndRetry() {
  const cloud = memoryStorage(), target = device(cloud, "quota", { items: [event("base")] }, true);
  await target.sync.initialize();
  const filler = Object.fromEntries(Array.from({ length: 93 }, (_, index) => ["quota-fixture-" + index, "x".repeat(1000)]));
  await cloud.set(filler);
  const before = await cloud.get();
  const client = createCalendarCardState({ initialState: target.state(), notify() {}, request: message =>
    message.type === "personal-cards:get" ? target.cards.read(message.payload) : target.cards.change(message.payload) });
  await client.ensure();
  const saved = await client.change({ type: "save", title: "Saved despite sync quota", date: "2026-11-15", time: "10:00" });
  assert(saved.ok, `a sync failure must not misreport the successful local save: ${saved.error?.stack || saved.reason || ""}`);
  assert.equal(client.read().syncError.code, "SYNC_STORAGE_TOTAL_TOO_LARGE");
  assert.equal(target.state().items.length, 2);
  assert.deepEqual(await cloud.get(), before, "over-budget synchronization cannot partially upload the calendar");
  await client.ensure({ force: true });
  assert(client.read().syncError, "a plain read must not falsely report sync recovery");
  await cloud.remove(Object.keys(filler));
  const retry = await client.retrySync();
  assert(retry.ok); assert.equal(client.read().syncError, null);
  assert.equal(target.state().items.length, 2, "retrying sync must not create a duplicate event");
  assert.equal(Object.values(await cloud.get()).filter(value => value.dataset === "calendar").length, 2);

  const crowdedCloud = memoryStorage();
  const full = device(crowdedCloud, "full", { items: Array.from({ length: CALENDAR_EVENT_LIMIT }, (_, index) => event("full-" + index)) }, true);
  await full.sync.initialize();
  const extra = device(crowdedCloud, "extra", { items: [event("extra")] });
  const previousCloud = await crowdedCloud.get(), previousLocal = extra.state();
  await assert.rejects(extra.enable(true), { code: "CALENDAR_SYNC_LIMIT_EXCEEDED" });
  assert.deepEqual(extra.state(), previousLocal, "an over-capacity merge must preserve all local events");
  assert.deepEqual(await crowdedCloud.get(), previousCloud, "an over-capacity merge must not delete remote events to make room");
}

async function remoteValidation() {
  const cloud = memoryStorage(), key = await contentSyncStorageKey("calendar", "bad");
  const record = value => ({ version: 1, dataset: "calendar", id: "bad", updatedAt: 100, revision: "fixture", value });
  await cloud.set({ [key]: record(event("different")) });
  const target = device(cloud, "validation", {}, true); await target.sync.initialize();
  assert.deepEqual(target.state().items, []);
  await cloud.set({ [key]: record({ ...event("bad"), date: "2026-02-30" }) }); await target.refresh();
  assert.deepEqual(target.state().items, []);
  await cloud.set({ [key]: record({ ...event("bad"), time: "24:00" }) }); await target.refresh();
  assert.deepEqual(target.state().items, []);
  assert.equal(CONTENT_SYNC_DATASETS.calendar.maxItems, CALENDAR_EVENT_LIMIT);
}

function event(id, revision = 1) { return { id, revision, title: "Fixture " + id.slice(0, 20), date: "2026-11-14", time: "14:00" }; }
function eventValues(target) { return parseLocalEntries("calendar", target.state()).map(entry => entry.value).sort((a, b) => a.id.localeCompare(b.id)); }
function device(cloud, id, initial, enabled = false) {
  let local = { [CALENDAR_STATE_KEY]: JSON.stringify(normalizeCalendarState(initial)) }, serial = 0;
  let settings = { syncCalendarEnabled: enabled };
  const records = new Map(), events = [];
  const store = createClientStateStore({ getRecord: async () => structuredClone(local), setRecord: async (_key, value) => { local = structuredClone(value); } });
  const sync = createContentSyncService({ storage: cloud, clientStateStore: store, getSettings: async () => settings,
    getRecord: async (key, fallback) => records.get(key) || fallback, setRecord: async (key, value) => records.set(key, structuredClone(value)),
    now: () => 1000, randomUUID: () => `${id}-${++serial}`, broadcast: (...args) => events.push(args) });
  const cards = createPersonalCardsService({ clientStateStore: store, contentSyncService: sync, createId: () => `${id}-${++serial}`, broadcast: (...args) => events.push(args) });
  return { sync, cards, store, events, state: () => JSON.parse(local[CALENDAR_STATE_KEY]),
    refresh: async () => { await sync.reset(); await sync.applySettings({}, settings); },
    enable: async value => { const previous = settings; settings = { syncCalendarEnabled: value }; await sync.applySettings(previous, settings); },
  };
}
function memoryStorage() {
  const records = {};
  return { get: async () => structuredClone(records), set: async values => Object.assign(records, structuredClone(values)),
    remove: async keys => { for (const key of keys) delete records[key]; } };
}
async function until(predicate) {
  for (let count = 0; count < 100; count++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.fail("remote calendar change was not delivered");
}

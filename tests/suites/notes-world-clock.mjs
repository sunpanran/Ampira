import assert from "node:assert/strict";
import { NOTES_STATE_KEY, NOTE_LIMIT, NOTE_TEXT_LIMIT, applyNoteAction, normalizeNotesState, sortedNotes } from "../../extension/core/notes.mjs";
import { WORLD_CLOCK_CITIES, WORLD_CLOCK_STATE_KEY, WORLD_CLOCK_LIMIT, applyWorldClockAction, normalizeWorldClockState } from "../../extension/core/world-clock.mjs";
import { worldClockTime } from "../../assets/client/world-clock-time.mjs";
import { createNotesCardState } from "../../assets/client/notes-card-state.mjs";
import { createClientStateStore } from "../../extension/core/client-state.mjs";
import { CONTENT_SYNC_DATASETS, createContentSyncService, contentSyncStorageKey, parseLocalEntries, selectSyncEntries } from "../../extension/core/content-sync.mjs";
import { createPersonalCardsService } from "../../extension/runtime/personal-cards-service.mjs";
import { createSettingsWorkflow } from "../../extension/runtime/settings-workflow.mjs";
import { createSettingsStore } from "../../extension/core/settings-store.mjs";
import { DEFAULT_SETTINGS } from "../../extension/core/constants.mjs";

let notes = normalizeNotesState(null);
const run = action => { const result = applyNoteAction(notes, action, { now: 1000 }); notes = result.state; return result; };
const draft = { type: "create", id: "first", text: "First line\n  Indented text\nhttps://example.com" };
assert(run(draft).ok);
assert.equal(notes.items[0].text, draft.text, "note whitespace and links must survive storage");
assert(run(draft).ok); assert.equal(notes.items.length, 1, "retrying a create must not duplicate a note");
assert.equal(run({ ...draft, id: "second", text: " " }).reason, "textRequired");
assert.equal(run({ ...draft, text: "x".repeat(NOTE_TEXT_LIMIT + 1), id: "long" }).reason, "textLimit");
const original = structuredClone(notes.items[0]);
assert(run({ type: "save", ...original, text: "Updated\nSecond line" }).ok);
assert.equal(run({ type: "save", ...original, text: "Stale" }).reason, "changed");
assert.equal(run({ type: "remove", ...original }).reason, "changed");
assert(run({ type: "create", id: "newer", text: "Another note" }).ok);
assert(run({ type: "pin", ...notes.items[0] }).ok); assert.equal(sortedNotes(notes)[0].id, "first");
const task = applyNoteAction(notes, { type: "todo", ...notes.items[0] }, { now: 2000, todos: [] });
assert(task.ok); assert.equal(task.todos[0].text, "Updated"); assert.deepEqual(task.state, notes);
const repeated = applyNoteAction(notes, { type: "todo", ...notes.items[0] }, { now: 2000, todos: task.todos });
assert(repeated.ok); assert.equal(repeated.todos, undefined, "converting twice must not create duplicate tasks");
assert(run({ type: "remove", ...notes.items[0] }).ok);
assert.equal(run({ type: "save", ...original, text: "Resurrect" }).reason, "removed");
assert.deepEqual(normalizeNotesState({ items: [{ ...original, id: "bad/path" }, { ...original, text: "" }] }).items, []);
for (let i = notes.items.length; i < NOTE_LIMIT; i++) assert(run({ type: "create", id: "n-" + i, text: "Note " + i }).ok);
assert.equal(run({ type: "create", id: "over", text: "Over capacity" }).reason, "limit");
const maximum = { items: Array.from({ length: NOTE_LIMIT }, (_, i) => ({ id: "max-" + i, text: "测".repeat(NOTE_TEXT_LIMIT), pinned: true, updatedAt: 1000 })) };
assert.equal(selectSyncEntries("notes", parseLocalEntries("notes", maximum)).length, NOTE_LIMIT, "sync selection must not silently omit long notes");

let clocks = normalizeWorldClockState(null);
assert.deepEqual(clocks.items, []);
let result = applyWorldClockAction(clocks, { type: "add", id: "newYork" }); assert(result.ok); clocks = result.state;
assert.equal(applyWorldClockAction(clocks, { type: "add", id: "newYork" }).reason, "duplicate");
assert.equal(applyWorldClockAction(clocks, { type: "add", id: "unknown" }).reason, "invalid");
assert.equal(applyWorldClockAction(clocks, { type: "remove", id: "newYork", revision: 0 }).reason, "changed");
assert(applyWorldClockAction(clocks, { type: "remove", ...clocks.items[0] }).ok);
const changedClock = applyWorldClockAction(clocks, { type: "replace", previousId: "newYork", id: "london", revision: 1 });
assert(changedClock.ok); assert.deepEqual(changedClock.state.items, [{ id: "london", revision: 2 }]);
assert.equal(applyWorldClockAction(clocks, { type: "replace", previousId: "newYork", id: "tokyo", revision: 0 }).reason, "changed");
assert.equal(applyWorldClockAction(changedClock.state, { type: "replace", previousId: "newYork", id: "tokyo", revision: 1 }).reason, "removed");
const twoCities = applyWorldClockAction(clocks, { type: "add", id: "london" }).state;
assert.equal(applyWorldClockAction(twoCities, { type: "replace", previousId: "newYork", id: "london", revision: 1 }).reason, "duplicate");
const fullCities = normalizeWorldClockState({ items: WORLD_CLOCK_CITIES.slice(0, WORLD_CLOCK_LIMIT).map(({ id }) => ({ id, revision: 1 })) });
const replacedAtLimit = applyWorldClockAction(fullCities, { type: "replace", previousId: fullCities.items[0].id, revision: 1, id: "london" });
assert(replacedAtLimit.ok); assert.equal(replacedAtLimit.state.items.length, WORLD_CLOCK_LIMIT, "changing a city must work at capacity");
const time = (date, zone, local = "UTC") => worldClockTime(new Date(date), zone, "en", local);
assert.equal(time("2026-01-15T12:00:00Z", "America/New_York").difference, -300);
assert.equal(time("2026-07-15T12:00:00Z", "America/New_York").difference, -240);
assert.equal(time("2026-03-08T06:59:00Z", "America/New_York").time, "01:59");
assert.equal(time("2026-03-08T07:00:00Z", "America/New_York").time, "03:00", "spring transition skips the nonexistent hour");
assert.equal(time("2026-11-01T05:30:00Z", "America/New_York").difference, -240);
assert.equal(time("2026-11-01T06:30:00Z", "America/New_York").difference, -300);
assert.equal(time("2026-01-15T12:00:00Z", "Asia/Kathmandu").differenceText, "+5:45");
assert.equal(time("2026-01-15T12:00:00Z", "Australia/Adelaide").differenceText, "+10:30");
assert.match(time("2026-11-14T20:00:00Z", "Asia/Tokyo").date, /15/, "dates follow the city's midnight");
assert.equal(time("2026-11-16T01:00:00Z", "Asia/Shanghai").working, true);
assert.equal(time("2026-11-14T01:00:00Z", "Asia/Shanghai").working, false);
for (const city of WORLD_CLOCK_CITIES) assert.doesNotThrow(() => time("2026-11-14T00:00:00Z", city.timeZone));

const previousLocation = globalThis.location;
globalThis.location = { protocol: "https:" };
try {
  await syncLifecycle("notes", NOTES_STATE_KEY, { type: "create", id: "shared-note", text: "Sync fixture" });
  await syncLifecycle("worldClock", WORLD_CLOCK_STATE_KEY, { type: "add", id: "tokyo" });
  await quotaAndConcurrency();
  await settingsBoundary();
  await worldClockReplacementSync();
} finally {
  if (previousLocation === undefined) delete globalThis.location;
  else globalThis.location = previousLocation;
}
console.log("notes and world clock tests passed");

async function syncLifecycle(kind, key, create) {
  const cloud = memoryStorage(), first = device(cloud, kind, "first");
  await first.sync.initialize();
  let saved = await first.cards.change({ kind, action: create }); assert(saved.ok);
  assert.deepEqual(await cloud.get(), {}, "new card content stays local by default");
  await first.enable(true);
  const second = device(cloud, kind, "second", {}, true); await second.sync.initialize();
  assert.equal(second.state().items[0].id, create.id);
  const record = Object.values(await cloud.get())[0];
  assert(!Object.hasOwn(record.value, "revision"), "local editor revisions are excluded from sync");
  if (kind === "notes") {
    const old = first.state().items[0];
    saved = await second.cards.change({ kind, action: { type: "pin", ...second.state().items[0] } }); assert(saved.ok);
    await first.refresh(); assert.equal(first.state().items[0].pinned, true);
    assert.equal((await first.cards.change({ kind, action: { type: "save", ...old, text: "Stale edit" } })).reason, "changed");
    const conflict = await Promise.all(["Left", "Right"].map(text => first.cards.change({ kind, action: { type: "save", ...first.state().items[0], text } })));
    assert.equal(conflict.filter(result => result.ok).length, 1, "concurrent edits to one note cannot overwrite each other");
    await second.refresh();
  }
  await second.cards.change({ kind, action: { type: "remove", ...second.state().items[0] } });
  const storageKey = await contentSyncStorageKey(kind, create.id);
  assert.equal((await cloud.get())[storageKey].deleted, true);
  await first.refresh(); assert.deepEqual(first.state().items, [], "synced deletion must not resurrect content");
  await first.cards.change({ kind, action: create });
  const retained = structuredClone(first.state());
  await cloud.set({ unrelated: "kept" }); await first.enable(false);
  assert.deepEqual(first.state(), retained); assert.deepEqual(await cloud.get(), { unrelated: "kept" });
  assert(first.events.some(([type, payload]) => type === "content-sync.changed" && payload.values[key]));
}

async function quotaAndConcurrency() {
  const cloud = memoryStorage(), target = device(cloud, "notes", "quota", {}, true);
  await target.sync.initialize();
  const filler = Object.fromEntries(Array.from({ length: 100 }, (_, index) => ["filler-" + index, "x".repeat(1000)]));
  await cloud.set(filler);
  const client = createNotesCardState({ initialState: target.state(), notify() {}, request: message =>
    message.type === "personal-cards:get" ? target.cards.read(message.payload) : target.cards.change(message.payload) });
  await client.ensure();
  const saved = await client.change({ type: "create", id: "large", text: "测".repeat(NOTE_TEXT_LIMIT) });
  assert(saved.ok); assert(client.read().syncError, "sync quota failures must be reported separately from local save");
  assert.equal(target.state().items[0].text.length, NOTE_TEXT_LIMIT);
  assert.deepEqual(await cloud.get(), filler, "quota failures cannot partially upload notes");
  await client.ensure({ force: true }); assert(client.read().syncError);
  await cloud.remove(Object.keys(filler)); await client.retrySync(); assert.equal(client.read().syncError, null);
  const records = await cloud.get(); assert.equal(Object.values(records).filter(item => item.dataset === "notes").length, 1);
  const result = await target.cards.change({ kind: "notes", action: { type: "todo", ...target.state().items[0] } });
  assert(result.ok); assert(result.values["dash.utility.todos.v1"]);
  assert(!Object.values(await cloud.get()).some(value => value.dataset === "todos"), "notes sync must not opt to-dos into sync");
  const more = await Promise.all(["a", "b"].map(id => target.cards.change({ kind: "notes", action: { type: "create", id, text: id } })));
  assert(more.every(outcome => outcome.ok)); assert.equal(target.state().items.length, 3);

  for (const kind of ["notes", "worldClock"]) {
    const limit = kind === "notes" ? NOTE_LIMIT : WORLD_CLOCK_LIMIT;
    const items = kind === "notes" ? Array.from({ length: limit }, (_, i) => ({ id: "full-" + i, text: "Fixture" }))
      : WORLD_CLOCK_CITIES.slice(0, limit).map(({ id }) => ({ id }));
    const remote = memoryStorage(), full = device(remote, kind, "full", { items }, true); await full.sync.initialize();
    const extraItem = kind === "notes" ? { id: "extra", text: "Kept" } : { id: WORLD_CLOCK_CITIES[limit].id };
    const extra = device(remote, kind, "extra", { items: [extraItem] });
    const before = await remote.get(), local = structuredClone(extra.state());
    await assert.rejects(extra.enable(true), { code: "PERSONAL_CARD_SYNC_LIMIT_EXCEEDED" });
    assert.deepEqual(await remote.get(), before); assert.deepEqual(extra.state(), local);
  }
}

function device(cloud, kind, id, initial = {}, enabled = false) {
  const definition = CONTENT_SYNC_DATASETS[kind], normalize = kind === "notes" ? normalizeNotesState : normalizeWorldClockState;
  let local = { [definition.localKey]: JSON.stringify(normalize(initial)) }, serial = 0;
  let settings = { [definition.flag]: enabled };
  const records = new Map(), events = [];
  const store = createClientStateStore({ getRecord: async () => structuredClone(local), setRecord: async (_key, value) => { local = structuredClone(value); } });
  const sync = createContentSyncService({ storage: cloud, clientStateStore: store, getSettings: async () => settings,
    getRecord: async (key, fallback) => records.get(key) || fallback, setRecord: async (key, value) => records.set(key, structuredClone(value)),
    now: () => 1000, randomUUID: () => `${id}-${++serial}`, broadcast: (...args) => events.push(args) });
  const cards = createPersonalCardsService({ clientStateStore: store, contentSyncService: sync, now: () => 1000, broadcast: (...args) => events.push(args) });
  return { sync, cards, store, events, state: () => JSON.parse(local[definition.localKey]),
    refresh: async () => { await sync.reset(); await sync.applySettings({}, settings); },
    enable: async value => { const previous = settings; settings = { [definition.flag]: value }; await sync.applySettings(previous, settings); },
  };
}
function memoryStorage() {
  const records = {};
  return { get: async () => structuredClone(records), set: async values => Object.assign(records, structuredClone(values)),
    remove: async keys => { for (const key of keys) delete records[key]; } };
}

async function settingsBoundary() {
  const storage = memoryStorage(), store = createSettingsStore(storage), syncCalls = [];
  const workflow = createSettingsWorkflow({ getSettings: store.read, settingsLocale: settings => settings.uiLocale,
    defaultSettings: DEFAULT_SETTINGS, settingsService: store,
    contentSyncService: { applySettings: async (previous, next) => syncCalls.push([previous, next]) },
    secretStatus: async () => ({}), emptyBookmarkModel: () => ({}), selectedOrigins: async () => [],
    currentFeedPermissionState: async () => ({}), filterSourceQuality: value => value,
    getRecord: async (_key, fallback) => fallback, emptySourceQuality: () => ({}), broadcast() {},
    startRefresh: () => assert.fail("card sync settings must not trigger a source refresh"),
  });
  await store.write(DEFAULT_SETTINGS);
  for (const field of ["syncNotesEnabled", "syncWorldClockEnabled"]) {
    const saved = await workflow.saveSettings({ [field]: true });
    assert.equal(saved[field], true, "the runtime settings boundary must accept each new flag");
    assert.equal((await createSettingsStore(storage).read())[field], true, "sync choices must survive a new settings store");
    assert.equal(saved.syncTodosEnabled, false); assert.equal(saved.automaticAiStarted, false);
  }
  const saved = await workflow.saveSettings({ syncNotesEnabled: false });
  assert.equal(saved.syncNotesEnabled, false); assert.equal(saved.syncWorldClockEnabled, true);
  assert.equal(syncCalls.length, 3);
  assert.equal(syncCalls[0][1].syncNotesEnabled, true, "the sync service must receive the saved flag");
}

async function worldClockReplacementSync() {
  const cloud = memoryStorage(), first = device(cloud, "worldClock", "first", { items: [{ id: "tokyo", revision: 1 }] }, true);
  await first.sync.initialize();
  const second = device(cloud, "worldClock", "second", {}, true); await second.sync.initialize();
  const old = structuredClone(second.state().items[0]);
  assert((await first.cards.change({ kind: "worldClock", action: { type: "replace", previousId: "tokyo", id: "london", revision: 1 } })).ok);
  assert.equal((await cloud.get())[await contentSyncStorageKey("worldClock", "tokyo")].deleted, true);
  await second.refresh(); assert.equal(second.state().items[0].id, "london");
  assert.equal((await second.cards.change({ kind: "worldClock", action: { type: "remove", ...old } })).reason, "removed");
  await first.cards.change({ kind: "worldClock", action: { type: "remove", ...first.state().items[0] } });
  await second.refresh(); assert.deepEqual(second.state().items, [], "deleting a replacement must also propagate");
}

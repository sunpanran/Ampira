import assert from "node:assert/strict";
import { createClientStateStore } from "../../extension/core/client-state.mjs";
import { DEFAULT_SETTINGS } from "../../extension/core/constants.mjs";
import {
  CONTENT_SYNC_DATASETS,
  CONTENT_SYNC_META_KEY,
  createContentSyncService,
  contentSyncStorageKey,
  parseLocalEntries,
  selectSyncEntries,
} from "../../extension/core/content-sync.mjs";
import { normalizeSettings } from "../../extension/core/settings.mjs";

for (const field of ["syncReadingQueueEnabled", "syncTodosEnabled", "syncWeatherLocationEnabled", "syncStockWatchlistEnabled", "syncCountdownsEnabled"]) {
  assert.equal(DEFAULT_SETTINGS[field], false, `${field} must remain opt-in`);
  assert.equal(normalizeSettings({})[field], false, `${field} must normalize to disabled by default`);
  assert.equal(normalizeSettings({ [field]: true })[field], true, `${field} must preserve explicit opt-in`);
}

const disabledStorage = memoryStorage();
await device({
  syncStorage: disabledStorage,
  now: 500,
  settings: disabledSettings,
  state: {
    "dash.readingQueue": JSON.stringify([readingRecord("local-only", "2026-07-14T07:00:00.000Z")]),
    "dash.stocks.watchlist.v1": '["usAAPL"]',
    "dash.countdown.items.v1": JSON.stringify([countdownRecord("local-only")]),
  },
}).service.initialize();
assert(!Object.keys(await disabledStorage.get(null)).some((key) => key.startsWith("ampira.content.")), "default-off content sync must not upload local content");

const resetStorage = memoryStorage();
const resetDevice = device({
  syncStorage: resetStorage,
  now: 600,
  state: { "dash.readingQueue": JSON.stringify([readingRecord("before-reset", "2026-07-14T07:00:00.000Z")]) },
});
await resetDevice.service.initialize();
const resetRemoteSnapshot = await resetStorage.get(null);
await resetDevice.service.reset();
resetDevice.state["dash.readingQueue"] = JSON.stringify([readingRecord("after-reset", "2026-07-14T08:00:00.000Z")]);
await resetDevice.service.handleLocalPatch({ "dash.readingQueue": resetDevice.state["dash.readingQueue"] });
assert.deepEqual(await resetStorage.get(null), resetRemoteSnapshot, "factory-reset quiescing must prevent stale local writes from repopulating Chrome Sync");

const crowdedSyncStorage = memoryStorage();
await crowdedSyncStorage.set(Object.fromEntries(Array.from({ length: 12 }, (_, index) => [
  `ampira.settings.v1.chunk.fixture.${index}`,
  "x".repeat(6800),
])));
const oversizedQueue = Array.from({ length: 12 }, (_, index) => ({
  ...readingRecord(`large-${index}`, new Date(2026, 6, 14, 0, index).toISOString()),
  title: "T".repeat(300),
  url: `https://example.com/${index}/${"u".repeat(1800)}`,
}));
await assert.rejects(
  device({
    syncStorage: crowdedSyncStorage,
    now: 750,
    state: { "dash.readingQueue": JSON.stringify(oversizedQueue) },
  }).service.initialize(),
  (error) => error.code === "SYNC_STORAGE_TOTAL_TOO_LARGE",
  "content sync must reject an upload that would exceed the shared Chrome Sync budget",
);
assert(!Object.keys(await crowdedSyncStorage.get(null)).some((key) => key.startsWith(CONTENT_SYNC_DATASETS.readingQueue.prefix)), "an over-budget content upload must not partially write the dataset");

const syncStorage = memoryStorage();
const first = device({
  syncStorage,
  now: 1000,
  state: {
    "dash.readingQueue": JSON.stringify([readingRecord("reading-a", "2026-07-14T08:00:00.000Z")]),
    "dash.utility.todos.v1": JSON.stringify([todoRecord("todo-a", false)]),
    "dash.utility.weather.location.v1": JSON.stringify(weatherLocation("Shanghai", 31.2304, 121.4737)),
    "dash.stocks.watchlist.v1": '["AAPL", "00700", "AAPL", "javascript:invalid"]',
    "dash.countdown.items.v1": JSON.stringify([countdownRecord("countdown-a"), countdownRecord("countdown-b")]),
    "dash.stocks.optedIn": "true",
    "dash.stocks.quotes": '{"price":123}',
  },
});
await first.service.initialize();

const firstSyncValues = await syncStorage.get(null);
assert(Object.keys(firstSyncValues).some((key) => key.startsWith(CONTENT_SYNC_DATASETS.readingQueue.prefix)));
assert(Object.keys(firstSyncValues).some((key) => key.startsWith(CONTENT_SYNC_DATASETS.todos.prefix)));
assert(Object.keys(firstSyncValues).some((key) => key.startsWith(CONTENT_SYNC_DATASETS.weatherLocation.prefix)));
assert.equal(Object.values(firstSyncValues).filter(value => value.dataset === "stockWatchlist").length, 2);
assert.equal(Object.values(firstSyncValues).filter(value => value.dataset === "countdowns").length, 2);
assert(!JSON.stringify(firstSyncValues).includes("price"), "quote caches must not enter sync");
for (const [key, value] of Object.entries(firstSyncValues)) {
  if (!key.startsWith("ampira.content.")) continue;
  assert(new TextEncoder().encode(JSON.stringify(value)).byteLength <= 7000, `${key} must fit Chrome Sync's per-item budget`);
}

const second = device({ syncStorage, now: 2000, state: {} });
await second.service.initialize();
assert.equal(JSON.parse(second.state["dash.readingQueue"])[0].key, "reading-a");
assert.equal(JSON.parse(second.state["dash.utility.todos.v1"])[0].text, "Task todo-a");
assert.equal(JSON.parse(second.state["dash.utility.weather.location.v1"]).name, "Shanghai");
assert.deepEqual(JSON.parse(second.state["dash.stocks.watchlist.v1"]), ["usAAPL", "hk00700"]);
assert.equal(JSON.parse(second.state["dash.countdown.items.v1"])[0].title, "Event countdown-a");
assert.equal(second.state["dash.stocks.optedIn"], undefined, "sync must not grant device-local provider consent");

const cardPatch = {
  "dash.stocks.watchlist.v1": '["usMSFT", "hk00700"]',
  "dash.countdown.items.v1": JSON.stringify([{ ...countdownRecord("countdown-a"), title: "Updated event", date: "2027-02-01" }]),
};
await second.clientStateStore.save({ values: cardPatch });
await second.service.handleLocalPatch(cardPatch);

second.state["dash.utility.todos.v1"] = JSON.stringify([{ ...todoRecord("todo-a", true), text: "Updated on device two" }]);
await second.clientStateStore.save({ values: { "dash.utility.todos.v1": second.state["dash.utility.todos.v1"] } });
await second.service.handleLocalPatch({ "dash.utility.todos.v1": second.state["dash.utility.todos.v1"] });
second.state["dash.readingQueue"] = "[]";
await second.clientStateStore.save({ values: { "dash.readingQueue": "[]" } });
await second.service.handleLocalPatch({ "dash.readingQueue": "[]" });

const firstRestarted = device({
  syncStorage,
  now: 3000,
  state: first.state,
  records: first.records,
});
await firstRestarted.service.initialize();
assert.deepEqual(JSON.parse(firstRestarted.state["dash.readingQueue"]), [], "a newer remote tombstone must remove a queued item");
assert.equal(JSON.parse(firstRestarted.state["dash.utility.todos.v1"])[0].text, "Updated on device two");
assert.equal(JSON.parse(firstRestarted.state["dash.utility.todos.v1"])[0].completed, true);
assert.deepEqual(JSON.parse(firstRestarted.state["dash.stocks.watchlist.v1"]).sort(), ["hk00700", "usMSFT"]);
assert.deepEqual(JSON.parse(firstRestarted.state["dash.countdown.items.v1"]), JSON.parse(cardPatch["dash.countdown.items.v1"]));
const deletedCards = await syncStorage.get(null);
for (const [dataset, id] of [["stockWatchlist", "usAAPL"], ["countdowns", "countdown-b"]]) {
  assert.equal(deletedCards[await contentSyncStorageKey(dataset, id)].deleted, true, "removed card entries use versioned tombstones");
}

const mixedStorage = memoryStorage();
const mixed = device({ syncStorage: mixedStorage, now: 3500,
  settings: () => ({ syncStockWatchlistEnabled: true }), state: structuredClone(first.state) });
await mixed.service.initialize();
assert(Object.values(await mixedStorage.get(null)).every(record => record.dataset === "stockWatchlist"), "new content switches stay independent");
const stockOff = { ...enabledSettings(), syncStockWatchlistEnabled: false };
await firstRestarted.service.applySettings(enabledSettings(), stockOff);
assert(!Object.keys(await syncStorage.get(null)).some(key => key.startsWith(CONTENT_SYNC_DATASETS.stockWatchlist.prefix)));
assert(Object.keys(await syncStorage.get(null)).some(key => key.startsWith(CONTENT_SYNC_DATASETS.countdowns.prefix)));
assert.deepEqual(JSON.parse(firstRestarted.state["dash.stocks.watchlist.v1"]).sort(), ["hk00700", "usMSFT"], "disabling stocks preserves the local watchlist");

for (const [name, input, limit] of [
  ["stockWatchlist", Array.from({ length: 30 }, (_, i) => `sh${String(600000 + i)}`), 12],
  ["countdowns", Array.from({ length: 30 }, (_, i) => ({ ...countdownRecord(`event-${i}`), title: "测".repeat(80) })), 20],
]) {
  const entries = selectSyncEntries(name, parseLocalEntries(name, input));
  assert.equal(entries.length, limit, `${name} sync must fit its full supported capacity`);
}
assert.deepEqual(parseLocalEntries("countdowns", [{ ...countdownRecord("bad"), date: "2026-02-30" }]), []);
assert.deepEqual(parseLocalEntries("stockWatchlist", ["https://example.com/", {}]), []);

const malformedStorage = memoryStorage();
await malformedStorage.set({
  [await contentSyncStorageKey("countdowns", "bad")]: { version: 1, dataset: "countdowns", id: "bad", updatedAt: 10, revision: "bad", value: { ...countdownRecord("bad"), date: "invalid" } },
  [await contentSyncStorageKey("stockWatchlist", "usAAPL")]: { version: 1, dataset: "stockWatchlist", id: "usAAPL", updatedAt: 10, revision: "bad", value: "usMSFT" },
});
const malformed = device({ syncStorage: malformedStorage, now: 3600, state: {} });
await malformed.service.initialize();
assert.deepEqual(malformed.state, {}, "invalid remote dates and mismatched symbol identities must be ignored");

const localQueue = Array.from({ length: 80 }, (_, index) => readingRecord(`reading-${index}`, new Date(2026, 6, 14, 0, index).toISOString()));
const selectedQueue = selectSyncEntries("readingQueue", parseLocalEntries("readingQueue", JSON.stringify(localQueue)));
assert(selectedQueue.length <= 40, "reading queue sync must retain at most 40 recent records");
assert(selectedQueue.every((entry) => Number(entry.id.split("-").at(-1)) >= 40), "reading queue sync must prefer recent records");
const cappedSyncStorage = memoryStorage();
await device({
  syncStorage: cappedSyncStorage,
  now: 4000,
  state: { "dash.readingQueue": JSON.stringify(localQueue) },
}).service.initialize();
const cappedRemoteQueue = Object.entries(await cappedSyncStorage.get(null))
  .filter(([key, value]) => key.startsWith(CONTENT_SYNC_DATASETS.readingQueue.prefix) && value.deleted !== true);
assert.equal(cappedRemoteQueue.length, 40, "reading queue sync must never upload more than 40 active records");
const coldDisable = device({ syncStorage: cappedSyncStorage, now: 5000, state: {}, settings: disabledSettings });
await coldDisable.service.applySettings(enabledSettings(), disabledSettings());
assert(!Object.keys(await cappedSyncStorage.get(null)).some((key) => key.startsWith("ampira.content.")), "a cold runtime must clear remote copies when settings are disabled before initialization completes");

await firstRestarted.service.applySettings(enabledSettings(), disabledSettings());
const disabledSyncValues = await syncStorage.get(null);
assert(!Object.keys(disabledSyncValues).some((key) => key.startsWith("ampira.content.")), "disabling content sync must remove remote content copies");
assert.equal(JSON.parse(firstRestarted.state["dash.utility.todos.v1"])[0].text, "Updated on device two", "disabling sync must preserve local content");
assert(firstRestarted.records.has(CONTENT_SYNC_META_KEY), "content sync metadata must remain extension-local");

console.log("content sync tests passed");

function device({ syncStorage, now, state, records = new Map(), settings = enabledSettings }) {
  const localState = state;
  const clientStateStore = createClientStateStore({
    async getRecord() { return { ...localState }; },
    async setRecord(_key, value) {
      for (const key of Object.keys(localState)) delete localState[key];
      Object.assign(localState, value);
    },
  });
  let nonce = 0;
  const service = createContentSyncService({
    storage: syncStorage,
    clientStateStore,
    getSettings: async () => settings(),
    getRecord: async (key, fallback) => records.has(key) ? records.get(key) : fallback,
    setRecord: async (key, value) => records.set(key, structuredClone(value)),
    now: () => now,
    randomUUID: () => `device-${now}-${++nonce}`,
  });
  return { service, clientStateStore, state: localState, records };
}

function enabledSettings() {
  return Object.fromEntries(Object.values(CONTENT_SYNC_DATASETS).map(({ flag }) => [flag, true]));
}

function disabledSettings() {
  return Object.fromEntries(Object.values(CONTENT_SYNC_DATASETS).map(({ flag }) => [flag, false]));
}

function countdownRecord(id) {
  return { id, title: `Event ${id}`, date: "2027-01-01" };
}

function readingRecord(key, addedAt) {
  return {
    key,
    source: "bookmark",
    title: `Reading ${key}`,
    url: `https://example.com/${key}`,
    host: "example.com",
    addedAt,
  };
}

function todoRecord(id, completed) {
  return {
    id,
    text: `Task ${id}`,
    completed,
    createdAt: "2026-07-14T08:00:00.000Z",
    completedAt: completed ? "2026-07-14T09:00:00.000Z" : "",
  };
}

function weatherLocation(name, latitude, longitude) {
  return {
    id: "weather-city",
    name,
    admin1: "Shanghai",
    admin2: "",
    country: "China",
    countryCode: "CN",
    featureCode: "PPLC",
    population: 24874500,
    source: "geonames",
    confidence: "high",
    latitude,
    longitude,
  };
}

function memoryStorage() {
  const values = {};
  return {
    async get(keys) {
      if (keys == null) return structuredClone(values);
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((key) => Object.hasOwn(values, key)).map((key) => [key, structuredClone(values[key])]));
    },
    async set(input) { Object.assign(values, structuredClone(input)); },
    async remove(keys) { for (const key of (Array.isArray(keys) ? keys : [keys])) delete values[key]; },
  };
}

import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, SETTINGS_KEY } from "../../extension/core/constants.mjs";
import { normalizeSettings } from "../../extension/core/settings.mjs";
import { settingsChunkKeys } from "../../extension/core/settings-storage.mjs";
import { createSettingsStore } from "../../extension/core/settings-store.mjs";

const appearanceStorage = memoryStorage();
const appearanceStore = createSettingsStore(appearanceStorage);
assert.equal((await appearanceStore.read()).colorMode, "system", "a new profile must follow the system preference");
for (const colorMode of [undefined, "", "unknown"]) {
  await appearanceStorage.set({ [SETTINGS_KEY]: { colorMode, uiLocale: "en" } });
  assert.equal((await appearanceStore.read()).colorMode, "system", "missing or invalid stored modes must follow the system preference");
}
for (const colorMode of ["dark", "light", "system"]) {
  await appearanceStore.write({ colorMode, uiLocale: "en" });
  assert.equal((await appearanceStore.read()).colorMode, colorMode, "saved theme choices must survive a settings reload");
}
await appearanceStore.write({ colorMode: "dark" });
await appearanceStore.reset();
assert.equal((await appearanceStore.read()).colorMode, "system", "resetting settings must restore the system preference");

assert.equal((await appearanceStore.read()).accentTheme, "cyan", "a new profile must use the cyan preset");
assert.equal((await appearanceStore.read()).customAccentColor, "#06B6D4", "a new profile must initialize the custom color to cyan");
for (const customAccentColor of [undefined, null, "", "invalid"]) {
  await appearanceStorage.set({ [SETTINGS_KEY]: { accentTheme: "custom", customAccentColor } });
  const restored = await appearanceStore.read();
  assert.equal(restored.accentTheme, "custom", "a missing custom color must preserve the custom-mode selection");
  assert.equal(restored.customAccentColor, "#06B6D4", "missing or invalid custom colors must fall back to cyan");
}
for (const accentTheme of [undefined, "", "unknown"]) {
  await appearanceStorage.set({ [SETTINGS_KEY]: { accentTheme, uiLocale: "en" } });
  assert.equal((await appearanceStore.read()).accentTheme, "cyan", "missing or invalid stored accents must use cyan");
}
for (const accentTheme of ["violet", "cyan", "emerald", "amber", "rose", "custom"]) {
  await appearanceStore.write({ accentTheme, customAccentColor: "#123ABC" });
  const restored = await appearanceStore.read();
  assert.equal(restored.accentTheme, accentTheme, "saved accent choices must survive a settings reload");
  assert.equal(restored.customAccentColor, "#123ABC", "saved custom colors must be preserved");
}
await appearanceStore.reset();
assert.equal((await appearanceStore.read()).accentTheme, "cyan", "resetting settings must restore the cyan preset");
assert.equal((await appearanceStore.read()).customAccentColor, "#06B6D4", "resetting settings must restore the custom color to cyan");

const storage = memoryStorage();
const store = createSettingsStore(storage);
const oldSettings = largeSettings("old", 240);
const firstSettings = largeSettings("first", 20);
const lastSettings = largeSettings("last", 180);

await store.write(oldSettings);
assert(settingsChunkKeys((await storage.get(SETTINGS_KEY))[SETTINGS_KEY]).length > 1);

await Promise.all([
  store.write(firstSettings),
  store.write(lastSettings),
]);

assert.deepEqual(
  (await store.read()).excludedNewsSources,
  lastSettings.excludedNewsSources,
  "concurrent public writes must not remove chunks referenced by the last write",
);

const orderedStorage = gatedStorage();
const orderedStore = createSettingsStore(orderedStorage.storage);
const transactionWriteStarted = deferred();
const releaseTransactionWrite = deferred();
orderedStorage.beforeNextSet(async () => {
  transactionWriteStarted.resolve();
  await releaseTransactionWrite.promise;
});

const mutation = orderedStore.mutate(async ({ read, write }) => {
  const current = await read();
  return write({ ...current, ...DEFAULT_SETTINGS, uiLocale: "en" });
});
await transactionWriteStarted.promise;

const publicWrite = orderedStore.write({ ...DEFAULT_SETTINGS, uiLocale: "zh-Hant" });
await Promise.resolve();
await Promise.resolve();
assert.equal(orderedStorage.setCount(), 1, "an external write must wait while a mutation owns the queue");

releaseTransactionWrite.resolve();
await Promise.all([mutation, publicWrite]);
assert.equal((await orderedStore.read()).uiLocale, "zh-Hant");
assert.equal(orderedStorage.setCount(), 2, "the transaction writer must not deadlock by joining its own queue");

const crowdedStorage = memoryStorage();
const crowdedStore = createSettingsStore(crowdedStorage);
await crowdedStore.write(DEFAULT_SETTINGS);
await crowdedStorage.set(Object.fromEntries(Array.from({ length: 8 }, (_, index) => [
  `ampira.content.fixture.${index}`,
  "x".repeat(6800),
])));
await assert.rejects(
  crowdedStore.write(largeSettings("crowded", 180)),
  (error) => error.code === "SYNC_STORAGE_TOTAL_TOO_LARGE",
  "settings writes must account for content records already occupying Chrome Sync",
);
assert.deepEqual(await crowdedStore.read(), normalizeSettings(DEFAULT_SETTINGS), "a rejected over-budget settings write must preserve the previous settings");

const visibilityStorage = memoryStorage();
const visibilityStore = createSettingsStore(visibilityStorage);
assert.equal((await visibilityStore.read()).bookmarkSectionEnabled, false, "fresh public-source settings must hide the bookmark section");
await visibilityStorage.set({ [SETTINGS_KEY]: { newsSourceMode: "bookmarks" } });
assert.equal((await visibilityStore.read()).bookmarkSectionEnabled, true, "missing bookmark visibility must follow the saved bookmark source");
await visibilityStore.write({ ...DEFAULT_SETTINGS, bookmarkSectionEnabled: true });
assert.equal((await visibilityStore.read()).bookmarkSectionEnabled, true, "a public-source opt-in must survive storage reloads");
await visibilityStore.write({ ...DEFAULT_SETTINGS, bookmarkSectionEnabled: false });
assert.equal((await visibilityStore.read()).bookmarkSectionEnabled, false, "bookmark-section visibility must persist through the sync settings store");

console.log("settings store tests passed");

function largeSettings(prefix, count) {
  return normalizeSettings({
    ...DEFAULT_SETTINGS,
    excludedNewsSources: Array.from({ length: count }, (_, index) => ({
      id: `${prefix}-${index}`,
      type: "source",
      value: `https://${prefix}-${index}.example.com/${"path/".repeat(60)}`,
      url: `https://${prefix}-${index}.example.com/${"article/".repeat(60)}`,
      title: `${prefix} ${index} ${"title ".repeat(20)}`,
      reasonDetail: "failure ".repeat(40),
    })),
  });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function memoryStorage() {
  const values = {};
  return {
    async get(keys) {
      if (keys == null) return { ...values };
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((key) => Object.hasOwn(values, key)).map((key) => [key, values[key]]));
    },
    async set(input) { Object.assign(values, input); },
    async remove(keys) { for (const key of (Array.isArray(keys) ? keys : [keys])) delete values[key]; },
    async clear() { for (const key of Object.keys(values)) delete values[key]; },
  };
}

function gatedStorage() {
  const storage = memoryStorage();
  const baseSet = storage.set.bind(storage);
  const beforeSet = [];
  let writes = 0;
  storage.set = async (input) => {
    writes += 1;
    const action = beforeSet.shift();
    if (action) await action();
    await baseSet(input);
  };
  return {
    storage,
    beforeNextSet(action) { beforeSet.push(action); },
    setCount() { return writes; },
  };
}

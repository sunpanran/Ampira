import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, SETTINGS_KEY } from "../extension/core/constants.mjs";
import { normalizeSettings } from "../extension/core/settings.mjs";
import { settingsChunkKeys } from "../extension/core/settings-storage.mjs";
import { createSettingsStore } from "../extension/core/settings-store.mjs";

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

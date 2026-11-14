import assert from "node:assert/strict";
import { createClientStateStore } from "../../extension/core/client-state.mjs";
import { CONTENT_SYNC_DATASETS, createContentSyncService, contentSyncStorageKey, parseLocalEntries, selectSyncEntries } from "../../extension/core/content-sync.mjs";
import { TOPIC_LIMIT, TRACKED_TOPICS_KEY, normalizeTrackedTopics } from "../../extension/core/tracked-topics.mjs";
import { createPersonalCardsService } from "../../extension/runtime/personal-cards-service.mjs";

await testLifecycle();
await testConcurrentRules();
await testPendingEdit();
await testRemoteValidation();

const largestTopics = Array.from({ length: TOPIC_LIMIT }, (_, index) => ({
  ...topic(`topic-${index}`), name: `${index}${"题".repeat(23)}`, words: ["词".repeat(60), "甲".repeat(60), "乙".repeat(60), "丙".repeat(17)],
}));
assert.equal(selectSyncEntries("trackedTopics", parseLocalEntries("trackedTopics", { topics: largestTopics })).length, TOPIC_LIMIT,
  "the supported eight maximum-length topic rules must fit their dataset budget");
console.log("tracked topics sync tests passed");

async function testLifecycle() {
  const cloud = memoryStorage();
  const first = device(cloud, "first", { revision: 40, topics: [topic("shared", 7)], read: [{ key: "private-first-read", at: 100 }] });
  await first.sync.initialize();
  let result = await first.cards.change({ kind: "topics", action: { type: "save", id: "shared", revision: 7, name: "Local edit", words: "science", source: "public" } });
  assert(result.ok);
  assert.deepEqual(await cloud.get(), {}, "default-off topic edits must never upload");
  await first.enable(true);
  const uploaded = Object.values(await cloud.get());
  assert.equal(uploaded.length, 1, "enabling topics alone must not enable other datasets");
  assert.deepEqual(Object.keys(uploaded[0].value).sort(), ["id", "name", "source", "words"]);
  assert(!JSON.stringify(uploaded).includes("private-first-read"), "legacy read state stays local");

  const second = device(cloud, "second", { revision: 100, topics: [], read: [{ key: "private-second-read", at: 200 }] }, true);
  await second.sync.initialize();
  assert.equal(second.state().topics[0].name, "Local edit");
  assert.equal(second.state().revision, 101, "incoming content advances this device's revision");
  assert.deepEqual(second.state().read, [{ key: "private-second-read", at: 200 }]);
  const staleRevision = first.state().topics[0].revision;
  result = await second.cards.change({ kind: "topics", action: {
    type: "save", id: "shared", revision: second.state().topics[0].revision, name: "Remote edit", words: "physics,space", source: "bookmarks",
  } });
  assert(result.ok);
  const remoteKey = await contentSyncStorageKey("trackedTopics", "shared");
  first.sync.handleStorageChanged({ [remoteKey]: { newValue: (await cloud.get())[remoteKey] } }, "sync");
  await until(() => first.state().topics[0]?.name === "Remote edit");
  assert(first.state().topics[0].revision > staleRevision, "remote updates invalidate already-open editors");
  assert(first.events.some(([type, payload]) => type === "content-sync.changed" && payload.values[TRACKED_TOPICS_KEY]), "open cards receive the merged rules");
  const stale = await first.cards.change({ kind: "topics", action: { type: "remove", id: "shared", revision: staleRevision } });
  assert.equal(stale.reason, "changed");
  result = await second.cards.change({ kind: "topics", action: { type: "remove", id: "shared", revision: second.state().topics[0].revision } });
  assert(result.ok);
  assert.equal((await cloud.get())[remoteKey].deleted, true);
  await first.refresh();
  assert.deepEqual(first.state().topics, [], "remote deletion must remove the topic without resurrection");
  assert.deepEqual(first.state().read, [{ key: "private-first-read", at: 100 }]);

  await first.cards.change({ kind: "topics", action: { type: "save", name: "Keep locally", words: "science", source: "all" } });
  const retained = first.state();
  await first.enable(false);
  assert.deepEqual(await cloud.get(), {}, "disabling topic sync removes live rules and tombstones");
  assert.deepEqual(first.state(), retained, "disabling topic sync preserves local rules");
}

async function testConcurrentRules() {
  const cloud = memoryStorage();
  const first = device(cloud, "a", { topics: [topic("a")] }, true);
  await first.sync.initialize();
  const second = device(cloud, "b", { topics: [topic("b")] }, true);
  // A local action uploads after merging the other device's already-published rule.
  const result = await second.cards.change({ kind: "topics", action: { type: "save", name: "Added", words: "space", source: "all" } });
  assert.equal(result.state.topics.length, 3, "action responses must include rules merged during synchronization");
  assert.deepEqual(JSON.parse(result.values[TRACKED_TOPICS_KEY]), result.state);
  await first.refresh();
  assert.deepEqual(ruleValues(first), ruleValues(second));

  const crowded = device(cloud, "crowded", { topics: Array.from({ length: TOPIC_LIMIT }, (_, index) => topic(`extra-${index}`)) }, true);
  await crowded.sync.initialize();
  await first.refresh(); await second.refresh();
  assert.equal(first.state().topics.length, TOPIC_LIMIT);
  assert.deepEqual(ruleValues(first), ruleValues(second));
  assert.deepEqual(ruleValues(first), ruleValues(crowded), "overlapping full topic lists converge at the eight-topic limit");

  const duplicates = memoryStorage();
  const left = device(duplicates, "left", { topics: [{ ...topic("a"), name: "Same" }] }, true);
  const right = device(duplicates, "right", { topics: [{ ...topic("z"), name: "ＳＡＭＥ", words: ["different"] }] }, true);
  await left.sync.initialize(); await right.sync.initialize(); await left.refresh();
  assert.equal(right.state().topics.length, 1);
  assert.deepEqual(ruleValues(left), ruleValues(right), "normalized duplicate names choose the same rule on both devices");
}

async function testPendingEdit() {
  const cloud = memoryStorage();
  const first = device(cloud, "pending", { topics: [topic("pending")] }, true);
  await first.sync.initialize();
  const key = await contentSyncStorageKey("trackedTopics", "pending");
  await cloud.set({ [key]: { ...(await cloud.get())[key], deleted: true, updatedAt: 2000, revision: "2000:remote-delete" } });
  const pending = first.state();
  pending.topics[0].name = "Unsynced edit"; pending.topics[0].revision += 1; pending.revision += 1;
  await first.store.save({ values: { [TRACKED_TOPICS_KEY]: JSON.stringify(pending) } });
  await first.refresh();
  assert.equal(first.state().topics[0].name, "Unsynced edit", "a pending local edit survives an older remote deletion");
  assert.equal((await cloud.get())[key].value.name, "Unsynced edit");
}

async function testRemoteValidation() {
  const cloud = memoryStorage();
  const key = await contentSyncStorageKey("trackedTopics", "bad");
  await cloud.set({ [key]: { version: 1, dataset: "trackedTopics", id: "bad", updatedAt: 100, revision: "fixture", value: topic("different-id") } });
  const first = device(cloud, "validation", {}, true);
  await first.sync.initialize();
  assert.deepEqual(first.state().topics, [], "mismatched remote identities must be ignored");
  await cloud.set({ [key]: { version: 1, dataset: "trackedTopics", id: "bad", updatedAt: 101, revision: "fixture-2",
    value: { ...topic("bad"), read: [{ key: "remote-read", at: 1 }], revision: 999, article: "remote article cache" } } });
  await first.refresh();
  assert.equal(first.state().topics[0].revision, 1, "remote payloads cannot assign local editor revisions");
  assert.deepEqual(first.state().read, []);
  assert(!JSON.stringify(first.state()).includes("remote article cache"));
  assert(CONTENT_SYNC_DATASETS.trackedTopics.maxItems === TOPIC_LIMIT);
}

function topic(id, revision = 1) { return { id, name: `Topic ${id}`, words: ["science"], source: "all", revision }; }
function ruleValues(target) { return parseLocalEntries("trackedTopics", target.state()).map(entry => entry.value); }
function device(cloud, id, initial, enabled = false) {
  let local = { [TRACKED_TOPICS_KEY]: JSON.stringify(normalizeTrackedTopics(initial)) }, serial = 0;
  let settings = { syncTrackedTopicsEnabled: enabled };
  const records = new Map(), events = [];
  const store = createClientStateStore({ getRecord: async () => structuredClone(local), setRecord: async (_key, value) => { local = structuredClone(value); } });
  const sync = createContentSyncService({ storage: cloud, clientStateStore: store, getSettings: async () => settings,
    getRecord: async (key, fallback) => records.get(key) || fallback, setRecord: async (key, value) => records.set(key, structuredClone(value)),
    now: () => 1000, randomUUID: () => `${id}-${++serial}`, broadcast: (...args) => events.push(args) });
  const cards = createPersonalCardsService({ clientStateStore: store, contentSyncService: sync, createId: () => `${id}-${++serial}`, broadcast: (...args) => events.push(args) });
  return { sync, cards, store, events, state: () => JSON.parse(local[TRACKED_TOPICS_KEY]),
    refresh: async () => { await sync.reset(); await sync.applySettings({}, settings); },
    enable: async value => { const previous = settings; settings = { syncTrackedTopicsEnabled: value }; await sync.applySettings(previous, settings); },
  };
}
function memoryStorage() {
  const records = {};
  return { get: async () => structuredClone(records), set: async values => Object.assign(records, structuredClone(values)),
    remove: async keys => { for (const key of keys) delete records[key]; } };
}
async function until(predicate) {
  for (let count = 0; count < 100; count++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail("remote topic change was not delivered");
}

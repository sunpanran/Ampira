import assert from "node:assert/strict";
import { FOCUS_STATE_KEY, applyFocusAction, focusRemaining, focusToday, normalizeFocusState, settleFocus } from "../../extension/core/focus.mjs";
import { TOPIC_LIMIT, TOPIC_READ_LIMIT, TRACKED_TOPICS_KEY, applyTopicAction, normalizeTrackedTopics } from "../../extension/core/tracked-topics.mjs";
import { selectTrackedItems, topicMatchWords } from "../../assets/client/topic-matching.mjs";
import { createClientStateStore } from "../../extension/core/client-state.mjs";
import { createPersonalCardsService } from "../../extension/runtime/personal-cards-service.mjs";
import { createPersonalCardState } from "../../assets/client/personal-card-state.mjs";
import { applyExternalStoragePatch } from "../../assets/client/storage.mjs";

export async function runPersonalCardTests() {
  testFocus();
  testTopics();
  await testRuntime();
  await testClient();
}

function testFocus() {
  let now = new Date(2026, 10, 14, 9).getTime(), serial = 0;
  const todos = [{ id: "task-1", text: "Synthetic task", completed: false }];
  let state = normalizeFocusState(null);
  const run = action => {
    const result = applyFocusAction(state, { revision: state.revision, ...action }, { now, todos, createId: () => "session-" + ++serial });
    if (result.ok) state = result.state;
    return result;
  };
  assert.equal(focusRemaining(state, now), 25 * 60_000);
  assert.equal(run({ type: "configure", taskId: "missing" }).reason, "taskMissing");
  assert.equal(run({ type: "configure", settings: { focusMinutes: 0 } }).reason, "invalid");
  assert(run({ type: "configure", taskId: "task-1" }).ok);
  assert(run({ type: "start" }).ok);
  const firstId = state.session.id, firstDeadline = state.session.endsAt;
  assert.equal(run({ type: "start" }).reason, "changed", "a second start cannot overwrite a live timer");
  assert.equal(run({ type: "configure", settings: { focusMinutes: 60 } }).reason, "active");
  now += 90_000;
  assert.equal(focusRemaining(state, now), 23.5 * 60_000);
  assert.equal(focusToday(state, now).ms, 90_000);
  assert(run({ type: "pause" }).ok);
  const paused = structuredClone(state);
  now += 5 * 60_000;
  assert.equal(focusRemaining(state, now), focusRemaining(paused, now));
  assert.equal(focusToday(state, now).ms, 90_000, "paused time is not included in focus totals");
  assert(run({ type: "configure", settings: { showToday: false } }).ok);
  assert.equal(state.session.phase, "paused", "display preferences preserve an active session");
  assert(run({ type: "resume" }).ok);
  assert.equal(state.session.id, firstId);
  assert.equal(state.session.endsAt, firstDeadline + 5 * 60_000);
  const serialized = JSON.parse(JSON.stringify(state));
  assert.deepEqual(normalizeFocusState(serialized), state, "timer survives worker or new-tab restarts");
  now = state.session.endsAt + 60_000;
  state = settleFocus(serialized, now);
  assert.equal(state.session.phase, "done");
  assert.equal(state.session.naturalEnd, true);
  assert.equal(focusToday(state, now).ms, 25 * 60_000);
  assert.equal(focusToday(state, now).rounds, 1);
  assert.deepEqual(settleFocus(state, now + 60_000), state, "completion must be counted exactly once");
  assert.equal(todos[0].completed, false, "a completed timer never completes its task automatically");
  const completion = run({ type: "completeTask" });
  assert.equal(completion.todos[0].completed, true);
  assert.equal(completion.todos[0].completedAt, new Date(now).toISOString());
  const stale = applyFocusAction(state, { type: "start", revision: state.revision - 1 }, { now, todos });
  assert.equal(stale.reason, "changed");
  assert(run({ type: "start" }).ok);
  assert.equal(state.session.mode, "break");
  assert.equal(state.session.durationMs, 5 * 60_000);
  now = state.session.endsAt;
  state = settleFocus(state, now);
  assert.equal(focusToday(state, now).ms, 25 * 60_000, "breaks do not count toward focus time");
  assert.equal(focusToday(state, now).rounds, 1);
  assert(run({ type: "start" }).ok);
  now += 61_000;
  assert(run({ type: "end" }).ok);
  assert.equal(state.session.naturalEnd, false);
  assert.equal(focusToday(state, now).ms, 26 * 60_000 + 1000);
  assert.equal(focusToday(state, now).rounds, 2);
  const missingTask = applyFocusAction(state, { type: "completeTask", revision: state.revision }, { now, todos: [] });
  assert.equal(missingTask.reason, "taskMissing", "deleted tasks must not be recreated");

  now = new Date(2026, 10, 14, 23, 50).getTime();
  state = normalizeFocusState(null);
  run({ type: "start" });
  state = settleFocus(state, new Date(2026, 10, 16, 9).getTime());
  assert.deepEqual(state.days, [
    { date: "2026-11-14", ms: 10 * 60_000, rounds: 0 },
    { date: "2026-11-15", ms: 15 * 60_000, rounds: 1 },
  ], "closed-tab completion splits actual focus time at local midnight");
  assert.equal(focusToday(state, new Date(2026, 10, 16, 9).getTime()).ms, 0);
  const normalized = normalizeFocusState({ settings: { focusMinutes: 999, breakMinutes: -1 }, session: { id: "<bad>", phase: "running" } });
  assert.equal(normalized.settings.focusMinutes, 25); assert.equal(normalized.session, null);
}

function testTopics() {
  let state = normalizeTrackedTopics(null), serial = 0;
  const run = action => {
    const result = applyTopicAction(state, action, { createId: () => "topic-" + ++serial });
    if (result.ok) state = result.state;
    return result;
  };
  assert.equal(run({ type: "save", name: " ", words: "AI", source: "all" }).reason, "nameRequired");
  assert.equal(run({ type: "save", name: "AI", words: ",，", source: "all" }).reason, "keywordsRequired");
  assert.equal(run({ type: "save", name: "Too many", words: Array.from({ length: 13 }, (_, index) => "word" + index), source: "all" }).reason, "keywordsLimit");
  assert.equal(run({ type: "save", name: "Long", words: "a".repeat(61), source: "all" }).reason, "keywordsLimit");
  const added = run({ type: "save", name: "AI 视频", words: "AI, ai，视频生成, ＡＩ", source: "all" });
  assert(added.ok); assert.deepEqual(state.topics[0].words, ["AI", "视频生成"]);
  assert.equal(run({ type: "save", name: "ＡＩ 视频", words: "AI", source: "all" }).reason, "duplicate");
  const topic = structuredClone(state.topics[0]);
  const items = [
    { key: "a", feedItem: { title: "AI video tools", sourceKey: "public-tech", publishedAt: "2026-11-14T10:00:00Z" } },
    { key: "b", feedItem: { title: "Paid software", excerpt: "Video tutorials", sourceKey: "bookmark-1", publishedAt: "2026-11-14T09:00:00Z" } },
    { key: "c", feedItem: { title: "如何改进视频生成", sourceKey: "bookmark-1", publishedAt: "2026-11-14T08:00:00Z" } },
    { key: "d", feedItem: { title: "Video workflow", sourceKey: "bookmark-1" }, summary: { title: "AI 工作流", description: "Synthetic" } },
  ];
  assert.deepEqual(selectTrackedItems(items, topic).map(entry => entry.key), ["a", "c", "d"], "match translated and original content, never partial English words");
  assert.deepEqual(selectTrackedItems(items, { ...topic, source: "public" }).map(entry => entry.key), ["a"]);
  assert.deepEqual(selectTrackedItems(items, { ...topic, source: "bookmarks" }).map(entry => entry.key), ["c", "d"]);
  assert.deepEqual(topicMatchWords(items[1], topic), []);
  assert.deepEqual(selectTrackedItems([...items, items[0]], topic).map(entry => entry.key), ["a", "c", "d"]);
  assert.deepEqual(selectTrackedItems(items, topic, { seen: new Set(["a"]), dismissed: new Set(["c"]), onlyUnread: true }).map(entry => entry.key), ["a", "d"],
    "read items remain visible while explicitly dismissed items stay excluded");
  state = normalizeTrackedTopics({ ...state, read: [{ key: "a", at: 100_000 }, { key: "c", at: 100_000 }] });
  assert.deepEqual(selectTrackedItems([...items].reverse(), topic, { read: state.read, seen: new Set(["d"]), onlyUnread: true }).map(entry => entry.key), ["a", "c", "d"],
    "legacy unread preferences and read markers cannot hide content or change newest-first ordering");
  const legacyState = structuredClone(state);
  assert.equal(run({ type: "read", keys: ["d"] }).reason, "invalid", "removed read controls must not leave an active write workflow");
  assert.deepEqual(state, legacyState, "rejecting an obsolete action preserves topics and legacy records");
  assert(run({ type: "save", id: topic.id, revision: topic.revision, name: "Video", words: "视频生成", source: "bookmarks" }).ok);
  assert.equal(run({ type: "save", id: topic.id, revision: topic.revision, name: "Stale", words: "AI", source: "all" }).reason, "changed");
  assert.equal(run({ type: "remove", id: topic.id, revision: topic.revision }).reason, "changed");
  assert(run({ type: "remove", id: topic.id, revision: state.topics[0].revision }).ok);
  assert.equal(run({ type: "save", id: topic.id, revision: 2, name: "Stale", words: "AI", source: "all" }).reason, "removed");
  for (let i = 0; i < TOPIC_LIMIT; i++) assert(run({ type: "save", name: "Topic " + i, words: "AI", source: "all" }).ok);
  assert.equal(run({ type: "save", name: "Overflow", words: "AI", source: "all" }).reason, "limit");
  assert(normalizeTrackedTopics({ read: Array.from({ length: 1500 }, (_, index) => ({ key: String(index), at: index + 1 })) }).read.length === TOPIC_READ_LIMIT);
}

async function testRuntime() {
  let record = { "dash.utility.todos.v1": JSON.stringify([{ id: "task", text: "Fixture", completed: false, createdAt: "2026-11-14T01:00:00Z", completedAt: "" }]) };
  let now = new Date(2026, 10, 14, 10).getTime(), serial = 0;
  const broadcasts = [], synced = [];
  const store = createClientStateStore({ getRecord: async () => structuredClone(record), setRecord: async (key, value) => { record = structuredClone(value); } });
  const service = createPersonalCardsService({ clientStateStore: store, now: () => now, createId: () => "id-" + ++serial,
    broadcast: (...args) => broadcasts.push(args), contentSyncService: { handleLocalPatch: async value => {
      synced.push(value);
      if (!Object.hasOwn(value, "dash.utility.todos.v1")) return;
      const todos = JSON.parse(value["dash.utility.todos.v1"]);
      await store.save({ values: { "dash.utility.todos.v1": JSON.stringify([...todos,
        { id: "merged-task", text: "Concurrent sync fixture", completed: false, createdAt: new Date(now).toISOString(), completedAt: "" },
      ]) } });
    } } });
  let result = await service.read({ kind: "focus" });
  result = await service.change({ kind: "focus", action: { type: "configure", taskId: "task", revision: result.state.revision } });
  assert(result.ok);
  const revision = result.state.revision;
  const starts = await Promise.all([1, 2].map(() => service.change({ kind: "focus", action: { type: "start", revision } })));
  assert.equal(starts.filter(outcome => outcome.ok).length, 1, "simultaneous tabs cannot create two sessions");
  now += 25 * 60_000;
  const completed = await Promise.all([service.read({ kind: "focus" }), service.read({ kind: "focus" })]);
  assert.equal(completed[1].state.days[0].rounds, 1, "multiple tabs settle the same session only once");
  assert.equal(synced.length, 0, "focus sessions and statistics never enter browser-account sync");
  result = await service.change({ kind: "focus", action: { type: "completeTask", revision: completed[1].state.revision } });
  assert.equal(JSON.parse(record["dash.utility.todos.v1"])[0].completed, true);
  assert.equal(synced.length, 1, "explicit task completion follows the existing to-do sync policy");
  assert.equal(JSON.parse(result.values["dash.utility.todos.v1"]).length, 2, "completion replies preserve changes merged during content sync");
  assert.deepEqual(Object.keys(synced[0]), ["dash.utility.todos.v1"]);
  await Promise.all(["One", "Two"].map(name => service.change({ kind: "topics", action: { type: "save", name, words: "AI", source: "all" } })));
  const topics = await service.read({ kind: "topics" });
  assert.deepEqual(topics.state.topics.map(topic => topic.name), ["One", "Two"], "independent topic additions merge through the storage queue");
  assert(synced.slice(1).every(value => Object.hasOwn(value, TRACKED_TOPICS_KEY)), "topic edits must reach the opt-in content sync service");
  assert(record[FOCUS_STATE_KEY] && record[TRACKED_TOPICS_KEY]);
  assert(broadcasts.every(([type]) => type === "personal-cards.changed"));
  const writes = broadcasts.length;
  await service.read({ kind: "focus" }); await service.read({ kind: "topics" });
  assert.equal(broadcasts.length, writes, "stable reads neither write nor rebroadcast state");
  await store.reset();
  assert.equal((await service.read({ kind: "focus" })).state.session, null);
  assert.equal((await service.read({ kind: "topics" })).state.topics.length, 0);
}

async function testClient() {
  const responses = [];
  let notifications = 0;
  const model = createPersonalCardState({ kind: "focus", key: FOCUS_STATE_KEY, normalize: normalizeFocusState, initialState: null,
    notify: () => notifications++, request: () => new Promise(resolve => responses.push(resolve)) });
  const first = model.ensure();
  assert.equal(model.ensure(), first);
  await Promise.resolve(); await Promise.resolve();
  responses[0]({ ok: true, state: { revision: 2 }, values: {} });
  await first;
  assert.equal(model.read().value.revision, 2);
  const pending = model.ensure({ force: true });
  await Promise.resolve(); await Promise.resolve();
  applyExternalStoragePatch({ [FOCUS_STATE_KEY]: JSON.stringify({ revision: 4, settings: { focusMinutes: 60 } }) });
  model.syncFromStorage();
  responses[1]({ ok: true, state: { revision: 3, settings: { focusMinutes: 25 } }, values: { [FOCUS_STATE_KEY]: JSON.stringify({ revision: 3 }) } });
  await pending;
  model.syncFromStorage();
  assert.equal(model.read().value.revision, 4);
  assert.equal(model.read().value.settings.focusMinutes, 60, "late responses cannot overwrite a newer broadcast or its storage snapshot");
  assert(notifications > 0);
}

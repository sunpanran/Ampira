import assert from "node:assert/strict";
import { CALENDAR_STATE_KEY, CALENDAR_EVENT_LIMIT, CALENDAR_TITLE_LIMIT, applyCalendarAction, calendarEventsOnDate, normalizeCalendarState } from "../../extension/core/calendar.mjs";
import { createClientStateStore } from "../../extension/core/client-state.mjs";
import { createPersonalCardsService } from "../../extension/runtime/personal-cards-service.mjs";
import { createCalendarCardState } from "../../assets/client/calendar-card-state.mjs";
import { applyExternalStoragePatch } from "../../assets/client/storage.mjs";

export async function runCalendarTests() {
  const valid = { id: "first", revision: 1, title: "  Calendar   fixture  ", date: "2028-02-29", time: "09:30" };
  const normalized = normalizeCalendarState({ revision: 3, items: [valid, valid,
    { ...valid, id: "bad-date", date: "2027-02-29" }, { ...valid, id: "bad-time", time: "24:00" },
    { ...valid, id: "all-day", time: "" }, { ...valid, id: "empty", title: " " },
  ] });
  assert.deepEqual(normalized.items.map(item => item.id), ["first", "all-day"]);
  assert.equal(normalized.items[0].title, "Calendar fixture");
  assert.equal(normalized.revision, 3);
  assert.deepEqual(calendarEventsOnDate(normalized, "2028-02-29").map(item => item.id), ["all-day", "first"]);
  assert.deepEqual(calendarEventsOnDate(normalized, "2028-03-01"), []);
  assert.equal(normalizeCalendarState({ revision: Infinity }).revision, 0);

  let state = normalizeCalendarState(null), serial = 0;
  const run = action => { const result = applyCalendarAction(state, action, { createId: () => "event-" + ++serial }); state = result.state; return result; };
  const draft = { type: "save", title: "Fixture", date: "2026-11-14", time: "14:00" };
  assert.equal(run({ ...draft, title: " " }).reason, "titleRequired");
  assert.equal(run({ ...draft, title: "x".repeat(CALENDAR_TITLE_LIMIT + 1) }).reason, "titleLimit");
  for (const date of ["2026-02-29", "2026-04-31", "0000-01-01", "not-a-date"]) assert.equal(run({ ...draft, date }).reason, "dateRequired");
  for (const time of ["9:30", "12:60", "24:00", 15]) assert.equal(run({ ...draft, time }).reason, "timeInvalid");
  assert.equal(state.revision, 0, "rejected changes must leave the revision and content intact");
  const added = run(draft), item = structuredClone(state.items[0]);
  assert(added.ok);
  assert(run({ ...draft, title: "Independent addition", time: "" }).ok);
  assert(run({ ...draft, id: item.id, revision: item.revision, title: "Updated", date: "2028-02-29" }).ok,
    "editing one event survives an unrelated addition");
  assert.equal(run({ ...draft, id: item.id, revision: item.revision }).reason, "changed");
  assert.equal(run({ type: "remove", id: item.id, revision: item.revision }).reason, "changed");
  assert(run({ type: "remove", id: item.id, revision: state.items[0].revision }).ok);
  assert.equal(run({ ...draft, id: item.id, revision: 2 }).reason, "removed", "stale edits cannot resurrect deleted events");
  const roundTrip = normalizeCalendarState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(roundTrip, state);
  while (state.items.length < CALENDAR_EVENT_LIMIT) assert(run(draft).ok);
  assert.equal(run(draft).reason, "limit");
  assert.equal(state.items.length, CALENDAR_EVENT_LIMIT);
  const first = state.items[0];
  assert(run({ ...draft, id: first.id, revision: first.revision, title: "Edit at capacity" }).ok);

  await testRuntime();
  await testClient();
}

async function testRuntime() {
  let record = {}, serial = 0, rejectWrite = false;
  const broadcasts = [], synced = [];
  const store = createClientStateStore({ getRecord: async () => structuredClone(record), setRecord: async (key, value) => {
    if (rejectWrite) throw new Error("Synthetic storage failure");
    record = structuredClone(value);
  } });
  const service = createPersonalCardsService({ clientStateStore: store, createId: () => "stored-" + ++serial,
    broadcast: (...args) => broadcasts.push(args), contentSyncService: { handleLocalPatch: async value => synced.push(value) } });
  await service.read({ kind: "calendar" });
  const additions = await Promise.all(["One", "Two"].map(title => service.change({ kind: "calendar", action: { type: "save", title, date: "2026-11-14", time: "12:00" } })));
  assert(additions.every(result => result.ok));
  let current = await service.read({ kind: "calendar" });
  assert.deepEqual(current.state.items.map(item => item.title), ["One", "Two"], "simultaneous tabs must retain independent additions");
  const item = current.state.items[0];
  const edits = await Promise.all(["First change", "Stale change"].map(title => service.change({ kind: "calendar", action: { type: "save", ...item, title } })));
  assert.equal(edits.filter(result => result.ok).length, 1);
  assert.equal(edits[1].reason, "changed");
  assert(synced.every(patch => Object.keys(patch).join() === CALENDAR_STATE_KEY), "calendar mutations delegate only their own state to the opt-in sync service");
  const count = broadcasts.length;
  await service.read({ kind: "calendar" });
  assert.equal(broadcasts.length, count, "stable reads must not rewrite or rebroadcast events");
  assert(broadcasts.every(([type, payload]) => type === "personal-cards.changed" && Object.keys(payload.values).join() === CALENDAR_STATE_KEY));
  const before = structuredClone(record);
  rejectWrite = true;
  await assert.rejects(service.change({ kind: "calendar", action: { type: "save", title: "Unsaved", date: "2026-11-14" } }), /Synthetic/);
  assert.deepEqual(record, before); assert.equal(broadcasts.length, count);
  rejectWrite = false;
  await store.reset(); current = await service.read({ kind: "calendar" });
  assert.equal(current.state.items.length, 0, "factory reset removes the local calendar record");
}

async function testClient() {
  let now = new Date(2026, 10, 14, 23, 59), notifications = 0, fail = true;
  const requests = [];
  const shared = createCalendarCardState({ initialState: null, now: () => now, notify: () => notifications++, request: message => {
    requests.push(message);
    if (fail) throw new Error("Synthetic connection failure");
    return { ok: true, state: { revision: 2, items: [] }, values: {} };
  } });
  await shared.ensure(); assert(shared.read().error); assert(!shared.read().loaded);
  fail = false; await shared.ensure({ force: true });
  assert.equal(shared.read().error, null); assert(shared.read().loaded);
  assert.equal(shared.today(), "2026-11-14"); assert.equal(shared.refreshDay(), false);
  now = new Date(2026, 10, 15, 0, 1); assert.equal(shared.refreshDay(), true); assert.equal(shared.today(), "2026-11-15");
  applyExternalStoragePatch({ [CALENDAR_STATE_KEY]: JSON.stringify({ revision: 3, items: [{ id: "remote", revision: 1, title: "Another tab", date: "2026-11-15", time: "" }] }) });
  shared.syncFromStorage();
  assert.equal(shared.read().value.items[0].title, "Another tab");
  await shared.ensure({ force: true });
  assert.equal(shared.read().value.revision, 3, "late snapshots cannot overwrite newer calendar broadcasts");
  assert(requests.every(message => message.type === "personal-cards:get" && message.payload.kind === "calendar"));
  assert(notifications > 0);
}

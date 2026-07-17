import assert from "node:assert/strict";
import { createClientStateStore } from "../../extension/core/client-state.mjs";

export async function runClientStateStoreTests() {
  let clientState = {};
  const clientStateStore = createClientStateStore({
    async getRecord() { return { ...clientState }; },
    async setRecord(key, value) {
      assert.equal(key, "client-state");
      await Promise.resolve();
      clientState = value;
    },
  });

  await Promise.all([
    clientStateStore.save({ values: { "dash.one": "1" } }),
    clientStateStore.save({ values: { "dash.two": "2" } }),
  ]);
  assert.deepEqual(clientState, { "dash.one": "1", "dash.two": "2" });

  let redundantReads = 0;
  let redundantWrites = 0;
  const deduplicatingStore = createClientStateStore({
    async getRecord() { redundantReads += 1; return { "dash.same": "value" }; },
    async setRecord() { redundantWrites += 1; },
  });
  await deduplicatingStore.save({ values: {} });
  assert.equal(redundantReads, 0, "empty client-state patches must skip storage reads");
  await deduplicatingStore.save({ values: { "dash.same": "value" } });
  assert.equal(redundantReads, 1, "non-empty patches must compare against current state");
  assert.equal(redundantWrites, 0, "unchanged client-state patches must skip full-record writes");

  await assert.rejects(clientStateStore.save({ values: { invalid: "value" } }), invalidState);
  await assert.rejects(clientStateStore.save({ values: { [`dash.${"x".repeat(92)}`]: "value" } }), invalidState);
  await assert.rejects(clientStateStore.save({
    values: Object.fromEntries(Array.from({ length: 101 }, (_, index) => [`dash.limit.${index}`, "x"])),
  }), invalidState);
  await assert.rejects(clientStateStore.save({ values: { "dash.multibyte": "界".repeat(180000) } }), invalidState);

  await clientStateStore.reset();
  assert.deepEqual(await clientStateStore.read(), {}, "factory reset must drain queued client-state writes and replace the stored state");

  const oversizedStateStore = createClientStateStore({
    async getRecord() { return {}; },
    async setRecord() { assert.fail("oversized aggregate state must not be persisted"); },
  });
  await assert.rejects(oversizedStateStore.save({
    values: Object.fromEntries(Array.from({ length: 5 }, (_, index) => [
      `dash.large.${index}`,
      "x".repeat(450000),
    ])),
  }), (error) => error.code === "CLIENT_STATE_TOO_LARGE");

  let writeAttempts = 0;
  const recoveringStateStore = createClientStateStore({
    async getRecord() { return {}; },
    async setRecord() {
      writeAttempts += 1;
      if (writeAttempts === 1) throw new Error("temporary write failure");
    },
  });
  await assert.rejects(recoveringStateStore.save({ values: { "dash.first": "1" } }));
  await recoveringStateStore.save({ values: { "dash.second": "2" } });
  assert.equal(writeAttempts, 2, "a failed state write must not poison the serialized mutation queue");
}

function invalidState(error) {
  return error.code === "INVALID_CLIENT_STATE";
}

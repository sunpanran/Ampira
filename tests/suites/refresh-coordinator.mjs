import assert from "node:assert/strict";
import { createRefreshCoordinator } from "../../extension/core/refresh-coordinator.mjs";
import { retainActiveUnrefreshedItems } from "../../extension/core/refresh.mjs";

let releaseInitialStatus;
let releaseFirstRun;
let statusReads = 0;
let runCount = 0;
let firstRunContext = null;
const initialStatus = new Promise((resolve) => { releaseInitialStatus = resolve; });
const firstRun = new Promise((resolve) => { releaseFirstRun = resolve; });
const coordinator = createRefreshCoordinator({
  getStatus: async () => {
    statusReads += 1;
    if (statusReads === 1) return initialStatus;
    return { running: runCount > 0 };
  },
  run: async (_generation, context) => {
    runCount += 1;
    if (runCount === 1) firstRunContext = context;
    if (runCount === 1) await firstRun;
  },
});

const firstStart = coordinator.start(true);
const concurrentStart = coordinator.start(true);
assert.deepEqual(await concurrentStart, {
  started: false,
  queued: true,
  status: { running: false },
}, "a concurrent forced refresh must queue behind the synchronous start claim");
releaseInitialStatus({ running: false });
assert.equal((await firstStart).started, true);
await Promise.resolve();
assert.equal(runCount, 1, "concurrent starts must not create duplicate refresh operations");
assert.deepEqual(firstRunContext, { force: true }, "forced refreshes must expose their user-initiated context to the refresh pipeline");

releaseFirstRun();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(runCount, 2, "one forced request received during a refresh must run once afterward");

let freshRuns = 0;
const freshStatus = { finishedAt: "2026-07-11T00:00:00.000Z" };
const freshCoordinator = createRefreshCoordinator({
  getStatus: async () => freshStatus,
  isFresh: (status) => status === freshStatus,
  run: async () => { freshRuns += 1; },
});
assert.deepEqual(await freshCoordinator.start(false), { started: false, status: freshStatus });
assert.equal(freshRuns, 0, "a recent successful refresh must not run again without force");

let observedGeneration = 0;
const invalidatedCoordinator = createRefreshCoordinator({
  getStatus: async () => ({}),
  run: async (generation) => { observedGeneration = generation; },
});
await invalidatedCoordinator.start(true);
assert.equal(invalidatedCoordinator.isCurrent(observedGeneration), true);
invalidatedCoordinator.invalidate();
assert.equal(invalidatedCoordinator.isCurrent(observedGeneration), false, "cache clearing must invalidate an in-flight generation");

const previousItems = [
  { sourceKey: "empty-source", title: "old empty result" },
  { sourceKey: "error-source", title: "last successful result" },
];
assert.deepEqual(retainActiveUnrefreshedItems(
  previousItems,
  [{ key: "empty-source" }, { key: "error-source" }],
  [{ key: "empty-source" }],
), [{ sourceKey: "error-source", title: "last successful result" }], "a successful empty refresh should clear old items while a failed source retains its last successful items");

console.log("refresh coordinator tests passed");

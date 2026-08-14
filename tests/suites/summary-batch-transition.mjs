import assert from "node:assert/strict";
import { createBatchTransition } from "../../assets/client/batch-transition.mjs";
import { createSummaryBatchTransition } from "../../assets/client/summary-batch-transition.mjs";

export async function runSummaryBatchTransitionTests() {
  testImmediateFallback();
  testReducedMotionFallback();
  testBackgroundPageFallback();
  testStartFailureFallback();
  await testPreparedContextLifecycle();
  await testRequestContextLifecycle();
  await testScopedTransitionLifecycle();
  await testRapidRequestsUseLatestUpdate();
  await testCancelInvalidatesPendingUpdate();
}

function testImmediateFallback() {
  const root = createRoot();
  let updates = 0;
  const controller = createSummaryBatchTransition({
    documentNode: { documentElement: root },
    prefersReducedMotion: () => false,
    update: () => { updates += 1; },
  });
  assert.equal(controller.run(), null);
  assert.equal(updates, 1, "missing View Transition support must update the batch immediately");
  assert.equal(root.classList.contains("is-summary-batch-transitioning"), false);
}

function testReducedMotionFallback() {
  const harness = createTransitionHarness();
  let updates = 0;
  const controller = createSummaryBatchTransition({
    documentNode: harness.documentNode,
    prefersReducedMotion: () => true,
    update: () => { updates += 1; },
  });
  assert.equal(controller.run(), null);
  assert.equal(updates, 1, "reduced motion must update the batch without starting a transition");
  assert.equal(harness.records.length, 0);
}

function testBackgroundPageFallback() {
  const harness = createTransitionHarness();
  harness.documentNode.visibilityState = "hidden";
  let updates = 0;
  const controller = createSummaryBatchTransition({
    documentNode: harness.documentNode,
    prefersReducedMotion: () => false,
    update: () => { updates += 1; },
  });
  assert.equal(controller.run(), null);
  assert.equal(updates, 1, "background pages must update the batch without starting a transition");
  assert.equal(harness.records.length, 0);
  assert.equal(harness.root.classList.contains("is-summary-batch-transitioning"), false);
}

function testStartFailureFallback() {
  const root = createRoot();
  let cleanups = 0;
  let preparations = 0;
  let updates = 0;
  const controller = createSummaryBatchTransition({
    cleanup: () => { cleanups += 1; },
    documentNode: {
      documentElement: root,
      startViewTransition() { throw new Error("transition unavailable"); },
    },
    prefersReducedMotion: () => false,
    prepare: () => {
      preparations += 1;
      return { prepared: true };
    },
    update: () => { updates += 1; },
  });
  assert.equal(controller.run(), null);
  assert.equal(preparations, 1);
  assert.equal(cleanups, 1, "a failed transition start must clean prepared snapshot names");
  assert.equal(updates, 1, "a failed transition start must still render the requested batch");
  assert.equal(root.classList.contains("is-summary-batch-transitioning"), false);
}

async function testPreparedContextLifecycle() {
  const harness = createTransitionHarness();
  const context = { nextCardCount: 16 };
  let cleaned = false;
  let receivedContext = null;
  const controller = createSummaryBatchTransition({
    cleanup: () => { cleaned = true; },
    documentNode: harness.documentNode,
    prefersReducedMotion: () => false,
    prepare: () => context,
    update: (value) => { receivedContext = value; },
  });
  controller.run();
  await harness.records[0].update();
  assert.equal(receivedContext, context, "the prepared slot mapping must reach the transition update");
  assert.equal(cleaned, false);
  harness.records[0].finish();
  await settlePromises();
  assert.equal(cleaned, true, "completed transitions must clean inline snapshot names");
}

async function testRequestContextLifecycle() {
  const harness = createTransitionHarness();
  let received = null;
  const controller = createBatchTransition({
    activeClass: "is-daily-batch-transitioning",
    documentNode: harness.documentNode,
    prefersReducedMotion: () => false,
    prepare: (columnId) => ({ columnId, nextCardCount: 5 }),
    update: (context, columnId) => { received = { columnId, context }; },
  });
  controller.run("inspiration");
  assert.equal(harness.root.classList.contains("is-daily-batch-transitioning"), true);
  await harness.records[0].update();
  assert.deepEqual(received, {
    columnId: "inspiration",
    context: { columnId: "inspiration", nextCardCount: 5 },
  }, "the generic transition must preserve the requested daily column through prepare and update");
  harness.records[0].finish();
  await settlePromises();
  assert.equal(harness.root.classList.contains("is-daily-batch-transitioning"), false);
}

async function testScopedTransitionLifecycle() {
  const harness = createTransitionHarness();
  let updates = 0;
  const controller = createSummaryBatchTransition({
    documentNode: harness.documentNode,
    prefersReducedMotion: () => false,
    update: () => { updates += 1; },
  });
  const transition = controller.run();
  assert.equal(transition, harness.records[0].transition);
  assert.equal(harness.root.classList.contains("is-summary-batch-transitioning"), true);
  await harness.records[0].update();
  assert.equal(updates, 1);
  harness.records[0].finish();
  await settlePromises();
  assert.equal(harness.root.classList.contains("is-summary-batch-transitioning"), false, "finished transitions must clean their scoped class");
}

async function testRapidRequestsUseLatestUpdate() {
  const harness = createTransitionHarness();
  let updates = 0;
  const controller = createSummaryBatchTransition({
    documentNode: harness.documentNode,
    prefersReducedMotion: () => false,
    update: () => { updates += 1; },
  });
  controller.run();
  controller.run();
  assert.equal(harness.records[0].skipCount, 1, "a new batch request must skip the active visual transition");
  await harness.records[0].update();
  assert.equal(updates, 0, "a canceled transition callback must not repaint a stale batch");
  await harness.records[1].update();
  assert.equal(updates, 1, "the latest rapid request must repaint exactly once");
  harness.records[1].finish();
  await settlePromises();
  assert.equal(harness.root.classList.contains("is-summary-batch-transitioning"), false);
}

async function testCancelInvalidatesPendingUpdate() {
  const harness = createTransitionHarness();
  let cleanups = 0;
  let updates = 0;
  const controller = createSummaryBatchTransition({
    cleanup: () => { cleanups += 1; },
    documentNode: harness.documentNode,
    prefersReducedMotion: () => false,
    update: () => { updates += 1; },
  });
  controller.run();
  controller.cancel();
  assert.equal(harness.records[0].skipCount, 1);
  assert.equal(cleanups, 1, "sorting or refreshing must clean prepared snapshot names");
  await harness.records[0].update();
  assert.equal(updates, 0, "sorting or refreshing must invalidate a pending batch repaint");
  assert.equal(harness.root.classList.contains("is-summary-batch-transitioning"), false);
}

function createTransitionHarness() {
  const root = createRoot();
  const records = [];
  const documentNode = {
    documentElement: root,
    startViewTransition(update) {
      let resolveFinished;
      const finished = new Promise((resolve) => { resolveFinished = resolve; });
      const record = {
        finish: resolveFinished,
        skipCount: 0,
        update,
      };
      record.transition = {
        ready: Promise.resolve(),
        finished,
        skipTransition() {
          record.skipCount += 1;
          resolveFinished();
        },
      };
      records.push(record);
      return record.transition;
    },
  };
  return { documentNode, records, root };
}

function createRoot() {
  const classes = new Set();
  return {
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      contains: (name) => classes.has(name),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
    },
  };
}

async function settlePromises() {
  await Promise.resolve();
  await Promise.resolve();
}

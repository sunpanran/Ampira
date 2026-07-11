import assert from "node:assert/strict";
import { createEpochMutationQueue } from "../extension/core/mutation-queue.mjs";

const queue = createEpochMutationQueue();
const order = [];
let releaseFirst;
const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
const first = queue.run(async () => {
  order.push("first-start");
  await firstGate;
  order.push("first-end");
});
const second = queue.run(async () => {
  order.push("second");
});
await Promise.resolve();
assert.deepEqual(order, ["first-start"], "mutations must not overlap");
releaseFirst();
await Promise.all([first, second]);
assert.deepEqual(order, ["first-start", "first-end", "second"], "queued cleanup must run after an in-flight commit");

const staleEpoch = queue.capture();
queue.invalidate();
let staleRan = false;
assert.equal(await queue.run(async () => { staleRan = true; }, staleEpoch), undefined);
assert.equal(staleRan, false, "an invalidated operation must not enter its commit section");

await assert.rejects(queue.run(async () => { throw new Error("expected"); }), /expected/);
let recovered = false;
await queue.run(async () => { recovered = true; });
assert.equal(recovered, true, "a failed mutation must not poison later cleanup work");

console.log("mutation queue tests passed");

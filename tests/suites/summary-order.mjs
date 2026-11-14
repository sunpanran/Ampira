import assert from "node:assert/strict";
import { createSummaryView } from "../../assets/client/summary-view.mjs";

function node() {
  const attributes = new Map();
  return {
    dataset: {}, children: [], disabled: false,
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: (name) => attributes.delete(name),
    querySelector: () => null, querySelectorAll: () => [], matches: () => false,
    replaceChildren(...children) { this.children = children; },
  };
}

const state = { data: { feed: { items: [] } }, variants: { summary: 0 }, summaryOrder: "time" };
let selectValue = "importance", selectionUpdates = 0;
const select = {
  get value() { return selectValue; },
  set value(value) { selectValue = value; selectionUpdates++; },
};
const els = { summaryGrid: node(), summaryBatch: node(), summaryMeta: node(), summaryOrder: select };
const writes = [];
const view = createSummaryView({
  state, els, t: key => key,
    isNewsCard: () => false,
   batchLabel: () => "",
  createEmptyState: () => node(), prefersReducedMotion: () => true,
  writeValue: (...args) => writes.push(args),
});

view.renderSummaries({ immediate: true });
assert.equal(select.value, "time", "a saved time order must replace the select's default importance value, even with no articles");
const updatesAfterRestore = selectionUpdates;
view.renderSummaries({ immediate: true });
assert.equal(selectionUpdates, updatesAfterRestore, "an unchanged refresh must not reset the combobox's in-progress keyboard choice");
state.summaryOrder = "importance";
view.renderSummaries({ immediate: true });
assert.equal(select.value, "importance", "later renders must reflect the current order in the native select");
state.summaryOrder = "obsolete";
view.renderSummaries({ immediate: true });
assert.equal(select.value, "importance", "an unrecognized saved order must retain the default visible choice");
assert.deepEqual(writes, [], "rendering the selected order must not persist settings or reset saved batches");
console.log("Summary order tests passed");

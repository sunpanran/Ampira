import assert from "node:assert/strict";
import { createSummaryView } from "../../assets/client/summary-view.mjs";

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function node() {
  const attributes = new Map(), classes = new Set();
  return Object.assign(new EventTarget(), {
    dataset: {}, children: [], disabled: false,
    classList: { add: (...names) => names.forEach(name => classes.add(name)), remove: (...names) => names.forEach(name => classes.delete(name)) },
    setAttribute: (key, value) => attributes.set(key, value), getAttribute: key => attributes.get(key), removeAttribute: key => attributes.delete(key),
    querySelector: () => null, querySelectorAll: () => [], matches: () => false,
    replaceChildren(...children) { this.children = children; },
  });
}

function harness() {
  const confirmation = deferred(), response = deferred(), started = deferred();
  const state = { data: { feed: { items: [] } }, variants: { summary: 0 }, manualRefreshKeys: new Set(), dismissed: new Set() };
  const button = node(), card = node(), requests = [], invocations = [];
  button.closest = () => card;
  const view = createSummaryView({
    state, els: { summaryGrid: node(), summaryBatch: node(), summaryMeta: node(), summaryOrder: node() },
    confirmManualAiUsage: () => confirmation.promise,
    apiPost: async (url, body) => { requests.push({ url, body }); started.resolve(); return response.promise; },
    itemUrl: item => item.url, t: key => key, createThemedIcon: () => node(), srOnly: text => text,
    isDisplayableFeedItem: () => true, isNewsCard: () => false, createPriorityRanker: () => ({ compareByOrder: () => () => 0 }), mergeRankedUnique: () => [],
    pageForItems: () => ({ items: [], variant: 0, pageCount: 1 }), batchLabel: () => "", createEmptyState: () => node(),
    prefersReducedMotion: () => true, animateCardsIn() {}, syncSegmentedIndicator() {},
    localizedResponseMessage: () => "Synthetic failure", localizedErrorMessage: error => error.message, renderOverviewStatus() {},
  });
  const item = { key: "synthetic", sourceKey: "source", url: "https://example.com/article" };
  button.addEventListener("click", event => invocations.push(view.refreshSummaryItem(item, event)));
  return { confirmation, response, started, state, button, card, requests, invocations, click: () => button.dispatchEvent(new Event("click", { cancelable: true })) };
}

{
  const h = harness();
  h.click(); h.confirmation.resolve(false);
  await Promise.all(h.invocations);
  assert.equal(h.requests.length, 0);
  assert.equal(h.button.disabled, false);
  assert.equal(h.card.getAttribute("aria-busy"), undefined);
}
{
  const h = harness();
  h.click(); h.click();
  assert.equal(h.requests.length, 0, "confirmation must precede native AI work");
  h.confirmation.resolve(true);
  await h.started.promise;
  assert.equal(h.requests.length, 1, "clicks awaiting the same confirmation must not start duplicate summaries");
  assert.equal(h.requests[0].url, "/api/summary/refresh");
  assert.equal(h.button.disabled, true, "the originating button remains available after the click event has finished dispatching");
  assert.equal(h.button.getAttribute("aria-label"), "aiTask.running");
  assert.equal(h.card.getAttribute("aria-busy"), "true");
  h.click();
  assert.equal(h.requests.length, 1, "an in-flight summary must not be repeated");
  h.response.resolve({ ok: false });
  await Promise.all(h.invocations);
  assert.equal(h.state.manualRefreshKeys.size, 0, "failed requests release the retry guard");
  assert(h.state.manualSummaryFailures.has("synthetic"), "failed requests retain a local retry status");
  assert.equal(h.card.getAttribute("aria-busy"), undefined, "loading feedback is cleared on failure");
}
console.log("Manual summary action tests passed");

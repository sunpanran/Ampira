import assert from "node:assert/strict";
import { createSummaryView } from "../../assets/client/summary-view.mjs";

function node() {
  const attributes = new Map();
  const element = {
    dataset: {}, children: [], className: "", style: { removeProperty() {} },
    setAttribute: (name, value) => attributes.set(name, String(value)),
    getAttribute: name => attributes.get(name) ?? null,
    removeAttribute: name => attributes.delete(name),
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
    addEventListener() {},
    matches(selector) { return selector === `.${this.className}`; },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
  };
  element.classList = {
    contains: name => element.className.split(" ").includes(name),
    add: name => { element.className += ` ${name}`; },
  };
  return element;
}

const previousDocument = globalThis.document;
globalThis.document = { createElement: node, createTextNode: text => ({ textContent: text }) };
try {
  const items = Array.from({ length: 18 }, (_, index) => ({
    articleId: `article-${index}`, sourceKey: "source", url: `https://example.com/article-${index}`,
    title: `Article ${index}`, source: "Synthetic source", excerpt: "Synthetic article text.",
    publishedAt: new Date(Date.UTC(2026, 10, 15, 12, 0) - index * 60000).toISOString(), score: 100 - index,
    externalDiscovery: index === 0,
  }));
  const state = {
    data: { feed: { items } }, settings: {}, variants: { summary: 0 }, summaryOrder: "importance",
    seen: new Set(), opened: new Set(), dismissed: new Set(), manualRefreshKeys: new Set(),
  };
  const els = { summaryGrid: node(), summaryBatch: node(), summaryMeta: node(), summaryOrder: node() };
  const view = createSummaryView({
    state, els, t: key => key, localizedCategory: () => "News", formatDateTime: String,
    faviconUrl: () => "", createThemedIcon: node, createReadingActions: node,
    attachLinkContextMenu() {}, activateCardFromKeyboard() {}, cardSummaryEnabled: () => false,
    setCardItemIdentity: (card, item) => { card.dataset.key = item.key; },
    createEmptyState: node, isNewsCard: item => item.cardType === "news", newsSectionName: () => "News",
    prefersReducedMotion: () => true, batchLabel: page => String(page.pageCount), writeValue() {},
    newsPreviews: { get: () => null, request: () => null, fingerprint: item => item.key },
  });
  const keys = () => els.summaryGrid.children.map(card => card.dataset.key).filter(Boolean);
  const render = () => view.renderSummaries({ immediate: true });
  render();
  const original = keys();
  assert.equal(original.length, 16);

  state.seen.add("article-0");
  state.seen.add("article-16");
  render();
  assert.deepEqual(keys(), [...original.slice(1), "article-17"], "read discoveries and later-page articles must disappear while unread order is retained");
  assert(els.summaryBatch.disabled, "batch availability must count only unread articles");
  assert.equal(view.newsSummaryItems().length, 18, "read articles must remain available to the archive and other activity consumers");
  view.reshuffleSummaries();
  assert(!keys().includes("article-0"), "changing batches must not reintroduce read articles");

  state.seen.delete("article-0");
  render();
  assert.deepEqual(keys(), original, "marking an article unread must restore its session position");
  assert(!els.summaryBatch.disabled);
  view.reshuffleSummaries();
  assert.deepEqual(keys(), ["article-17"], "later pages must exclude read cards too");

  state.seen = new Set(items.map(item => item.articleId));
  render();
  assert.deepEqual(keys(), [], "reading every article must replace the last page with an empty state");
  assert.equal(els.summaryGrid.children.length, 1);
  assert.equal(state.variants.summary, 0, "an exhausted list must reset the saved page to a valid index");
  assert(els.summaryBatch.disabled);
  state.variants.summary = 8;
  render();
  assert.deepEqual(keys(), [], "restoring a saved batch must not bring already-read cards back");
  state.seen.clear();
  state.summaryOrder = "time";
  render();
  assert.deepEqual(keys(), original, "clearing the archive must restore articles in the selected order");
} finally {
  if (previousDocument === undefined) delete globalThis.document;
  else globalThis.document = previousDocument;
}
console.log("Summary seen-card tests passed");

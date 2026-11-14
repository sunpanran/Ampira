import assert from "node:assert/strict";
import { createActivityController } from "../../assets/client/activity-controller.mjs";
import { createEfficiencyView } from "../../assets/client/efficiency-view.mjs";
import { SWITCHABLE_CARD_IDS } from "../../assets/client/dashboard-card-types.mjs";
import { translate } from "../helpers/full-i18n.mjs";

const originals = Object.fromEntries(["document", "window", "navigator"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
try {
  const nodes = [], copied = [];
  const node = () => {
    const element = { dataset: {}, append() {}, setAttribute() {}, addEventListener() {},
      closest() { return this; } };
    nodes.push(element);
    return element;
  };
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: node, addEventListener() {} } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: { addEventListener() {}, setInterval() {} } });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText: async value => copied.push(value) } } });
  const records = [
    { key: "saved", source: "bookmark", title: "Saved website", url: "https://example.com/saved" },
    { key: "news", source: "news", title: "News article", url: "https://example.com/old" },
    { key: "duplicate", title: "Duplicate URL", url: " https://example.com/saved " },
    { key: "seen", title: "Already read", url: "https://example.com/seen" },
    { key: "empty", title: "Missing URL", url: "  " },
    ...Array.from({ length: 20 }, (_, i) => ({ key: `extra-${i}`, title: `Extra ${i}`, url: `https://example.com/${i}` })),
  ];
  const state = {
    readingQueue: new Set(records.map(item => item.key)), readingQueueMeta: new Map(records.map(item => [item.key, item])),
    seen: new Set(["seen"]), opened: new Set(), cardTypes: Object.fromEntries(SWITCHABLE_CARD_IDS.map(id => [id, "queue"])),
  };
  const before = structuredClone(state);
  let locale = "zh-CN";
  const t = (key, params) => translate(locale, key, params);
  const itemUrl = item => item.url;
  const activity = createActivityController({ state, itemUrl, t, hostFromUrl: () => "example.com", newsSectionName: () => "News", newsCardType: "news",
    newsSummaryItems: () => [{ key: "news", url: "https://example.com/current" }],
  });
  const view = createEfficiencyView({ state, t, itemUrl, createIcon: node, readingQueueItems: activity.readingQueueItems });
  const cards = nodes.filter(element => element.dataset.dashboardCard);
  assert.equal(cards.length, SWITCHABLE_CARD_IDS.length);
  const expected = ["https://example.com/saved", "https://example.com/current", ...records.slice(5).map(item => item.url)].join("\n");
  for (const [language, label] of [["zh-CN", "复制全部链接"], ["zh-Hant", "複製全部連結"], ["en", "Copy all links"]]) {
    locale = language;
    for (const card of cards) {
      const actions = view.getCardContextActions(card);
      assert.deepEqual(actions.map(action => action.label), [label, t("context.switchCard")]);
      assert.equal(await actions[0].action(), true);
      assert.equal(copied.at(-1), expected, "copy all queue URLs in order, beyond the visible rows, omitting read/empty URLs and duplicates");
    }
  }
  assert.deepEqual(state, before, "copying must not open, mark as read, remove or persist queue entries");
  const card = cards[0], id = card.dataset.dashboardCard;
  state.cardTypes[id] = "events";
  assert.deepEqual(view.getCardContextActions(card).map(action => action.label), [t("context.switchCard")]);
  state.cardTypes[id] = "queue";
  state.readingQueue = new Set(["news"]);
  await view.getCardContextActions(card)[0].action();
  assert.equal(copied.at(-1), "https://example.com/current", "reopening the menu reads the current queue");
  for (const keys of [[], ["empty"], ["seen"], ["missing"]]) {
    state.readingQueue = new Set(keys);
    assert.deepEqual(view.getCardContextActions(card).map(action => action.label), [t("context.switchCard")], "no copy action without queued links");
  }
} finally {
  for (const [key, descriptor] of Object.entries(originals)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
}
console.log("Reading queue copy tests passed");

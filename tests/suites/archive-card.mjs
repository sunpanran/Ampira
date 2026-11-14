import assert from "node:assert/strict";
import { createArchiveCardView } from "../../assets/client/archive-card-view.mjs";
import { createDailyCardView } from "../../assets/client/daily-card-view.mjs";

export async function runArchiveCardTests() {
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    createElement: tag => new TestNode(tag), querySelectorAll: () => [],
  } });
  try {
    testRowActions();
    await testArchiveActions();
  } finally {
    if (original) Object.defineProperty(globalThis, "document", original);
    else delete globalThis.document;
  }
}

function testRowActions() {
  const opened = [], removed = [], contexts = new Map();
  const view = createDailyCardView({
    t: (key, values) => values?.title || key,
    setCardItemIdentity: (node, item) => { node.dataset.key = item.key; },
    contextAttachLink: (node, link, actions) => contexts.set(node, { link, actions }),
    openExternal: (...args) => opened.push(args),
    displayBookmarkTitle: item => item.title,
    toggleSeen: (...args) => removed.push(args),
    createBookmarkFavicon: () => assert.fail("title-only archives must not request site icons"),
  });
  const news = { key: "article", seenSource: "news", title: "Source name", url: "https://example.com/feed",
    summary: { title: "An archived article", itemUrl: "https://example.com/article" } };
  const bookmark = { key: "bookmark", seenSource: "bookmark", title: "Original bookmark", url: "https://example.com/site",
    summary: { title: "Feed title", itemUrl: "https://example.com/other" } };
  for (const [item, expectedUrl, expectedTitle] of [[news, news.summary.itemUrl, news.summary.title], [bookmark, bookmark.url, bookmark.title]]) {
    const row = view.createArchiveCard(item);
    assert.equal(row.children.length, 1, "the row has one readable title without duplicate status controls");
    assert.equal(row.children[0].textContent, expectedTitle);
    assert.equal(row.title, expectedTitle, "truncated bookmark titles remain available on hover");
    assert.equal(row.attributes.role, "link");
    row.emit("click");
    assert.deepEqual(opened.at(-1), [expectedUrl, expectedTitle, item, { contentKind: item.seenSource }]);
    for (const key of ["Enter", " "]) {
      const event = row.emit("keydown", { key });
      assert(event.defaultPrevented, "both keyboard activation keys open the archived entry");
      assert.equal(opened.at(-1)[0], expectedUrl);
    }
    const context = contexts.get(row);
    assert.deepEqual(context.link(), { url: expectedUrl, title: expectedTitle });
    const before = opened.length;
    context.actions()[0].action();
    assert.deepEqual(removed.at(-1), [item, false, item.seenSource], "remove uses the existing seen-state workflow and original source");
    assert.equal(opened.length, before, "removing an archive entry must not open it");
  }
}

async function testArchiveActions() {
  const state = { seen: new Set(["retained-news", "saved-site"]), seenMeta: new Map([
    ["retained-news", { title: "Retained article", url: "https://example.com/article", source: "news" }],
    ["saved-site", { title: "Retained site", url: "https://example.com/site", source: "bookmark" }],
  ]), data: { bookmarks: [] } };
  const menus = new Map(), confirmations = [], renderedItems = [];
  let resolveConfirmation, persisted = 0, rendered = 0, iconRenders = 0;
  const archive = createArchiveCardView({
    state, t: (key, values) => values ? `${key}:${values.count}` : key,
    createEmptyState: () => new TestNode("empty"),
    createArchiveCard: item => { renderedItems.push(item); return new TestNode("article"); },
    setIconLabel: () => { iconRenders += 1; },
    attachMenuButton: (button, actions) => menus.set(button, actions),
    confirmAction: options => { confirmations.push(options); return new Promise(resolve => { resolveConfirmation = resolve; }); },
    persistSeen: () => { persisted += 1; }, renderAll: () => { rendered += 1; },
    newsSummaryItems: () => [], newsSectionName: () => "News", isNewsCard: item => item?.cardType === "news",
  });
  const first = archive.render("first"), second = archive.render("second");
  assert.equal(first.content.children.length, 2, "retained entries remain visible when their feed items are no longer cached");
  assert.deepEqual(renderedItems.slice(0, 2).map(item => item.seenSource), ["news", "bookmark"]);
  assert.equal(first.actions[0], archive.render("first").actions[0], "rerendering keeps the focused menu trigger");
  assert.notEqual(first.actions[0], second.actions[0], "each archive instance owns its trigger");
  assert.equal(iconRenders, 2, "unchanged renders preserve the loaded menu icon");
  const clear = menus.get(first.actions[0])()[0].action;
  const pending = clear();
  await menus.get(second.actions[0])()[0].action();
  assert.equal(confirmations.length, 1, "duplicate archive instances share one clear confirmation");
  assert.equal(confirmations[0].body, "confirmation.clearArchive.body:2");
  assert.equal(confirmations[0].tone, "danger");
  resolveConfirmation(false);
  await pending;
  assert.equal(state.seen.size, 2);
  assert.equal(persisted, 0, "cancellation must not touch saved records");
  const confirmed = clear();
  resolveConfirmation(true);
  await confirmed;
  assert.equal(state.seen.size, 0);
  assert.equal(state.seenMeta.size, 0);
  assert.equal(persisted, 1);
  assert.equal(rendered, 1);
  const empty = archive.render("first");
  assert.equal(empty.actions.length, 0, "empty archives have no destructive action");
  assert.equal(empty.content.children[0].tag, "empty");
}

class TestNode {
  constructor(tag) {
    Object.assign(this, { tag, children: [], dataset: {}, attributes: {}, listeners: {}, classList: { add() {} } });
  }
  append(...nodes) { this.children.push(...nodes); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }
  emit(type, values = {}) {
    const event = { target: this, currentTarget: this, preventDefault() { this.defaultPrevented = true; }, ...values };
    for (const callback of this.listeners[type] || []) callback(event);
    return event;
  }
}

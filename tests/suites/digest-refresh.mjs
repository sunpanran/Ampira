import assert from "node:assert/strict";
import { createDigestCardView } from "../../assets/client/digest-card-view.mjs";
import { createSwitchableCardView } from "../../assets/client/switchable-card-view.mjs";
import { translate } from "../helpers/full-i18n.mjs";

const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
try {
  globalThis.document = {
    createElement: node,
    createTextNode: (text) => Object.assign(node("#text"), { textContent: text }),
    createDocumentFragment: () => node("#fragment"),
  };
  const copied = [];
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
    clipboard: { writeText: async (value) => copied.push(value) },
  } });
  for (const bot of [false, true]) {
    const state = { data: {
      ai: { enabled: true },
      dailyDigest: { status: bot ? "bot" : "ai", taskStatus: "completed", generatedAt: "2026-11-12T00:00:00Z",
        overview: [bot ? "合成简报。[来源](https://example.com/source)" : "合成简报。保留正文供阅读。"] },
      ...(bot ? { bot: { mcpEnabled: true, mode: "bot", connection: {}, runner: { mode: "codex", status: "idle" } } } : {}),
    } };
    let calls = 0;
    const opened = [];
    const options = {
      state, t: (key) => key, createIcon: () => node("img"), createEmptyState: (copy) => Object.assign(node("div"), { copy }),
      localizedErrorMessage: () => "Synthetic error", openAiSettings() {}, openExternal: (...args) => opened.push(args),
      refreshDailyDigest: () => calls++, isRevealPending: () => false,
    };
    const view = createDigestCardView(options);
    const initial = view.render(), button = initial.actions[0];
    assert.equal(text(initial.meta), "digest.status.ai", "completed briefs share a neutral status label in both modes");
    assert.equal(initial.content.tabIndex, 0, "both modes retain keyboard access to the scrollable brief");
    assert.equal(initial.content.attributes.role, "region");
    assert.equal(button.tag, "button");
    assert.equal(button.attributes["aria-label"], "action.reorganize");
    assert.equal(button.attributes["aria-disabled"], "false");
    for (const child of descendants(initial.content).filter((item) => item.tag !== "a")) {
      assert.notEqual(child.tag, "button", "reading the brief must not expose a refresh action in its text");
      assert.notEqual(child.attributes.role, "button");
      child.events.click?.({});
      child.events.keydown?.({ key: "Enter", target: child });
    }
    assert.equal(calls, 0, "clicking or pressing Enter on brief text must never regenerate it");
    if (bot) {
      descendants(initial.content).find((item) => item.tag === "a").events.click({ preventDefault() {} });
      assert.deepEqual(opened, [["https://example.com/source", "来源"]]);
      assert.equal(calls, 0, "source links remain independent of refresh");
    }
    button.events.click({});
    assert.equal(calls, 1, "both providers use the header refresh action");

    const expectedText = text(initial.content);
    assert.equal(view.contextActions()[0].label, "context.copyDigest");
    await view.contextActions()[0].action();
    assert.equal(copied.at(-1), bot ? "合成简报。[来源](https://example.com/source)" : "合成简报。\n\n保留正文供阅读。",
      "copy preserves displayed paragraphs and Bot Markdown without status or refresh labels");
    assert.equal(calls, 1, "copying a brief must not regenerate it");
    state.dailyDigestRefreshing = true;
    const busy = view.render();
    assert.equal(busy.actions[0], button, "refreshing must retain the focused header control");
    assert(busy.busy);
    assert.equal(button.attributes["aria-disabled"], "true");
    assert.equal(text(busy.content), expectedText, "refresh must leave the existing brief readable");
    assert.equal(view.contextActions().length, 1, "the previous readable brief remains copyable while refreshing");
    button.events.click({});
    assert.equal(calls, 1, "busy refresh controls must ignore repeated activation");
    state.dailyDigestRefreshing = false;
    if (bot) {
      state.data.dailyDigest.taskStatus = "pending";
      for (const status of ["idle", "running"]) {
        Object.assign(state.data.bot.runner, { status, kind: "brief" });
        assert(view.render().busy);
        button.events.click({});
        assert.equal(calls, 1, "queued and running assistant tasks block repeat requests");
      }
      state.data.bot.runner.status = "failed";
    } else {
      state.dailyDigestErrorAt = state.data.dailyDigest.generatedAt;
    }
    assert.equal(view.render().busy, false);
    assert.equal(button.attributes["aria-disabled"], "false");
    button.events.click({});
    assert.equal(calls, 2, "failed refreshes can retry from the same header button");
    if (bot) state.data.bot.connection = null;
    else state.data.ai.enabled = false;
    view.render(); button.events.click({});
    assert.equal(calls, 2, "unavailable services cannot be invoked by the header control");
    const second = createDigestCardView(options).render();
    assert.notEqual(second.actions[0], button, "multiple brief cards must each own their header control");
    state.data.dailyDigest.overview = ["  第一段  ", "", "第二段", null, "第三段", "第四段"];
    await view.contextActions()[0].action();
    assert.equal(copied.at(-1), bot ? "第一段\n\n第二段\n\n第三段\n\n第四段" : "第一段\n\n第二段\n\n第三段",
      "opening the menu again copies the latest displayed brief, including all Bot paragraphs");
    for (const locale of ["zh-CN", "zh-Hant", "en"]) {
      const localized = createDigestCardView({ ...options, t: key => translate(locale, key) });
      assert.equal(localized.contextActions()[0].label, { "zh-CN": "复制简报", "zh-Hant": "複製簡報", en: "Copy brief" }[locale]);
    }
    state.cardTypes = { news: "digest" };
    const card = createSwitchableCardView({ ...options, id: "news", getDigestContextActions: view.contextActions });
    assert.deepEqual(card.contextActions().map(action => action.label), ["context.copyDigest", "context.switchCard"],
      "a brief in any card position exposes copy before the existing switch action");
    state.cardTypes.news = "events";
    assert.deepEqual(card.contextActions().map(action => action.label), ["context.switchCard"],
      "switching away from the brief removes its copy action");
    for (const status of ["pending", "fallback", "quota-or-empty", "no-api-key"]) {
      state.data.dailyDigest.status = status;
      assert.deepEqual(view.contextActions(), [], "empty-state guidance must not be copied as a brief");
    }
    state.data.dailyDigest.status = bot ? "bot" : "ai";
    state.data.dailyDigest.overview = [];
    assert.deepEqual(view.contextActions(), []);
    assert(view.render().content.children[0].copy, "empty and unconfigured states retain their guidance");
    state.data.dailyDigest.overview = ["  ", null];
    assert.deepEqual(view.contextActions(), [], "whitespace-only brief content has no copy action");
    state.data.dailyDigest.overview = null;
    assert.deepEqual(view.contextActions(), []);
    state.data.dailyDigest = null;
    assert.deepEqual(view.contextActions(), [], "loading without a brief must not offer copy");
  }
} finally {
  if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
  else delete globalThis.document;
  if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
  else delete globalThis.navigator;
}
console.log("Daily brief refresh and copy tests passed");

function node(tag) {
  return { tag, textContent: "", children: [], attributes: {}, events: {}, dataset: {}, style: { setProperty() {} },
    classList: { add() {} },
    append(...items) { for (const item of items) this.children.push(...(item.tag === "#fragment" ? item.children : [item])); },
    replaceChildren(...items) { this.children = []; this.append(...items); },
    setAttribute(key, value) { this.attributes[key] = value; },
    getAttribute(key) { return this.attributes[key]; },
    addEventListener(key, handler) { this.events[key] = handler; },
  };
}
function descendants(target) { return target.children.flatMap((item) => [item, ...descendants(item)]); }
function text(target) { return target.textContent + target.children.map(text).join(""); }

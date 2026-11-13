import assert from "node:assert/strict";
import { createDigestCardView } from "../../assets/client/digest-card-view.mjs";

const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
try {
  globalThis.document = {
    createElement: node,
    createTextNode: (text) => Object.assign(node("#text"), { textContent: text }),
    createDocumentFragment: () => node("#fragment"),
  };
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
    state.dailyDigestRefreshing = true;
    const busy = view.render();
    assert.equal(busy.actions[0], button, "refreshing must retain the focused header control");
    assert(busy.busy);
    assert.equal(button.attributes["aria-disabled"], "true");
    assert.equal(text(busy.content), expectedText, "refresh must leave the existing brief readable");
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
    state.data.dailyDigest.overview = [];
    assert(view.render().content.children[0].copy, "empty and unconfigured states retain their guidance");
  }
} finally {
  if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
  else delete globalThis.document;
}
console.log("Daily brief header refresh tests passed");

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

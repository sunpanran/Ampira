import assert from "node:assert/strict";
import { createBotConversationController } from "../../assets/client/bot-conversation-controller.mjs";
import { botBoardRefreshInterval } from "../../assets/client/bot-runner-status.mjs";

const globals = ["document", "window", "CustomEvent"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
const controllers = [];
try {
  globalThis.document = { hidden: false, addEventListener() {}, createElement: () => node() };
  globalThis.window = { addEventListener() {}, dispatchEvent() {} };
  globalThis.CustomEvent = class { constructor(type) { this.type = type; } };

  {
    const h = harness();
    h.state.data.bot = { ...board([], [entry("pending")]), runner: { mode: "codex", status: "running", messageIds: ["pending"] } };
    await h.controller.sync(); assert.deepEqual(h.texts(), ["Question", "bot.runner.running"]);
    assert.equal(h.els.aiAnswer.children[1].dataset.taskPhase, "running");
    h.state.data.bot.runner.messageIds = ["another-question"];
    await h.controller.sync();
    assert.equal(h.els.aiAnswer.children[1].dataset.taskPhase, "queued", "only the executing message may rotate its status icon");
    h.state.data.bot.runner = { mode: "codex", status: "failed", error: "timeout" };
    await h.controller.sync(); assert.equal(h.texts()[1], "bot.runner.error.timeout");
    assert.equal(h.els.aiAnswer.children[1].dataset.taskPhase, "failed");
    assert.equal(h.els.aiAnswer.children[1].querySelectorAll().length, 1, "a sent task can retry generation without sending another message");
    h.state.data.bot.modules.replies.data.items.push({ ...reply("done", "Completed"), replyTo: "pending" });
    await h.controller.sync(); assert.deepEqual(h.texts(), ["Question", "Completed"]);
    assert.equal(h.els.aiAnswer.children[1].dataset.taskPhase, "", "delivered replies must clear pending feedback");
    assert.equal(h.els.aiAnswer.children[1].querySelectorAll().length, 0);
  }

  {
    const submitted = [];
    const h = harness({ post: async (_url, body) => {
      submitted.push(body);
      return board([], [{ action: { id: `message-${submitted.length}`, type: "message", text: body.text, conversationId: body.conversationId }, status: "sent" }]);
    } });
    await h.controller.send("First question"); await h.controller.send("Related follow-up");
    assert.equal(submitted[0].conversationId, submitted[1].conversationId);
    h.controller.newConversation(); await h.controller.send("Different topic");
    assert.notEqual(submitted[1].conversationId, submitted[2].conversationId, "new conversation does not attach the previous topic's context");
  }

  {
    const oldEntry = entry("old-question", "old-chat");
    const latestEntry = entry("latest-question", "latest-chat");
    const oldReply = { ...reply("old", "Old answer"), replyTo: oldEntry.action.id };
    const latestReply = { ...reply("latest", "Latest answer"), replyTo: latestEntry.action.id };
    const h = harness();
    h.state.data.bot = board([oldReply, latestReply], [oldEntry, latestEntry]);
    await h.controller.sync();
    assert.deepEqual(h.texts(), ["Question", "Latest answer"], "opening restores only the latest conversation");
    h.state.data.bot = board([oldReply, latestReply]);
    await h.controller.sync();
    assert.deepEqual(h.texts(), ["Latest answer"], "pruning the outbox retains known replies from the current conversation only");
    h.els.aiSearchInput.value = "Discard this draft";
    h.controller.newConversation();
    assert.deepEqual(h.texts(), [], "new conversation clears the transcript immediately");
    assert.equal(h.els.aiSearchInput.value, "");
    assert(h.els.aiAnswer.hidden);
    assert(!h.els.aiSearchPanel.classList.contains("has-conversation"));
    h.state.data.bot = board([oldReply, latestReply, reply("late", "Late orphan")], [oldEntry, latestEntry]);
    await h.controller.sync();
    h.controller.close();
    await h.controller.open();
    assert.deepEqual(h.texts(), [], "sync and reopening cannot repopulate an explicitly cleared conversation");
  }

  {
    const submitted = [], pending = deferred();
    const h = harness({ post: async (_url, body) => {
      submitted.push(body);
      if (submitted.length === 1) return pending.promise;
      return board([], [{ ...entry("new-question", body.conversationId), action: { ...entry("new-question", body.conversationId).action, text: body.text } }]);
    } });
    const sending = h.controller.send("In flight old question");
    h.controller.newConversation();
    assert.equal(h.state.aiSearchBusy, false, "new conversation releases the composer while an old request is in flight");
    await h.controller.send("New question");
    h.els.aiSearchInput.value = "New draft";
    pending.resolve(board([reply("late", "Late answer")], [entry("old-question", submitted[0].conversationId)]));
    await sending;
    assert.notEqual(submitted[0].conversationId, submitted[1].conversationId);
    assert.deepEqual(h.texts(), ["New question", "bot.runner.manual"], "a late submission cannot replace the new conversation");
    assert.equal(h.els.aiSearchInput.value, "New draft");
    assert.equal(h.state.data.bot.outbox[0].action.id, "new-question");
  }

  {
    const pending = deferred();
    const h = harness({ get: () => pending.promise });
    const opening = h.controller.open();
    h.controller.newConversation();
    pending.resolve(board([reply("late", "Late refreshed answer")], [entry("late-question", "old-chat")]));
    await opening;
    await h.controller.sync();
    assert.deepEqual(h.texts(), [], "a refresh started before reset cannot restore old messages");
  }

  {
    const started = deferred(), release = deferred();
    let first = true;
    const h = harness({ finish: async () => { if (first) { first = false; started.resolve(); await release.promise; } } });
    h.state.data.bot = board([reply("old", "Old render"), reply("another", "Another old render")]);
    const rendering = h.controller.sync();
    await started.promise;
    h.controller.newConversation();
    release.resolve();
    await rendering;
    await h.controller.sync();
    assert.deepEqual(h.texts(), [], "an interrupted render must not append the remaining old messages after reset");
  }

  {
    const h = harness();
    h.state.data.bot = board([reply("later", "Second", "2026-11-06T02:00:00Z"), reply("first", "First")]);
    await h.controller.sync();
    assert.deepEqual(h.texts(), ["First", "Second"], "remote-only replies appear in chronological order");
    const original = h.els.aiAnswer.children[0];
    h.state.data.bot = board([reply("first", "Edited")]);
    await h.controller.sync();
    assert.deepEqual(h.texts(), ["Edited"], "remote edits and removals must reconcile existing replies");
    assert.equal(h.els.aiAnswer.children[0], original, "an edit preserves the existing message element");
    h.els.aiSearchInput.value = "Unsent draft";
    h.state.data.bot = board();
    await h.controller.sync();
    assert.deepEqual(h.texts(), []);
    assert(h.els.aiAnswer.hidden);
    assert.equal(h.els.aiSearchInput.value, "Unsent draft", "empty remote content must not erase the draft");
  }

  {
    const h = harness();
    const markdown = "## 回答\n\n**重点**与 `code`\n\n- 第一条\n- 第二条\n\n```js\nconst value = 1;\n\n  value;\n```";
    h.state.data.bot = board([reply("markdown", markdown)], [entry("question-markdown")]);
    await h.controller.sync();
    assert.deepEqual(h.texts(), ["Question", markdown], "linked replies must reach the Markdown renderer unchanged");
    h.state.data.bot = board([reply("markdown", markdown)]);
    await h.controller.sync();
    assert.deepEqual(h.texts(), [markdown], "recovered replies must preserve the same Markdown");
  }

  {
    const h = harness();
    const response = reply("reply-one", "Answer");
    h.state.data.bot = board([response]);
    await h.controller.sync();
    h.state.data.bot = board([response], [entry(response.replyTo)]);
    await h.controller.sync();
    assert.deepEqual(h.texts(), ["Question", "Answer"], "a locally recovered question must not duplicate an orphan reply");
    h.state.data.bot = board([response]);
    await h.controller.sync();
    assert.deepEqual(h.texts(), ["Answer"], "outbox pruning preserves the remote answer without a stale question");
  }

  {
    const started = deferred(), release = deferred(); let first = true;
    const h = harness({ finish: async () => { if (first) { first = false; started.resolve(); await release.promise; } } });
    h.state.data.bot = board([reply("same", "Old")]);
    const old = h.controller.sync();
    await started.promise;
    h.state.data.bot = board([reply("same", "Latest")]);
    const latest = h.controller.sync();
    release.resolve();
    await Promise.all([old, latest]);
    assert.deepEqual(h.texts(), ["Latest"], "overlapping renders must finish with the newest content exactly once");
  }

  {
    const pending = deferred();
    const h = harness({ get: () => pending.promise });
    const opening = h.controller.open();
    h.state.data.bot = board([reply("new", "New connection")], [], "connection-b");
    await h.controller.sync();
    pending.resolve(board([reply("old", "Old connection")]));
    await opening;
    h.controller.close();
    assert.equal(h.state.data.bot.connectionId, "connection-b");
    assert.deepEqual(h.texts(), ["New connection"], "a response from the previous connection must be discarded");
  }

  {
    const pending = deferred();
    const h = harness({ post: () => pending.promise });
    h.els.aiSearchInput.value = "Keep this draft";
    const sending = h.controller.send("Old question");
    h.state.data.bot = board([], [], "connection-b");
    await h.controller.sync();
    h.els.aiSearchInput.value = "Keep this draft";
    pending.resolve(board([], [entry("old")]));
    await sending;
    assert.equal(h.state.data.bot.connectionId, "connection-b");
    assert.equal(h.els.aiSearchInput.value, "Keep this draft");
    assert.deepEqual(h.texts(), []);
    assert.equal(h.state.aiSearchBusy, false);
  }

  {
    const h = harness({ post: async () => { throw new Error("Synthetic transport failure"); } });
    h.els.aiSearchInput.value = "Keep on failure";
    await h.controller.send("Question");
    await h.controller.send("Question");
    assert.deepEqual(h.texts(), ["background.bot.networkFailed"], "retrying a failed submission must not accumulate notices");
    assert.equal(h.els.aiSearchInput.value, "Keep on failure");
    assert(h.els.aiSearchInput.focused, "the composer regains focus after submission finishes");
  }

  for (const returnToBot of [false, true]) {
    const pending = deferred();
    const h = harness({ post: () => pending.promise });
    const sending = h.controller.send("Old Bot question");
    h.controller.deactivate();
    h.state.data.bot.mode = returnToBot ? "bot" : "standard";
    h.state.aiSearchBusy = true;
    h.els.aiSearchInput.value = "Current mode draft";
    pending.resolve(board([reply("late", "Late Bot answer")], [entry("late")]));
    await sending;
    assert.equal(h.state.aiSearchBusy, true, "a deactivated Bot request must not clear the current mode's busy state");
    assert.equal(h.els.aiSearchInput.value, "Current mode draft");
    assert.deepEqual(h.texts(), [], "late Bot responses stay stale even after switching back to the same connection");
    assert.equal(h.state.data.bot.modules.replies.data.items.length, 0);
  }

  {
    const originalSet = globalThis.setInterval, originalClear = globalThis.clearInterval, originalNow = Date.now;
    let tick, clock = 10000, calls = 0, response;
    globalThis.setInterval = (callback, interval) => { assert.equal(interval, 2000); tick = callback; return 1; };
    globalThis.clearInterval = () => {};
    Date.now = () => clock;
    try {
      const h = harness({ get: async () => { calls++; return response || structuredClone(h.state.data.bot); } });
      h.state.data.bot.runner = { mode: "codex", status: "idle" };
      await h.controller.open();
      clock += 2000; tick(); await Promise.resolve();
      assert.equal(calls, 1, "idle conversations retain the slower polling interval");
      h.state.data.bot.outbox = [entry("pending")];
      const pending = deferred(); response = pending.promise;
      tick(); await Promise.resolve();
      assert.equal(calls, 2, "a queued question switches to fast status updates");
      clock += 2000; tick(); await Promise.resolve();
      assert.equal(calls, 2, "slow transports cannot accumulate overlapping refresh requests");
      const done = { ...board([{ ...reply("done", "Completed"), replyTo: "pending" }], [{ ...entry("pending"), status: "answered" }]), runner: { mode: "codex", status: "idle" } };
      pending.resolve(done); await new Promise(resolve => setImmediate(resolve));
      assert.deepEqual(h.texts(), ["Question", "Completed"]);
      response = null;
      clock += 2000; tick(); await Promise.resolve();
      assert.equal(calls, 2, "a completed answer returns to idle polling");
      h.state.data.bot.runner.status = "running";
      document.hidden = true; clock += 10000; tick(); await Promise.resolve();
      assert.equal(calls, 2, "hidden pages do not poll");
      document.hidden = false;
      assert.equal(botBoardRefreshInterval({ runner: { mode: "codex", status: "idle" }, brief: { status: "pending" } }), 2000);
      assert.equal(botBoardRefreshInterval({ runner: { mode: "codex", status: "failed" }, outbox: [entry("pending")] }), 10000);
      assert.equal(botBoardRefreshInterval({ runner: { mode: "manual" }, outbox: [entry("pending")] }), 10000);
      h.controller.close();
    } finally { globalThis.setInterval = originalSet; globalThis.clearInterval = originalClear; Date.now = originalNow; document.hidden = false; }
  }

  {
    const originalSet = globalThis.setInterval, originalClear = globalThis.clearInterval;
    const timers = new Set();
    let sequence = 0;
    globalThis.setInterval = () => { const timer = ++sequence; timers.add(timer); return timer; };
    globalThis.clearInterval = timer => timers.delete(timer);
    try {
      const pending = deferred(), h = harness({ get: () => pending.promise });
      const openings = [h.controller.open(), h.controller.open()];
      h.controller.newConversation();
      assert.equal(timers.size, 1, "reset during the initial refresh retains polling for new replies");
      pending.resolve(board());
      await Promise.all(openings);
      assert.equal(timers.size, 1, "overlapping opens must share a single polling timer");
      h.controller.close();
      assert.equal(timers.size, 0, "closing the conversation must stop every polling timer");
    } finally {
      globalThis.setInterval = originalSet;
      globalThis.clearInterval = originalClear;
    }
  }

} finally {
  controllers.forEach((controller) => controller.close());
  for (const [key, descriptor] of globals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
}

function board(items = [], outbox = [], connectionId = "connection-a") {
  return { mcpEnabled: true, mode: "bot", connection: {}, connectionId, outbox, modules: { replies: { data: { items } } } };
}
function reply(id, text, createdAt = "2026-11-06T01:00:00Z") { return { id, text, createdAt, replyTo: `question-${id}` }; }
function entry(id, conversationId) { return { status: "sent", action: { id, type: "message", text: "Question", ...(conversationId ? { conversationId } : {}) } }; }
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
function node(root = false) {
  const classes = new Set();
  return {
    root, parent: null, children: [], dataset: {}, textContent: "", value: "",
    classList: { add: (...names) => names.forEach((name) => classes.add(name)), remove: (...names) => names.forEach((name) => classes.delete(name)), contains: (name) => classes.has(name) },
    get isConnected() { return this.root || this.parent?.isConnected || false; },
    addEventListener() {}, focus() { this.focused = true; },
    append(child) { this.insertBefore(child, null); },
    insertBefore(child, before) {
      child.remove(); child.parent = this;
      const index = before ? this.children.indexOf(before) : this.children.length;
      this.children.splice(index, 0, child);
    },
    remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; },
    querySelectorAll() { return this.children.filter((child) => child.dataset.botRetry); },
  };
}
function harness(options = {}) {
  const state = { data: { bot: board() } };
  const els = { aiSearchOverlay: node(true), aiSearchPanel: node(true), aiAnswer: node(true), aiSearchInput: node(true) };
  els.aiSearchOverlay.classList.add("open");
  const controller = createBotConversationController({
    state, els, t: (key) => key,
    apiPost: (url, body) => url === "/api/bot/refresh" ? (options.get || (async () => structuredClone(state.data.bot)))() : options.post(url, body),
    appendMessage(input) { const model = { ...input, element: node() }; model.element.textContent = input.text; els.aiAnswer.append(model.element); return model; },
    async finishMessage(model, response) { await options.finish?.(); if (model.element.isConnected) { model.element.textContent = response.text; model.element.dataset.taskPhase = response.taskPhase || ""; } },
    removeMessages(models) { models.forEach((model) => model.element.remove()); },
    setMeta() {}, syncComposer() {}, reset() {
      [...els.aiAnswer.children].forEach((child) => child.remove());
      els.aiAnswer.hidden = true;
      els.aiSearchPanel.classList.remove("has-conversation");
      els.aiSearchInput.value = "";
    },
  });
  controllers.push(controller);
  return { state, els, controller, texts: () => els.aiAnswer.children.map((child) => child.textContent) };
}

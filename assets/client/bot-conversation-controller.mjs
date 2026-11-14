import { usesBotChat } from "../../extension/core/bot-mode.mjs";
import { botBoardRefreshInterval, botRunnerStatusKey } from "./bot-runner-status.mjs";
import { botTaskPhase } from "./ai-task-state.mjs";

export function createBotConversationController({ state, els, t, request, appendMessage, finishMessage, removeMessages, setMeta, syncComposer, reset }) {
  const messages = new Map();
  const conversationMessages = new Set();
  let busy = false;
  let timer;
  let connectionId;
  let conversationId = "";
  let syncQueue = Promise.resolve();
  let notice = null;
  let generation = 0;
  let refreshing = false, refreshedAt = 0;
  document.addEventListener("ampira:bot-board-updated", () => { if (isOpen()) void sync().catch(report); });
  window.addEventListener("pagehide", () => clearInterval(timer));
  return { open, close: () => clearInterval(timer), deactivate, send, sync, newConversation };
  function newConversation() {
    generation++;
    busy = false;
    connectionId = state.data?.bot?.connectionId;
    conversationId = crypto.randomUUID();
    messages.clear();
    conversationMessages.clear();
    notice = null;
    reset();
    state.aiSearchBusy = false;
    syncComposer();
    void sync().catch(report);
  }
  function deactivate() {
    generation++;
    clearInterval(timer);
    busy = false;
    connectionId = undefined;
    conversationId = "";
    messages.clear();
    conversationMessages.clear();
    notice = null;
  }
  function syncConnection(board) {
    if (connectionId === board.connectionId) return;
    if (connectionId !== undefined) reset();
    connectionId = board.connectionId;
    conversationId = [...(board.outbox || [])].reverse().find(entry => entry.action.type === "message")?.action.conversationId || "";
    messages.clear();
    conversationMessages.clear();
    notice = null;
  }
  function isOpen() { return els.aiSearchOverlay.classList.contains("open") && !els.aiSearchOverlay.classList.contains("closing") && !els.aiSearchPanel.classList.contains("is-searching") && usesBotChat(state.data); }
  async function open() {
    clearInterval(timer);
    if (isOpen()) {
      timer = setInterval(() => { if (isOpen() && !document.hidden) void refresh(); }, 2000);
    }
    await refresh(true);
  }
  async function refresh(force = false) {
    if (busy || refreshing || !force && Date.now() - refreshedAt < botBoardRefreshInterval(state.data?.bot)) return;
    refreshing = true; refreshedAt = Date.now();
    const expectedConnection = state.data?.bot?.connectionId;
    const version = generation;
    try {
      const board = await request({ type: "bot:refresh", payload: {} });
      if (!isCurrentConnection(expectedConnection, version) || board.connectionId !== expectedConnection) return;
      state.data.bot = board;
      await sync();
    } catch (error) { if (isCurrentConnection(expectedConnection, version)) report(error); }
    finally { refreshing = false; }
  }
  function sync() {
    const version = generation;
    const operation = syncQueue.then(() => { if (version === generation) return renderCurrent(version); });
    syncQueue = operation.catch(() => {});
    return operation;
  }
  async function renderCurrent(version) {
    const board = state.data?.bot;
    if (!board || !usesBotChat(state.data)) return;
    syncConnection(board);
    const allEntries = (board.outbox || []).filter((entry) => entry.action.type === "message");
    const entries = allEntries.filter((entry) => (entry.action.conversationId || "") === conversationId);
    // Replies can outlive their outbox entries, so retain current-session membership.
    entries.forEach((entry) => conversationMessages.add(entry.action.id));
    const knownMessages = new Set(allEntries.map((entry) => entry.action.id));
    const replies = (board.modules?.replies?.data?.items || [])
      .filter((reply) => conversationMessages.has(reply.replyTo) || !conversationId && !knownMessages.has(reply.replyTo))
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id));
    if (entries.length || replies.length) {
      els.aiSearchPanel.classList.add("has-conversation");
      els.aiAnswer.hidden = false;
      els.aiAnswer.dataset.mode = "conversation";
    }
    setMeta(t(board.connection ? board.runner?.mode === "codex" ? "bot.runner.autoHint" : "bot.asyncHint" : "bot.connectFirst"));
    const linked = new Set();
    const wanted = new Set();
    const ordered = [];
    for (const entry of entries) {
      wanted.add(entry.action.id);
      let pair = messages.get(entry.action.id);
      if (!pair?.answer?.element?.isConnected) {
        const user = appendMessage({ role: "user", text: entry.action.text, status: "complete" });
        pair = { user, answer: appendMessage({ role: "assistant", text: "", status: "notice" }), fingerprint: "" };
        messages.set(entry.action.id, pair);
      }
      ordered.push(pair.user, pair.answer);
      const answers = replies.filter((reply) => reply.replyTo === entry.action.id);
      answers.forEach((reply) => linked.add(reply.id));
      const text = answers.length ? answers.map((reply) => reply.text).join("\n\n")
        : t(entry.status === "sent" ? botRunnerStatusKey(board, { messageId: entry.action.id }) : entry.status === "failed" ? "bot.failed" : "bot.interrupted");
      const status = answers.length ? "complete" : "notice";
      const taskPhase = answers.length ? "" : entry.status === "sent" ? botTaskPhase(board, { messageId: entry.action.id }) : "failed";
      const fingerprint = `${entry.status}:${status}:${taskPhase}:${text}`;
      if (pair.fingerprint === fingerprint) continue;
      pair.answer.element.querySelectorAll("[data-bot-retry]").forEach((button) => button.remove());
      await finishMessage(pair.answer, { text, status, taskPhase, responseMode: "bot", usedAi: false });
      if (!isCurrentConnection(board.connectionId, version)) return;
      pair.fingerprint = fingerprint;
      if (!answers.length && (entry.status !== "sent" || board.runner?.status === "failed")) {
        const retry = document.createElement("button"); retry.type = "button"; retry.className = "btn ghost"; retry.textContent = t(entry.status === "sent" ? "bot.runner.retry" : "bot.retry");
        retry.dataset.botRetry = "true";
        retry.addEventListener("click", () => send("", entry.action.id));
        pair.answer.element.append(retry);
      }
    }
    for (const reply of replies) {
      if (linked.has(reply.id)) continue;
      const key = `reply:${reply.id}`;
      wanted.add(key);
      let pair = messages.get(key);
      if (!pair?.answer?.element?.isConnected) {
        pair = { answer: appendMessage({ role: "assistant", text: reply.text, status: "notice" }), fingerprint: "" };
        messages.set(key, pair);
      }
      ordered.push(pair.answer);
      if (pair.fingerprint === reply.text) continue;
      await finishMessage(pair.answer, { text: reply.text, status: "complete", responseMode: "bot", usedAi: false });
      if (!isCurrentConnection(board.connectionId, version)) return;
      pair.fingerprint = reply.text;
    }
    for (const [key, pair] of messages) if (!wanted.has(key)) {
      removeMessages([pair.user, pair.answer].filter(Boolean));
      messages.delete(key);
    }
    for (const [index, model] of ordered.entries()) if (els.aiAnswer.children[index] !== model.element) {
      els.aiAnswer.insertBefore(model.element, els.aiAnswer.children[index] || null);
    }
    if (!ordered.length && !notice?.element?.isConnected) {
      els.aiAnswer.hidden = true;
      els.aiSearchPanel.classList.remove("has-conversation");
    }
  }
  async function send(raw, retryId) {
    const text = String(raw || "").trim();
    if (busy || !usesBotChat(state.data) || !retryId && !text) return;
    syncConnection(state.data.bot);
    const expectedConnection = state.data.bot.connectionId;
    const version = generation;
    busy = true; state.aiSearchBusy = true; syncComposer();
    setMeta(t("bot.loading"));
    try {
      conversationId ||= crypto.randomUUID();
      const board = await request({ type: "bot:submit", payload: { ...(retryId ? { retryId } : { type: "message", text, conversationId }), connectionId: expectedConnection } });
      if (!isCurrentConnection(expectedConnection, version) || board.connectionId !== expectedConnection) return;
      state.data.bot = board;
      if (notice) { removeMessages([notice]); notice = null; }
      if (!retryId) els.aiSearchInput.value = "";
      await sync();
      window.dispatchEvent(new CustomEvent("ampira:bot-action"));
    } catch (error) {
      if (!isCurrentConnection(expectedConnection, version)) return;
      const text = t(error?.messageKey || "background.bot.networkFailed");
      setMeta(text);
      els.aiSearchPanel.classList.add("has-conversation");
      els.aiAnswer.hidden = false;
      if (notice) removeMessages([notice]);
      notice = appendMessage({ role: "assistant", text, status: "notice" });
      await finishMessage(notice, { text, status: "notice", taskPhase: "failed", responseMode: "bot", usedAi: false });
    } finally {
      if (version === generation) {
        busy = false; state.aiSearchBusy = false; syncComposer();
        if (isCurrentConnection(expectedConnection, version) && isOpen()) els.aiSearchInput.focus({ preventScroll: true });
      }
    }
  }
  function isCurrentConnection(expected, version) { return version === generation && usesBotChat(state.data) && state.data.bot.connectionId === expected; }
  function report(error) { setMeta(t(error?.messageKey || "background.bot.networkFailed")); }
}

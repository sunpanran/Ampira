import assert from "node:assert/strict";
import { aiTaskLabelKey, botTaskPhase, briefTaskPhase, isAiTaskBusy, summaryTaskPhase } from "../../assets/client/ai-task-state.mjs";
import { localeMessages } from "../helpers/full-i18n.mjs";
import { createAiTaskStatus } from "../../assets/client/ui-primitives.mjs";

const ready = { status: "ai", generatedAt: "2026-11-12T00:00:00Z" };
const state = { data: { ai: {}, dailyDigest: ready }, manualRefreshKeys: new Set() };
assert.equal(briefTaskPhase(state), "");
state.dailyDigestRefreshing = true;
assert.equal(briefTaskPhase(state), "running");
state.dailyDigestRefreshing = false;
state.data.ai.autoStatus = { running: true, phase: "running-cards" };
assert.equal(briefTaskPhase(state), "", "card work must not mark the brief busy");
state.data.ai.autoStatus = { running: true, phase: "running-digest" };
assert.equal(briefTaskPhase(state), "running", "automatic generation must be visible without a local click");
state.data.ai.autoStatus = { running: false, phase: "error", errorStage: "digest", startedAt: "2026-11-12T01:00:00Z" };
assert.equal(briefTaskPhase(state), "failed");
state.data.dailyDigest = { ...ready, generatedAt: "2026-11-12T02:00:00Z" };
assert.equal(briefTaskPhase(state), "", "an older automatic failure must not override a newer successful brief");
state.data.ai.autoStatus = {};
state.dailyDigestErrorAt = state.data.dailyDigest.generatedAt;
assert.equal(briefTaskPhase(state), "failed", "manual failure retains feedback while the old brief remains readable");
state.data.dailyDigest = { ...ready, generatedAt: "2026-11-12T03:00:00Z" };
assert.equal(briefTaskPhase(state), "");
delete state.dailyDigestErrorAt;

state.data.bot = { mcpEnabled: true, mode: "bot", connection: {}, runner: { mode: "codex", status: "idle" } };
state.data.dailyDigest = { status: "bot", taskStatus: "pending" };
assert.equal(briefTaskPhase(state), "queued");
state.data.bot.runner = { mode: "codex", status: "running", kind: "question", messageIds: ["q1"] };
assert.equal(briefTaskPhase(state), "queued", "another task's generation must not animate the brief");
assert.equal(botTaskPhase(state.data.bot, { messageId: "q1" }), "running");
assert.equal(botTaskPhase(state.data.bot, { messageId: "q2" }), "queued");
state.data.bot.runner.kind = "brief";
assert.equal(briefTaskPhase(state), "running");
state.data.bot.runner.status = "failed";
assert.equal(briefTaskPhase(state), "failed");
state.dailyDigestRefreshing = true;
assert.equal(briefTaskPhase(state), "queued", "retry submission must not retain the previous failure");
state.dailyDigestRefreshing = false;
state.data.dailyDigest.taskStatus = "completed";
assert.equal(briefTaskPhase(state), "", "a completed brief must not inherit a later runner failure");
state.data.dailyDigest.taskStatus = "pending";
state.data.bot.runner = { mode: "manual" };
assert.equal(briefTaskPhase(state), "queued", "manual assistants have no trustworthy running signal");
state.data.bot.connection = null;
assert.equal(briefTaskPhase(state), "failed");

state.manualRefreshKeys.add("a");
assert.equal(summaryTaskPhase(state, "a"), "running");
state.data.organization = { provider: "bot", pendingIds: ["a"], queuedIds: ["b"], failedIds: ["c"] };
assert.equal(summaryTaskPhase(state, "a"), "queued");
state.manualRefreshKeys.clear();
assert.equal(summaryTaskPhase(state, "a"), "queued", "remote accepted items must not pretend to be executing");
assert.equal(summaryTaskPhase(state, "b"), "queued");
assert.equal(summaryTaskPhase(state, "c"), "failed");
assert.equal(summaryTaskPhase(state, "done"), "");
state.data.organization.unavailable = true;
assert.equal(summaryTaskPhase(state, "a"), "failed");
state.manualSummaryFailures = new Set(["local"]);
assert.equal(summaryTaskPhase(state, "local"), "failed");
for (const phase of ["queued", "running", "failed", ""]) {
  assert.equal(isAiTaskBusy(phase), ["queued", "running"].includes(phase));
  if (phase) for (const locale of ["zh-CN", "zh-Hant", "en"]) assert(localeMessages(locale)[aiTaskLabelKey(phase)]);
}
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
try {
  globalThis.document = { createElement: () => ({ dataset: {}, children: [], attributes: {}, style: { setProperty(key, value) { this[key] = value; } },
    append(...children) { this.children.push(...children); }, setAttribute(key, value) { this.attributes[key] = value; },
  }) };
  for (const [phase, icon] of [["running", "loader"], ["queued", "clock"], ["failed", "info-circle"]]) {
    const status = createAiTaskStatus(phase, "Synthetic task status");
    assert.equal(status.attributes.role, "status");
    assert.equal(status.dataset.taskPhase, phase);
    assert.equal(status.children[0].style["--themed-icon-mask"], `url("/assets/icons/${icon}.svg")`, "feedback icons must resolve to the intended local asset");
    assert.equal(status.children[1].textContent, "Synthetic task status");
  }
} finally {
  if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
  else delete globalThis.document;
}
console.log("AI task state tests passed");

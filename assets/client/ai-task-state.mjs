import { usesBotBrief } from "../../extension/core/bot-mode.mjs";

export function isAiTaskBusy(phase) {
  return phase === "queued" || phase === "running";
}

export function aiTaskLabelKey(phase) {
  return `aiTask.${phase}`;
}

export function botTaskPhase(board, { messageId = "", brief = false } = {}) {
  if (!board?.connection || board.runner?.status === "failed") return "failed";
  const runner = board.runner;
  return runner?.mode === "codex" && runner.status === "running"
    && (brief ? runner.kind === "brief" : runner.messageIds?.includes(messageId)) ? "running" : "queued";
}

export function briefTaskPhase(state) {
  const digest = state.data?.dailyDigest;
  const auto = state.data?.ai?.autoStatus;
  if (usesBotBrief(state.data)) {
    if (state.dailyDigestRefreshing) return "queued";
    if (digest?.taskStatus === "pending") return botTaskPhase(state.data.bot, { brief: true });
  } else if (state.dailyDigestRefreshing || auto?.running && auto.phase === "running-digest") return "running";
  else if (auto?.phase === "error" && auto.errorStage === "digest"
    && (Date.parse(auto.startedAt) || 0) > (Date.parse(digest?.generatedAt) || 0)) return "failed";
  if (digest?.status === "fallback" || digest?.taskStatus === "failed"
    || typeof state.dailyDigestErrorAt === "string" && state.dailyDigestErrorAt === String(digest?.generatedAt || "")) return "failed";
  return "";
}

export function summaryTaskPhase(state, key) {
  const organization = state.data?.organization;
  if (state.manualRefreshKeys.has(key)) return organization?.provider === "bot" ? "queued" : "running";
  if (state.manualSummaryFailures?.has(key) || organization?.failedIds?.includes(key)) return "failed";
  if (organization?.pendingIds?.includes(key)) {
    if (organization.unavailable) return "failed";
    // The summary queue does not report which remote item is currently executing.
    return organization.provider === "bot" ? "queued" : "running";
  }
  return organization?.queuedIds?.includes(key) ? "queued" : "";
}

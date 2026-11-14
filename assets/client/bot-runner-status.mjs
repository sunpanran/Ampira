export function botBoardRefreshInterval(board) {
  const runner = board?.runner;
  const pending = board?.brief?.status === "pending" || board?.outbox?.some(entry => entry.status === "sent");
  return runner?.mode === "codex" && runner.status !== "failed" && (runner.status === "running" || pending) ? 2000 : 10000;
}

export function botRunnerStatusKey(board, { messageId = "", brief = false } = {}) {
  if (!board?.connection) return "bot.connectFirst";
  const runner = board?.runner;
  if (runner?.mode !== "codex") return "bot.runner.manual";
  if (runner.status === "failed") return `bot.runner.error.${runner.error || "failed"}`;
  if (runner.status === "running" && (brief ? runner.kind === "brief" : runner.messageIds?.includes(messageId))) return "bot.runner.running";
  return "bot.runner.queued";
}

export function botBriefStatusKey(board, digest) {
  if (!board.connection) return "mcp.unpaired";
  if (digest?.taskStatus !== "pending") return "digest.status.ai";
  if (board.runner?.status === "failed") return "bot.runner.paused";
  return board.runner?.mode === "codex" ? botRunnerStatusKey(board, { brief: true }) : "bot.brief.pending";
}

export function botBriefEmptyStateKeys(board, digest) {
  if (!board.connection) return { title: "bot.brief.connectTitle", body: "bot.connectFirst", action: "" };
  if (board.runner?.status === "failed") return { title: "bot.brief.failedTitle", body: botRunnerStatusKey(board, { brief: true }), action: "bot.runner.retry" };
  const automatic = board.runner?.mode === "codex";
  if (digest?.taskStatus === "pending") {
    if (!automatic) return { title: "bot.brief.pendingTitle", body: "bot.brief.pendingHelp", action: "" };
    const running = board.runner.status === "running" && board.runner.kind === "brief";
    return { title: running ? "bot.brief.runningTitle" : "bot.brief.queuedTitle",
      body: "", action: "" };
  }
  return { title: "bot.waitingContent", body: automatic ? "" : "bot.brief.help",
    action: automatic ? "bot.runner.generate" : "bot.brief.prepare" };
}

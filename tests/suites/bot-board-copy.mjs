import assert from "node:assert/strict";
import { botBriefEmptyStateKeys, botBriefStatusKey, botRunnerStatusKey } from "../../assets/client/bot-runner-status.mjs";
import { localeMessages } from "../helpers/full-i18n.mjs";

const connected = { connection: {}, runner: { mode: "codex", status: "idle" } };
const pending = { status: "bot", taskStatus: "pending" };
const ready = { status: "bot", taskStatus: "idle" };
const scenarios = [
  [{ runner: connected.runner }, pending, "bot.brief.connectTitle", "bot.connectFirst", ""],
  [connected, ready, "bot.waitingContent", "bot.runner.briefHelp", "bot.runner.generate"],
  [{ connection: {}, runner: { mode: "manual" } }, ready, "bot.waitingContent", "bot.brief.help", "bot.brief.prepare"],
  [{ connection: {}, runner: { mode: "manual" } }, pending, "bot.brief.pendingTitle", "bot.brief.pendingHelp", ""],
  [connected, pending, "bot.brief.queuedTitle", "bot.brief.queuedHelp", ""],
  [{ connection: {}, runner: { mode: "codex", status: "running", kind: "question" } }, pending, "bot.brief.queuedTitle", "bot.brief.queuedHelp", ""],
  [{ connection: {}, runner: { mode: "codex", status: "running", kind: "brief" } }, pending, "bot.brief.runningTitle", "bot.brief.runningHelp", ""],
];
for (const error of ["unavailable", "auth", "quota", "timeout", "invalidResult", "interrupted", "failed"])
  scenarios.push([{ connection: {}, runner: { mode: "codex", status: "failed", error } }, pending, "bot.brief.failedTitle", `bot.runner.error.${error}`, "bot.runner.retry"]);

for (const [board, digest, title, body, action] of scenarios) {
  const copy = botBriefEmptyStateKeys(board, digest);
  assert.deepEqual(copy, { title, body, action });
  for (const locale of ["zh-CN", "zh-Hant", "en"]) {
    const messages = localeMessages(locale);
    for (const key of [copy.title, copy.body, copy.action].filter(Boolean)) assert(messages[key]?.trim(), `${locale}: missing ${key}`);
  }
}
assert.equal(botBriefStatusKey({ runner: connected.runner }, pending), "mcp.unpaired", "unpaired mode must not claim to be generating");
assert.equal(botRunnerStatusKey({ runner: { mode: "codex", status: "running", messageIds: ["q"] } }, { messageId: "q" }), "bot.connectFirst", "disconnected tasks must not claim to be running");
assert.equal(botBriefStatusKey(connected, pending), "bot.runner.queued");
assert.equal(botBriefStatusKey({ ...connected, runner: { mode: "codex", status: "running", kind: "brief" } }, pending), "bot.runner.running");
assert.equal(botBriefStatusKey({ ...connected, runner: { mode: "manual" } }, pending), "bot.brief.pending");
console.log("Assistant dashboard state copy tests passed");

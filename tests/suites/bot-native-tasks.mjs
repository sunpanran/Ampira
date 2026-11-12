import assert from "node:assert/strict";
import { createBotNativeWorkflow } from "../../extension/runtime/bot-native-workflow.mjs";
import { syncBrief, pendingBrief, completeBrief } from "../../integrations/local-mcp/brief-queue.mjs";
import { completeQuestions, questionReferences } from "../../integrations/local-mcp/question-tasks.mjs";
import { prepareTask } from "../../integrations/local-mcp/tasks.mjs";
import { taskReference } from "../../extension/core/bot-task-context.mjs";
import { buildDailyCandidates, localDateKey } from "../../extension/core/news-ranking.mjs";
import { syntheticArticle } from "../helpers/automatic-ai-harness.mjs";
import { botDashboardPayload } from "../../extension/core/bot-board.mjs";
import { briefTaskPhase } from "../../assets/client/ai-task-state.mjs";

function harness() {
  const settings = { mcpEnabled: true, dashboardMode: "bot", uiLocale: "zh-CN", todayNewsPerPublisherLimit: 0 };
  const records = new Map(), stored = {}, calls = [];
  const server = { modules: {}, briefs: [] };
  const initial = Array.from({ length: 14 }, (_, index) => syntheticArticle(`native-${index}`, {
    title: `本地产品更新 ${index}`, excerpt: "更新改善显示效果，并支持现有设备。", contentLocale: "zh-CN", externalDiscovery: true,
    source: `Synthetic source ${index}`, publisher: `Synthetic source ${index}`, eventId: `event-${index}`, eventSourceCount: 2,
    score: 100 - index, localImportanceScore: 100 - index, publicImportanceScore: 100 - index,
  }));
  const control = { items: initial, permitted: true, epoch: 0, running: false, date: localDateKey(), afterTransport: null };
  const config = { mcpEnabled: true, mode: "bot", connectionId: "synthetic-board", connection: { endpoint: "http://127.0.0.1:43123" } };
  const read = () => ({ ...config, modules: structuredClone(server.modules) });
  const options = {
    storage: { get: async key => ({ [key]: stored[key] }), set: async value => Object.assign(stored, value) },
    getSettings: async () => ({ ...settings }), settingsLocale: value => value.uiLocale,
    getRecord: async (key, fallback) => structuredClone(records.get(key) || fallback), setRecord: async (key, value) => records.set(key, structuredClone(value)),
    cacheMutations: { capture: () => control.epoch, isCurrent: value => control.epoch === value,
      run: async (action, epoch = control.epoch) => action(() => control.epoch === epoch) },
    capturePermissionEpoch: () => control.epoch, isPermissionEpochCurrent: epoch => control.epoch === epoch,
    readPermittedFeed: async () => ({ raw: control.permitted ? control.items : [], visible: control.permitted ? control.items : [] }),
    buildDailyCandidates, getRefreshStatus: async () => ({ running: control.running }), localDateKey: value => value === undefined ? control.date : localDateKey(value),
    botBoard: { config: async () => config, read: async () => read(), refresh: async () => read(), syncBrief: async input => {
      calls.push(structuredClone(input));
      if (control.offline) throw new Error("Synthetic offline companion");
      const result = syncBrief(server, input);
      if (control.afterTransport) { const action = control.afterTransport; control.afterTransport = null; action(); }
      return result;
    } },
    loadQuestionSearchContext: async () => ({ candidates: control.permitted ? control.items.slice(0, 8) : [] }),
    normalizeUserUrl: value => /^https:\/\//.test(value) ? value : "", hasOriginPermission: async () => control.permitted,
    readArticle: async url => ({ url, requestedUrl: url, title: "合成正文", blocks: [{ text: "已经解析的网页正文。".repeat(200) }] }),
    readerTextFromBlocks: blocks => blocks.map(block => block.text).join("\n"),
    assertUrlsStillPermitted: async () => { if (!control.permitted) throw new Error("permission changed"); },
    assertFeedItemsStillPermitted: async items => {
      if (!control.permitted || items.some(item => item.sourceOrigin !== "https://news.example")) throw new Error("permission changed");
      if (control.afterPermissionCheck) { const action = control.afterPermissionCheck; control.afterPermissionCheck = null; action(); }
    },
    uuid: () => "synthetic-owner",
  };
  const service = createBotNativeWorkflow(options);
  const complete = (brief = "已授权的资讯显示，产品更新改善显示效果，并面向现有设备提供支持。") => {
    const task = pendingBrief(server); assert(task);
    return completeBrief(server, { taskId: task.id, brief, sourceIds: task.context.slice(0, 2).map(item => item.id) }, new Date().toISOString());
  };
  return { service, settings, records, server, control, calls, complete, read, restart: () => createBotNativeWorkflow(options) };
}

{
  const h = harness();
  const queued = await h.service.syncBrief(false);
  assert.equal(queued.status, "pending");
  const task = pendingBrief(h.server);
  assert(task.context.length <= 12 && JSON.stringify(task.context).length <= 4500);
  h.control.items.unshift(syntheticArticle("new-arrival", { title: "新的产品消息", excerpt: "用户开始收到新的更新。", contentLocale: "zh-CN", eventId: "new-arrival", eventSourceCount: 2, localImportanceScore: 110, publicImportanceScore: 100 }));
  await h.service.syncBrief(false);
  assert.equal(pendingBrief(h.server).id, task.id, "a feed update does not rebuild an active model task");
  h.complete();
  await h.service.syncBrief(false);
  const board = await h.service.sanitizeBoard(h.read());
  assert(board.modules.today.data.brief.length > 0);
  assert.equal(board.modules.today.data.nativeBrief.sources.length, 2);
  const count = h.calls.length;
  await h.service.syncBrief(false);
  assert.equal(h.calls.length, count, "a completed daily brief is reused without another task request");
  const manual = await h.service.syncBrief(true);
  assert.equal(manual.status, "pending", "an explicit update may use changed evidence");
  assert.notEqual(manual.taskId, task.id);
  assert.equal((await h.service.sanitizeBoard(h.read())).brief.status, "pending", "an older valid brief stays visible while the newer task remains pending");
  const again = await h.service.syncBrief(true);
  assert.equal(again.taskId, manual.taskId);
  h.complete(); await h.service.syncBrief(false);
  assert.equal((await h.service.syncBrief(true)).status, "completed", "manual refresh with unchanged evidence reuses the result");
  h.control.permitted = false; h.control.epoch++;
  assert.equal((await h.service.sanitizeBoard(h.read())).modules.today.data.brief, "", "revoked evidence cannot remain visible in an automatic brief");
}
{
  const h = harness();
  const initial = await h.service.refreshBoard();
  assert.equal(initial.brief.status, "pending", "opening the board prepares a brief without waiting for news organization");
  const task = pendingBrief(h.server);
  h.server.briefs[0].expiresAt = Date.now() - 1;
  assert.equal(pendingBrief(h.server), null);
  await h.service.refreshBoard();
  assert.equal(pendingBrief(h.server).id, task.id, "board refresh renews an expired task instead of leaving an unconsumable queue");
  h.complete();
  assert.equal((await h.service.refreshBoard()).brief.status, "completed");
  const count = h.calls.length;
  await h.service.refreshBoard();
  assert.equal(h.calls.length, count, "idle board polling reuses a completed brief without new model work");
  h.control.items = [];
  const empty = await h.service.refreshBoard();
  assert.equal(empty.brief.status, "completed");
  assert(empty.modules.today.data.brief, "feed rotation must not clear the saved brief while its sources remain authorized");
  assert.equal((await h.service.sanitizeBoard(h.read())).brief.status, "completed", "later dashboard reads must not restore a stale pending label");
  h.control.permitted = false; h.control.epoch++;
  assert.equal((await h.service.sanitizeBoard(h.read())).modules.today.data.brief, "", "source revocation still clears a brief after feed rotation");
}
{
  for (const change of ["evidence", "date", "rotation"]) {
    const h = harness();
    await h.service.refreshBoard(); h.complete();
    const original = await h.service.refreshBoard();
    const saved = structuredClone(original.modules.today);
    if (change === "evidence") h.control.items[0].excerpt += "新资料补充了发布时间。";
    else if (change === "date") h.control.date = "2099-01-01";
    else h.control.items = h.control.items.map((item, i) => ({ ...item, articleId: `replacement-${i}`, url: `${item.url}-new` }));
    await h.service.syncBrief(true);
    let workflow = h.service;
    for (const status of ["idle", "running", "failed"]) {
      const board = await workflow.sanitizeBoard({ ...h.read(), runner: { mode: "codex", kind: "brief", status } });
      const payload = botDashboardPayload({}, board);
      assert.deepEqual(board.modules.today, saved, `${change}: regeneration must retain the full previous brief during ${status}`);
      assert.equal(payload.dailyDigest.taskStatus, "pending");
      assert.equal(briefTaskPhase({ data: payload }), status === "idle" ? "queued" : status);
      assert.deepEqual(payload.dailyDigest.overview, [saved.data.brief]);
      workflow = h.restart();
    }
    assert(!h.calls.some(call => call.invalidateIds), "freshness changes must not delete the completed server brief");
    h.control.offline = true;
    assert.equal((await workflow.syncBrief()).status, "unavailable");
    assert.deepEqual((await workflow.sanitizeBoard(h.read())).modules.today, saved, "connection failures retain the saved brief");
    h.control.offline = false;
    const replacementId = pendingBrief(h.server).id;
    h.complete("新一版简报已经生成，更新确认了发布时间及现有设备的支持范围。");
    const replaced = await workflow.refreshBoard();
    assert.equal(replaced.brief.status, "completed");
    assert.notEqual(replaced.modules.today.data.brief, saved.data.brief);
    assert.equal(replaced.modules.today.data.nativeBrief.taskId, replacementId);
  }
}
{
  const h = harness(); await h.service.refreshBoard(); h.complete(); await h.service.refreshBoard();
  for (const record of h.records.values()) for (const job of record.jobs || []) for (const source of job.sources) {
    delete source.sourceOrigin; delete source.fetchOrigin;
  }
  h.control.items[0].excerpt += "新资料补充了发布时间。";
  assert((await h.service.sanitizeBoard(h.read())).modules.today.data.brief, "existing cache records can validate against the permitted feed");
  h.control.afterPermissionCheck = () => { h.control.epoch++; };
  assert.equal((await h.service.sanitizeBoard(h.read())).modules.today.data.brief, "", "an epoch change while checking saved content must fail closed");
}
{
  const h = harness(); await h.service.refreshBoard(); h.complete();
  const saved = (await h.service.refreshBoard()).modules.today;
  h.control.items[0].excerpt += "新的发布时间已经公布。";
  await h.service.syncBrief(true);
  h.server.modules.today.data.nativeBrief.owner = "different-profile";
  h.server.modules.today.data.brief = "OTHER_PROFILE_CONTENT";
  const workflow = h.restart();
  const pending = await workflow.sanitizeBoard(h.read());
  assert.equal(pending.brief.status, "pending");
  assert.deepEqual(pending.modules.today, saved, "a new job must not overwrite the saved browser-specific snapshot");
  delete h.server.modules.today;
  assert.deepEqual((await workflow.sanitizeBoard(h.read())).modules.today, saved, "the saved brief survives dashboard reload while queued");
  h.settings.uiLocale = "en";
  assert.equal((await workflow.sanitizeBoard(h.read())).modules.today, undefined, "saved briefs still respect locale changes");
  h.settings.uiLocale = "zh-CN";
  h.control.permitted = false; h.control.epoch++;
  assert.equal((await workflow.sanitizeBoard(h.read())).modules.today, undefined, "saved snapshots cannot bypass revoked source access");
}
{
  const h = harness();
  h.server.modules.today = { schemaVersion: 1, bot: "Bot", updatedAt: new Date().toISOString(), data: { brief: "已发布的简报正文。" } };
  await h.service.syncBrief(true);
  const pending = await h.service.sanitizeBoard(h.read());
  assert.equal(pending.brief.status, "pending", "published content must not hide the replacement task status");
  assert.equal(pending.modules.today.data.brief, "已发布的简报正文。");
}
{
  const h = harness(); h.control.running = true;
  assert.equal((await h.service.syncBrief()).status, "collecting"); assert.equal(h.calls.length, 0);
  h.control.running = false; h.control.items = [];
  assert.equal((await h.service.syncBrief()).status, "empty"); assert.equal(pendingBrief(h.server), null);
}
{
  const h = harness(); await h.service.syncBrief();
  h.settings.dashboardMode = "standard";
  await h.service.syncBrief();
  assert.equal(pendingBrief(h.server), null);
  assert.throws(h.complete);
}
{
  const h = harness(); await h.service.syncBrief();
  h.settings.botGenerateBrief = false;
  assert.equal((await h.service.syncBrief()).status, "disabled");
  assert.equal(pendingBrief(h.server), null, "unchecking daily brief cancels the pending assistant brief");
  const count = h.calls.length;
  await h.service.syncBrief(); assert.equal(h.calls.length, count, "disabled brief does not recreate assistant work");
  h.settings.botGenerateBrief = true;
  assert.equal((await h.service.syncBrief()).status, "pending", "re-enabling brief ownership can resume generation");
}
{
  const h = harness(); await h.service.syncBrief(); h.complete(); await h.service.syncBrief();
  h.server.modules.today.data.nativeBrief.owner = "different-profile";
  h.server.modules.today.data.brief = "OTHER_PROFILE_CONTENT";
  const preserved = await h.service.sanitizeBoard(h.read());
  assert(!preserved.modules.today.data.brief.includes("OTHER_PROFILE_CONTENT"));
  assert.equal(preserved.modules.today.data.nativeBrief.owner, "synthetic-owner", "a shared helper must preserve this browser's own validated brief");
  delete h.server.modules.today;
  assert.equal((await h.service.sanitizeBoard(h.read())).modules.today.data.nativeBrief.owner, "synthetic-owner");
}
{
  const h = harness();
  const question = await h.service.prepareMessage({ text: "产品更新影响是什么" }, h.settings);
  assert.equal(question.data.references.length, 3);
  assert(JSON.stringify(question.data.references).length <= 4500);
  assert(!Object.hasOwn(question.data, "apiKey"));
  h.control.permitted = false;
  await assert.rejects(h.service.validateMessage(question.evidence));
  const url = await h.service.prepareMessage({ text: "https://example.com/private" }, h.settings);
  assert.equal(url.data.references.length, 0);
  assert(url.data.contextNotice.includes("No authorized"));
}

{
  const reference = taskReference({ title: "产品资料", excerpt: "更新改善显示效果。", url: "https://example.com/source" });
  const action = { id: "q1", type: "message", text: "说明产品更新", conversationId: "thread-one", locale: "zh-CN", references: [reference] };
  const state = { actions: [{ action, answered: false }], modules: {} };
  const task = prepareTask([action], state.modules, null, new Date().toISOString(), state.actions);
  state.actions[0].taskId = task.id;
  const input = { taskId: task.id, replies: [{ id: action.id, text: "产品更新改善显示效果。", sourceIds: [reference.id] }] };
  assert.deepEqual(completeQuestions(state, input, "2026-11-08T01:00:00Z").completed, ["q1"]);
  const reply = state.modules.replies.data.items[0];
  assert.equal(reply.replyTo, "q1"); assert.equal(reply.createdAt, "2026-11-08T01:00:00.000Z");
  assert(reply.text.includes("https://example.com/source"));
  completeQuestions(state, input, "2026-11-08T02:00:00Z");
  assert.equal(state.modules.replies.data.items.length, 1);
  assert.equal(state.modules.replies.data.items[0].createdAt, "2026-11-08T01:00:00.000Z");
  assert.throws(() => completeQuestions(state, { taskId: task.id, replies: [{ id: "not-in-task", text: "Invalid" }] }, new Date().toISOString()));
  assert.equal(questionReferences(state, "different-task").length, 0);
  const full = { actions: [{ action, taskId: task.id, answered: false }], modules: { replies: { data: { items: Array.from({ length: 138 }, (_, i) => ({
    id: `older-${i}`, replyTo: `old-question-${i}`, text: "旧".repeat(1600), bot: "Bot", createdAt: "2026-11-08T00:00:00Z",
  })) } } } };
  assert.throws(() => completeQuestions(full, { taskId: task.id, replies: [{ id: action.id, text: "答".repeat(16000) }] }, "2026-11-08T02:00:00Z"), { code: "snapshot-too-large" });
  assert.equal(full.actions[0].answered, false, "storage limits must not acknowledge an unpublished answer");
}
console.log("Bot native task tests passed");

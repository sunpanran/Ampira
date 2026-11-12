import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { createBotBoardService } from "../../extension/runtime/bot-board-service.mjs";
import { BOT_CONNECTION_KEY, botConnectionId, botDashboardPayload, botFileUrl, normalizeBotModule, normalizeBotConnection, safeBotUrl } from "../../extension/core/bot-board.mjs";
import { boardUsesBot, isBotMode } from "../../extension/core/bot-mode.mjs";
import { normalizeSettings } from "../../extension/core/settings.mjs";

const timestamp = "2026-11-06T04:00:00.000Z";
const snapshot = (data) => ({ schemaVersion: 1, updatedAt: timestamp, bot: "Synthetic bot", data });
const config = { endpoint: "http://127.0.0.1:43123", boardId: "synthetic-board" };
for (const endpoint of ["https://example.com", "http://localhost:43123", "http://127.0.0.1:0", "http://127.0.0.1:65536", "http://127.0.0.1:43123/private", "http://127.0.0.1:43123?token=secret", "http://2130706433:43123"]) assert.throws(() => normalizeBotConnection({ endpoint }));
assert.throws(() => botFileUrl(config, "../settings.json"));
assert.equal(safeBotUrl("javascript:alert(1)"), "");
assert.equal(safeBotUrl("https://user:password@example.com"), "");
for (const kind of ["weather", "todos", "news"]) assert.throws(() => normalizeBotModule(kind, snapshot({})));
assert.throws(() => normalizeBotModule("replies", snapshot({ items: [{ id: "duplicate", replyTo: "q", text: "One", createdAt: timestamp }, { id: "duplicate", replyTo: "q", text: "Two", createdAt: timestamp }] })));
const released = JSON.parse(await fs.readFile(new URL("../fixtures/released-settings.json", import.meta.url), "utf8")).settings;
const upgraded = normalizeSettings(released);
for (const [field, value] of Object.entries(released)) assert.deepEqual(upgraded[field], value, "published setting must survive upgrade: " + field);
assert.equal(upgraded.mcpEnabled, false); assert.equal(upgraded.dashboardMode, "standard"); assert.equal(upgraded.botOrganizeNews, false);
assert(!isBotMode(upgraded));
assert(isBotMode(normalizeSettings({ mcpEnabled: true, dashboardMode: "bot" })));
assert(!isBotMode(normalizeSettings({ mcpEnabled: false, dashboardMode: "bot" })));
assert(!normalizeSettings({ dashboardMode: "bot" }).mcpEnabled);
assert(!isBotMode({ dashboardMode: "bot" }), "Bot mode cannot imply consent to MCP access");
const nativeBase = { feed: { items: [{ title: "Native news" }] }, bookmarks: [{ key: "native-reference", cardType: "inspiration" }],
  dailyDigest: { status: "local", overview: ["Native brief"], items: [{ id: "native-event" }] },
  ai: { enabled: true, configured: true, webSearchSupported: true }, status: { running: true }, cache: { ready: 1 } };
const remote = { mode: "bot", mcpEnabled: true, connection: config, modules: { today: snapshot({ brief: "Bot daily brief" }) } };
const transferred = botDashboardPayload(nativeBase, remote);
for (const field of ["feed", "bookmarks", "ai", "status", "cache"]) assert.deepEqual(transferred[field], nativeBase[field], field + " stays native in Bot mode");
assert.deepEqual(transferred.dailyDigest.overview, ["Bot daily brief"]);
const markdownBrief = "## 今日重点\n\n**事实**与[来源](https://example.com/source)。\n\n```js\nconst first = 1;\n\n  const indented = 2;\n```";
const markdownToday = normalizeBotModule("today", snapshot({ brief: markdownBrief }));
assert.deepEqual(botDashboardPayload(nativeBase, { ...remote, modules: { today: markdownToday } }).dailyDigest.overview, [markdownBrief],
  "brief delivery must preserve Markdown paragraph boundaries, blank code lines and indentation");
assert.equal(normalizeBotModule("replies", snapshot({ items: [{ id: "markdown", replyTo: "question", text: markdownBrief, createdAt: timestamp }] })).data.items[0].text,
  markdownBrief, "conversation delivery must preserve the original Markdown");
assert.deepEqual(transferred.nativeDailyDigest.items, nativeBase.dailyDigest.items);
assert(boardUsesBot(transferred));
assert(!boardUsesBot({ bot: { ...remote, mode: "standard" } }));
assert(!boardUsesBot({ bot: { ...remote, mcpEnabled: false } }));
assert.deepEqual(botDashboardPayload(nativeBase, { ...remote, mcpEnabled: false }).dailyDigest, nativeBase.dailyDigest);
assert.deepEqual(botDashboardPayload(nativeBase, { ...remote, modules: {} }).dailyDigest.overview, [], "an empty board must not fabricate a brief");
for (const file of ["weather.json", "todos.json", "news.json"]) assert.throws(() => botFileUrl(config, file));

function harness() {
  const local = {};
  const records = new Map();
  const files = new Map([
    ["today.json", snapshot({ brief: "Synthetic brief" })],
    ["replies.json", snapshot({ items: [] })],
  ]);
  const calls = [];
  const failures = new Map();
  let mode = "bot", mcpEnabled = true, epoch = 0, allowed = true, sequence = 0, afterFetch = null, failAfterWrite = false;
  let clock = Date.parse(timestamp);
  const takeover = { botGenerateBrief: true, botAnswerQuestions: true };
  const storage = { async get(key) { return { [key]: structuredClone(local[key]) }; }, async set(values) { Object.assign(local, structuredClone(values)); }, async remove(key) { delete local[key]; } };
  const service = createBotBoardService({
    storage, getSettings: async () => ({ dashboardMode: mode, mcpEnabled, ...takeover }),
    getRecord: async (key, fallback) => structuredClone(records.has(key) ? records.get(key) : fallback),
    setRecord: async (key, value) => records.set(key, structuredClone(value)),
    hasOriginPermission: async () => allowed,
    capturePermissionEpoch: () => epoch, isPermissionEpochCurrent: (value) => value === epoch,
    cacheMutations: { capture: () => 0, isCurrent: (value) => value === 0, run: (action) => action() },
    now: () => new Date(clock).toISOString(), uuid: () => `synthetic-${++sequence}`,
    fetchContent: async (url, options) => {
      if (new URL(url).pathname === "/health") return { response: { ok: true, status: 200, headers: { get: () => null } }, buffer: new TextEncoder().encode(JSON.stringify({ app: "ampira-local-mcp", schemaVersion: 1, boardId: new URL(url).port === "43123" ? "synthetic-board" : "different-board" })).buffer };
      const path = new URL(url).pathname.slice("/v1/".length);
      calls.push({ url, method: options.method, validator: options.headers["If-None-Match"] || "" });
      assert.equal(new URL(url).hostname, "127.0.0.1");
      assert.equal(options.credentials, "omit");
      assert.equal(options.redirect, "error");
      assert(options.headers.Authorization.startsWith("Bearer "));
      let status = failures.get(path) || 200;
      let result;
      const etag = files.has(path) ? `"${createHash("sha256").update(JSON.stringify(files.get(path))).digest("hex")}"` : "";
      if (options.method === "PUT") {
        assert(!files.has(path), "inbox writes must not overwrite files");
        const body = JSON.parse(options.body);
        files.set(path, body);
        if (failAfterWrite) { failAfterWrite = false; throw new Error("simulated lost response"); }
        result = { accepted: true };
      } else if (status === 200 && etag && options.headers["If-None-Match"] === etag) status = 304;
      else if (!files.has(path)) status = 404;
      else result = files.get(path);
      if (afterFetch) { const callback = afterFetch; afterFetch = null; callback(); }
      return { response: { ok: status < 300, status, headers: { get: (name) => name === "etag" ? etag : name === "x-ampira-board" ? (new URL(url).port === "43123" ? "synthetic-board" : "different-board") : null } }, buffer: new TextEncoder().encode(JSON.stringify(result || {})).buffer };
    },
  });
  const rawSubmit = service.submit;
  service.submit = (body) => rawSubmit({ connectionId: botConnectionId(config), ...body });
  return { service, local, files, records, calls, failures, takeover,
    advance: milliseconds => { clock += milliseconds; },
    connect: () => service.configure({ ...config, token: "synthetic-credential", consent: true }),
    revoke: () => { epoch += 1; allowed = false; }, changeMode: () => { mode = "standard"; },
    setMcp: value => { mcpEnabled = value; },
    interrupt: (callback) => { afterFetch = callback; }, loseWriteResponse: () => { failAfterWrite = true; } };
}

{
  const h = harness(); await h.connect();
  await h.service.refresh();
  const calls = h.calls.length;
  h.files.set("today.json", snapshot({ brief: "New completed brief" }));
  h.advance(1999);
  assert.equal((await h.service.refresh()).modules.today.data.brief, "Synthetic brief");
  assert.equal(h.calls.length, calls, "overlapping page polls share the cached read");
  h.advance(1);
  assert.equal((await h.service.refresh()).modules.today.data.brief, "New completed brief", "completed work is available after two seconds, not ten");
}
{
  const h = harness();
  await assert.rejects(h.service.configure({ ...config, token: "synthetic" }), { code: "consentRequired" });
  await h.connect();
  assert(!JSON.stringify(await h.service.config()).includes("synthetic-credential"), "credentials must never appear in public settings");
  const loaded = await h.service.refresh({ force: true });
  assert.equal(loaded.modules.today.data.brief, "Synthetic brief");
  const unchanged = await h.service.refresh({ force: true });
  assert.equal(unchanged.modules.today.data.brief, "Synthetic brief", "304 must reuse only an already validated snapshot");
  assert(h.calls.filter(call => !call.url.endsWith("runner.json")).slice(-2).every((call) => call.validator), "validated modules should use conditional reads");
  h.files.set("today.json", { schemaVersion: 2 });
  const partial = await h.service.refresh({ force: true });
  assert.equal(partial.errors.today, "invalidData");
  assert.equal(partial.modules.today.data.brief, "Synthetic brief", "invalid updates must preserve valid cached content");
  const failedValidator = h.calls.findLast((call) => call.url.includes("today.json")).validator;
  await h.service.refresh({ force: true });
  assert.equal(h.calls.findLast((call) => call.url.includes("today.json")).validator, failedValidator, "a rejected response must not promote its validator into the trusted cache");
  h.files.set("today.json", { ...snapshot({ brief: "Older brief" }), updatedAt: "2026-11-05T00:00:00Z" });
  assert.equal((await h.service.refresh({ force: true })).errors.today, "olderData");
  const submitted = await h.service.submit({ type: "message", text: "Test message 中文" });
  const action = submitted.outbox[0].action;
  assert.equal(submitted.outbox[0].status, "sent");
  assert.equal(h.files.get(`inbox/${action.id}.json`).text, "Test message 中文");
  h.files.set("replies.json", snapshot({ items: [{ id: "reply-1", replyTo: action.id, text: "Synthetic answer", createdAt: timestamp }] }));
  assert.equal((await h.service.refresh({ force: true })).outbox[0].status, "answered");
  const beforeTodo = h.calls.length;
  await assert.rejects(h.service.submit({ type: "todo.set-completed", todoId: "todo-1", completed: true }), { code: "invalidData" });
  assert.equal(h.calls.length, beforeTodo, "routine to-dos must never be sent to MCP");
  h.changeMode();
  const count = h.calls.length;
  await assert.rejects(h.service.submit({ type: "message", text: "must not send" }), { code: "inactive" });
  assert.equal(h.calls.length, count);
}
{
  const h = harness(); await h.connect();
  h.files.set("runner.json", { mode: "codex", status: "failed", error: "auth", executable: "PRIVATE_PATH" });
  const result = await h.service.submit({ type: "message", text: "Retry generation" });
  assert.equal(result.runner.error, "auth"); assert(!JSON.stringify(result).includes("PRIVATE_PATH"));
  await h.service.submit({ retryId: result.outbox[0].action.id });
  assert.equal(h.calls.filter(call => call.method === "PUT").length, 1);
  assert(h.calls.some(call => call.method === "POST" && call.url.endsWith("runner.json")), "retry generation explicitly wakes the worker without a duplicate inbox action");
}
{
  const h = harness(); await h.connect();
  h.loseWriteResponse();
  const failed = await h.service.submit({ type: "message", text: "Only once" });
  assert.equal(failed.outbox[0].status, "failed");
  const retried = await h.service.submit({ retryId: failed.outbox[0].action.id });
  assert.equal(retried.outbox[0].status, "sent");
  assert.equal(h.calls.filter((call) => call.method === "PUT").length, 1, "retry must not duplicate an already delivered inbox message");
}
{
  const h = harness(); await h.connect();
  h.interrupt(h.revoke);
  await assert.rejects(h.service.refresh({ force: true }), { code: "connectionChanged" });
  assert.equal(h.records.size, 0, "permission revocation must prevent caching stale in-flight data");
  assert.deepEqual((await h.service.read()).modules, {});
}
{
  const h = harness(); await h.connect(); await h.service.refresh({ force: true });
  await assert.rejects(h.service.configure({ ...config, endpoint: "http://127.0.0.1:43124", consent: true }), { code: "credentialRequired" });
  await h.service.configure({ ...config, endpoint: "http://127.0.0.1:43124", token: "another-synthetic-credential", consent: true });
  await assert.rejects(h.service.submit({ type: "message", text: "stale window" }), { code: "connectionChanged" });
  assert.deepEqual((await h.service.read()).modules, {}, "local boards must not share a board cache");
  assert.deepEqual((await h.service.read()).outbox, [], "local boards must not share pending actions");
  await h.service.disconnect();
  assert.equal(h.local[BOT_CONNECTION_KEY], undefined);
}
{
  const h = harness(); await h.connect();
  const result = await h.service.refresh({ force: true });
  assert.deepEqual(Object.keys(result.modules), ["today", "replies"]);
  assert.deepEqual(h.calls.map(call => new URL(call.url).pathname), ["/v1/today.json", "/v1/replies.json", "/v1/runner.json"]);
  const count = h.calls.length; await h.service.refresh();
  assert.equal(h.calls.length, count, "unchanged checks still reuse the refresh window");

}
{
  const h = harness(); await h.connect();
  h.interrupt(h.changeMode);
  await assert.rejects(h.service.refresh({ force: true }), { code: "inactive" });
  assert.equal(h.records.size, 0, "switching modes must discard in-flight responses");
  assert.deepEqual((await h.service.read()).modules, {});
}
{
  const h = harness(); await h.connect(); await h.service.refresh({ force: true });
  h.setMcp(false);
  const count = h.calls.length;
  await assert.rejects(h.service.refresh({ force: true }), { code: "mcpDisabled" });
  await assert.rejects(h.service.submit({ type: "message", text: "Must stay local" }), { code: "mcpDisabled" });
  assert.deepEqual((await h.service.read()).modules, {});
  assert.equal((await h.service.config()).mode, "bot", "master switch preserves the selected mode");
  assert.equal(h.calls.length, count);
  h.setMcp(true);
  assert.equal((await h.service.read()).modules.today.data.brief, "Synthetic brief");
}
{
  const h = harness(); await h.connect(); await h.service.refresh({ force: true });
  h.takeover.botGenerateBrief = false;
  h.calls.length = 0;
  const result = await h.service.refresh({ force: true });
  assert(!result.modules.today && result.modules.replies);
  assert(!h.calls.some(call => call.url.endsWith("today.json")), "disabled daily briefs are neither fetched nor displayed");
  h.takeover.botAnswerQuestions = false;
  const count = h.calls.length;
  await assert.rejects(h.service.submit({ type: "message", text: "Must use native AI" }), { code: "inactive" });
  assert.equal(h.calls.length, count, "disabled chat must not submit or retry assistant tasks");
  assert.deepEqual((await h.service.read()).modules, {});
  h.takeover.botGenerateBrief = true;
  assert.equal((await h.service.read()).modules.today.data.brief, "Synthetic brief", "re-enabling a feature retains its cached content");
}
{
  const h = harness(); await h.connect();
  h.interrupt(() => { h.takeover.botAnswerQuestions = false; });
  await assert.rejects(h.service.submit({ type: "message", text: "No late send" }), { code: "inactive" });
  assert(!h.calls.some(call => call.method === "PUT"), "an unchecked chat scope blocks an in-flight submission before delivery");
}
console.log("bot board tests passed");

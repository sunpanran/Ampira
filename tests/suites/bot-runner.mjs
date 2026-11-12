import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { openBoardStore } from "../../integrations/local-mcp/board-store.mjs";
import { startTaskRunner } from "../../integrations/local-mcp/task-runner.mjs";
import { runCodexTask } from "../../integrations/local-mcp/codex-runner.mjs";
import { startBridge } from "../../integrations/local-mcp/http-bridge.mjs";
import { briefContext } from "../../extension/core/bot-task-context.mjs";
import { botRunnerStatusKey } from "../../assets/client/bot-runner-status.mjs";

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ampira-runner-test-"));
const config = { mode: "codex", executable: process.execPath };
const action = id => ({ schemaVersion: 1, id, type: "message", text: "合成测试问题", locale: "zh-CN", createdAt: new Date().toISOString() });
const answer = task => task.kind === "brief" ? { taskId: task.id, brief: "本次更新改善显示效果，已有设备可使用更新。", sourceIds: [task.context[0].id] }
  : task.kind === "summary" ? { taskId: task.id, summaries: task.items.map(item => ({ id: item.id, title: "产品显示更新", summary: ["更新改善显示效果，并支持现有设备。"] })) }
  : { taskId: task.id, replies: task.messages.map(item => ({ id: item.id, text: "合成测试回答", sourceIds: [] })) };
let store, runner, bridge;
try {
  store = await openBoardStore(directory);
  const question = action("first");
  await store.submit(question);
  const material = briefContext([{ title: "产品显示更新", excerpt: "显示效果得到改善，已有设备可使用更新。", url: "https://example.com/update" }]);
  await store.syncBrief({ owner: "test-owner", request: { id: "brief-test", date: "2026-11-09", locale: "zh-CN", fingerprint: "brief-content", ...material } });
  await store.syncSummaries({ requests: [{ id: "summary-first", locale: "zh-CN", title: "Product update", excerpt: "The update improves display quality." }] });
  let release, calls = [], concurrent = 0, maximum = 0;
  const gate = new Promise(resolve => { release = resolve; });
  runner = await startTaskRunner(store, { execute: async task => {
    calls.push(task.kind); maximum = Math.max(maximum, ++concurrent);
    if (calls.length === 1) await gate;
    concurrent--; return answer(task);
  } });
  await delay(20); assert.equal(calls.length, 0, "pairing alone must not start a paid model run");
  await store.configureRunner(config);
  await until(() => calls.length === 1);
  await store.submit(question); await store.submit(action("second"));
  assert.equal(calls.length, 1, "duplicate submissions and new arrivals must not overlap a run");
  release();
  await until(() => !store.getPending("question") && !store.getPending("brief") && !store.getPending("summary"));
  assert.deepEqual(calls, ["question", "question", "brief", "summary"]); assert.equal(maximum, 1);
  assert.equal(store.module("replies").data.items.length, 2);
  assert.equal(store.module("today").data.nativeBrief.taskId, "brief-test");
  assert(!JSON.stringify(store.runnerStatus()).includes(process.execPath));
  await runner.close();

  let summaryAttempts = [];
  runner = await startTaskRunner(store, { execute: async task => {
    summaryAttempts.push(task.items.map(item => item.id));
    const result = answer(task);
    if (summaryAttempts.length === 1) result.summaries[0] = { id: task.items[0].id, title: "Wrong language", summary: ["Still in English."] };
    return result;
  } });
  await store.syncSummaries({ requests: ["summary-repair", "summary-good"].map(id => ({ id, locale: "zh-CN", title: "News", excerpt: "A synthetic update." })) });
  await until(() => !store.getPending("summary"));
  assert.deepEqual(summaryAttempts, [["summary-repair", "summary-good"], ["summary-repair"]], "only rejected results are corrected");
  await runner.close();

  let failures = 0;
  runner = await startTaskRunner(store, { execute: async () => { failures++; throw Object.assign(new Error("private diagnostics"), { code: "auth" }); } });
  await store.submit(action("needs-retry"));
  await until(() => store.runnerStatus().status === "failed");
  assert.equal(store.runnerStatus().error, "auth");
  await store.submit(action("later")); await delay(20);
  assert.equal(failures, 1, "failed tasks pause the queue without an automatic billing loop");
  await runner.close(); await store.close(); store = await openBoardStore(directory);
  let retries = 0;
  runner = await startTaskRunner(store, { execute: async task => { retries++; return answer(task); } });
  await delay(20); assert.equal(retries, 0, "restart preserves a failed run until an explicit retry");
  await store.retryRunner();
  await until(() => !store.getPending("question"));
  assert.equal(retries, 2);
  await runner.close();

  await store.submit(action("interrupted"));
  await store.beginRunnerTask(); await store.close(); store = await openBoardStore(directory);
  runner = await startTaskRunner(store, { execute: async task => { retries++; return answer(task); } });
  assert.equal(store.runnerStatus().error, "interrupted");
  await runner.close(); await store.retryRunner();
  const job = await store.beginRunnerTask();
  await store.completeTask(answer(job.task));
  assert.equal(await store.completeRunnerTask(job.runId, { ...answer(job.task), replies: [{ id: "interrupted", text: "Must not overwrite" }] }), false,
    "a manual completion wins over a late automatic result");

  await store.submit(action("validate"));
  const invalid = await store.beginRunnerTask();
  await assert.rejects(store.completeRunnerTask(invalid.runId, { taskId: invalid.task.id, replies: [] }));
  assert(store.getPending("question"), "invalid results cannot consume a question");
  await store.configureRunner({ mode: "manual" });
  assert.equal(await store.completeRunnerTask(invalid.runId, answer(invalid.task)), false, "disabling the runner invalidates its in-flight output");

  bridge = await startBridge(store, 0);
  const headers = { Authorization: `Bearer ${store.token}`, "Content-Type": "application/json" };
  const status = await (await fetch(bridge.endpoint + "/v1/runner.json", { headers })).json();
  assert.equal(status.mode, "manual");
  assert.equal((await fetch(bridge.endpoint + "/runner/config", { method: "POST", headers: { ...headers, Origin: `chrome-extension://${"a".repeat(32)}` }, body: JSON.stringify(config) })).status, 403);
  assert.equal((await fetch(bridge.endpoint + "/v1/runner.json", { method: "POST", headers, body: JSON.stringify({ retry: true, executable: "injection" }) })).status, 400);
  assert.equal((await fetch(bridge.endpoint + "/v1/runner.json")).status, 401);

  let childDirectory;
  const syntheticTask = { id: "schema-test", kind: "question", locale: "zh-CN", messages: [{ id: "message", text: "$(untrusted-command)" }], context: { items: [], recent: [] } };
  const spawnProcess = (executable, args, options) => {
    assert.equal(executable, process.execPath); assert.equal(options.shell, false); assert.equal(options.windowsHide, true);
    assert(args.includes("--ignore-user-config") && args.includes("read-only") && args.includes("--ephemeral"));
    assert(args.includes('model_reasoning_effort="low"'), "routine board tasks must explicitly use low reasoning effort");
    assert(!args.some(arg => arg.includes("untrusted-command")), "task text is stdin data, never command arguments");
    childDirectory = options.cwd;
    const child = new EventEmitter(); child.stdin = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => queueMicrotask(() => child.emit("close", 1));
    child.stdin.on("finish", async () => {
      await fs.writeFile(args[args.indexOf("--output-last-message") + 1], JSON.stringify(answer(syntheticTask)));
      child.emit("close", 0);
    });
    return child;
  };
  assert.deepEqual(await runCodexTask(syntheticTask, { executable: process.execPath, spawnProcess }), answer(syntheticTask));
  let resolved = false;
  assert.deepEqual(await runCodexTask(syntheticTask, { executable: "missing-store-version", spawnProcess,
    resolveExecutable: async value => { assert.equal(value, "missing-store-version"); resolved = true; return process.execPath; } }), answer(syntheticTask));
  assert(resolved, "the runner must launch the resolved executable, preserving its existing process restrictions");
  await assert.rejects(runCodexTask(syntheticTask, { executable: "missing-custom-executable", spawnProcess: () => assert.fail("must not spawn"),
    resolveExecutable: async () => { throw Object.assign(new Error("unavailable"), { code: "unavailable" }); } }), { code: "unavailable" });
  await assert.rejects(fs.access(childDirectory), { code: "ENOENT" });
  await assert.rejects(runCodexTask(syntheticTask, { executable: process.execPath, timeoutMs: 10, spawnProcess: () => {
    const child = new EventEmitter(); child.stdin = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => queueMicrotask(() => child.emit("close", 1)); return child;
  } }), { code: "timeout" });
  assert.equal(botRunnerStatusKey({}), "bot.connectFirst");
  assert.equal(botRunnerStatusKey({ connection: {} }), "bot.runner.manual");
  assert.equal(botRunnerStatusKey({ connection: {}, runner: { mode: "codex", status: "running", messageIds: ["message"] } }, { messageId: "message" }), "bot.runner.running");
  assert.equal(botRunnerStatusKey({ connection: {}, runner: { mode: "codex", status: "running", kind: "question" } }, { brief: true }), "bot.runner.queued");
  assert.equal(botRunnerStatusKey({ connection: {}, runner: { mode: "codex", status: "failed", error: "timeout" } }), "bot.runner.error.timeout");
} finally {
  await bridge?.close(); await runner?.close(); await store?.close();
  assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
  assert(path.basename(directory).startsWith("ampira-runner-test-"));
  await fs.rm(directory, { recursive: true, force: true });
}
async function until(condition) {
  const deadline = Date.now() + 5000;
  while (!condition()) { if (Date.now() > deadline) throw new Error("runner-test-timeout"); await delay(10); }
}
console.log("Automatic Codex task runner tests passed");

import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { BOT_MODULES, createBotAction, normalizeBotModule } from "../../extension/core/bot-board.mjs";
import { applyBotPatch, assertPlainData, fail, isId } from "./patch.mjs";
import { digest, prepareTask } from "./tasks.mjs";
import { syncSummaries, pendingSummary, completeSummaries } from "./summary-queue.mjs";
import { syncBrief, pendingBrief, completeBrief } from "./brief-queue.mjs";
import { completeQuestions, questionReferences } from "./question-tasks.mjs";

const MAX_STATE_BYTES = 16 * 1024 * 1024;

export async function openBoardStore(directory) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  if ((await fs.lstat(directory)).isSymbolicLink()) fail("symlink-not-allowed");
  const root = await fs.realpath(directory);
  const lockPath = path.join(root, "server.lock");
  const lock = await acquireLock(lockPath);
  await lock.writeFile(String(process.pid));
  let closed = false;
  let queue = Promise.resolve();
  const close = async () => {
    if (closed) return;
    closed = true;
    await queue;
    await lock.close();
    await fs.unlink(lockPath);
  };
  try {
    let state = await readFile("board.json");
    if (!state) {
      state = { schemaVersion: 1, boardId: randomUUID(), modules: {}, actions: [], receipts: [], pending: null, summaries: [], briefs: [] };
      await writeFile("board.json", state);
    }
    if (state.schemaVersion !== 1 || !isId(state.boardId) || !state.modules || !Array.isArray(state.actions)
      || !Array.isArray(state.receipts) || state.actions.length > 5000 || state.receipts.length > 10000) fail("invalid-local-state");
    for (const [kind, module] of Object.entries(state.modules)) normalizeBotModule(kind, module);
    for (const { action } of state.actions) createBotAction(action, { id: action.id, now: action.createdAt });
    state.summaries ||= [];
    if (!Array.isArray(state.summaries) || state.summaries.length > 200) fail("invalid-local-state");
    if (!Array.isArray(state.briefs) || state.briefs.length > 30) fail("invalid-local-state");
    let connection = await readFile("connection.json");
    if (!connection) {
      connection = { schemaVersion: 1, token: randomBytes(32).toString("hex") };
      await writeFile("connection.json", connection);
    }
    if (!/^[a-f0-9]{64}$/.test(connection.token)) fail("invalid-pairing-key");
    const enqueue = (operation) => {
      const result = queue.then(operation);
      queue = result.catch(() => {});
      return result;
    };
    const listeners = new Set();
    async function commit(next) {
      await writeFile("board.json", next);
      state = next;
      for (const listener of listeners) listener();
    }
    const runnerTask = next => next.pending || pendingBrief(next) || pendingSummary(next);
    const runnerStatus = () => ({ mode: state.runnerConfig?.mode || "manual", status: state.runnerRun?.status || "idle",
      ...(state.runnerRun ? { taskId: state.runnerRun.taskId, kind: state.runnerRun.kind, messageIds: state.runnerRun.messageIds,
        error: state.runnerRun.error || "" } : {}) });
    function pending(next, now) {
      const messages = next.actions.filter((entry) => !entry.answered).map((entry) => entry.action);
      next.pending = prepareTask(messages, next.modules, next.pending, now, next.actions);
      for (const message of next.pending?.messages || []) {
        const entry = next.actions.find(item => item.action.id === message.id);
        if (entry) entry.taskId = next.pending.id;
      }
    }
    pending(state, new Date().toISOString());
    return {
      boardId: state.boardId, token: connection.token, root, close,
      subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
      runnerConfig: () => structuredClone(state.runnerConfig || { mode: "manual" }),
      runnerStatus,
      configureRunner: input => enqueue(async () => {
        assertPlainData(input);
        if (!input || !["manual", "codex"].includes(input.mode) || Object.keys(input).some(key => !["mode", "executable"].includes(key))
          || input.mode === "codex" && (typeof input.executable !== "string" || !path.isAbsolute(input.executable) || /[\r\n]/.test(input.executable))) fail("invalid-runner");
        const config = input.mode === "manual" ? { mode: "manual" } : { mode: "codex", executable: input.executable };
        if (JSON.stringify(config) !== JSON.stringify(state.runnerConfig)) await commit({ ...state, runnerConfig: config, runnerRun: null });
        return runnerStatus();
      }),
      recoverRunner: () => enqueue(async () => {
        if (state.runnerRun?.status === "running") await commit({ ...state, runnerRun: { ...state.runnerRun, status: "failed", error: "interrupted" } });
      }),
      retryRunner: () => enqueue(async () => {
        if (state.runnerRun?.status === "failed") await commit({ ...state, runnerRun: null });
        return runnerStatus();
      }),
      beginRunnerTask: () => enqueue(async () => {
        if (state.runnerConfig?.mode !== "codex" || state.runnerRun) return null;
        const task = runnerTask(state);
        if (!task) return null;
        const run = { id: randomUUID(), taskId: task.id, fingerprint: digest(task), kind: task.kind,
          messageIds: task.messages?.map(item => item.id) || [], status: "running" };
        await commit({ ...state, runnerRun: run });
        return { task: structuredClone(task), runId: run.id, config: structuredClone(state.runnerConfig) };
      }),
      failRunnerTask: (id, error) => enqueue(async () => {
        if (state.runnerRun?.id !== id || state.runnerRun.status !== "running") return;
        const code = ["unavailable", "auth", "quota", "timeout", "invalidResult", "interrupted"].includes(error) ? error : "failed";
        await commit({ ...state, runnerRun: { ...state.runnerRun, status: "failed", error: code } });
      }),
      completeRunnerTask: (id, input) => enqueue(async () => {
        const run = state.runnerRun;
        if (run?.id !== id || run.status !== "running" || state.runnerConfig?.mode !== "codex") return false;
        const task = run.kind === "question" ? state.pending : run.kind === "brief" ? pendingBrief(state) : pendingSummary(state);
        if (!task || digest(task) !== run.fingerprint) { await commit({ ...state, runnerRun: null }); return false; }
        if (input?.taskId !== task.id || task.kind === "question" && (!Array.isArray(input.replies)
          || input.replies.length !== task.messages.length || task.messages.some(message => !input.replies.some(reply => reply.id === message.id)))) fail("invalid-runner-result");
        const next = structuredClone(state), now = new Date().toISOString();
        if (task.kind === "brief") completeBrief(next, input, now);
        else if (task.kind === "summary") {
          const values = Array.isArray(input.summaries) ? input.summaries : [];
          completeSummaries(next, { taskId: task.id, summaries: task.items.map(item => values.find(value => value.id === item.id) || { id: item.id }) });
        } else completeQuestions(next, input, now);
        next.runnerRun = null;
        pending(next, now);
        await commit(next);
        return true;
      }),
      configureEndpoint: async (endpoint) => writeFile("connection.json", { ...connection, endpoint }),
      module: (kind) => { if (!BOT_MODULES.includes(kind)) fail("invalid-module"); return structuredClone(state.modules[kind] || null); },
      action: (id) => structuredClone(state.actions.find((entry) => entry.action.id === id)?.action || null),
      taskReferences: taskId => {
        const job = state.briefs.find(value => value.id === taskId);
        return structuredClone(job ? job.status === "cancelled" ? [] : job.references : questionReferences(state, taskId));
      },
      getPending: kind => structuredClone(kind === "question" ? state.pending : kind === "summary" ? pendingSummary(state)
        : kind === "brief" ? pendingBrief(state) : state.pending || pendingBrief(state) || pendingSummary(state)),
      syncBrief: input => enqueue(async () => {
        const next = structuredClone(state), result = syncBrief(next, input);
        if (JSON.stringify(next) !== JSON.stringify(state)) await commit(next);
        return result;
      }),
      syncSummaries: input => enqueue(async () => {
        const next = structuredClone(state), result = syncSummaries(next, input);
        if (JSON.stringify(next) !== JSON.stringify(state)) await commit(next);
        return result;
      }),
      completeTask: input => enqueue(async () => {
        const next = structuredClone(state), now = new Date().toISOString();
        const result = input.summaries ? completeSummaries(next, input)
          : input.brief !== undefined ? completeBrief(next, input, now) : completeQuestions(next, input, now);
        pending(next, now);
        if (JSON.stringify(next) !== JSON.stringify(state)) await commit(next);
        return result;
      }),
      submit: (input) => enqueue(async () => {
        assertPlainData(input);
        if (input?.schemaVersion !== 1) fail("invalid-action");
        const action = createBotAction(input, { id: input.id, now: input.createdAt });
        const previous = state.actions.find((entry) => entry.action.id === action.id);
        if (previous) {
          if (digest(previous.action) !== digest(action)) fail("conflict");
          return { accepted: true, duplicate: true };
        }
        if (state.actions.length >= 5000) fail("storage-full");
        const next = structuredClone(state), now = new Date().toISOString();
        next.actions.push({ action, answered: false });
        pending(next, now);
        await commit(next);
        return { accepted: true, duplicate: false };
      }),
      publish: (input) => enqueue(async () => {
        assertPlainData(input);
        if (!input || !isId(input.id) || !BOT_MODULES.includes(input.module)
          || Object.keys(input).some((key) => !["id", "module", "bot", "set", "upsert", "remove"].includes(key))) fail("invalid-patch");
        const hash = digest(input), previous = state.receipts.find((item) => item.id === input.id);
        if (previous) {
          if (previous.hash !== hash) fail("conflict");
          return { applied: true, duplicate: true, module: input.module, updatedAt: previous.updatedAt };
        }
        if (state.receipts.length >= 10000) fail("storage-full");
        const next = structuredClone(state), now = new Date().toISOString();
        if (input.module === "replies") {
          for (const reply of input.upsert?.items || []) {
            const replyTo = reply.replyTo || next.modules.replies?.data.items.find((item) => item.id === reply.id)?.replyTo;
            if (!next.actions.some((entry) => entry.action.id === replyTo)) fail("unknown-message");
          }
        }
        const module = applyBotPatch(next.modules[input.module], { ...input, schemaVersion: 1, createdAt: now, bot: input.bot || "AI assistant" }, monotonic(now, next.modules[input.module]));
        if (Buffer.byteLength(JSON.stringify(module)) > 700 * 1024) fail("snapshot-too-large");
        next.modules[input.module] = module;
        if (input.module === "today" && Object.hasOwn(input.set || {}, "brief")) {
          delete next.modules.today.data.nativeBrief;
          for (const job of next.briefs) if (job.status === "pending") job.status = "cancelled";
        }
        if (input.module === "replies") {
          for (const entry of next.actions) if (module.data.items.some((item) => item.replyTo === entry.action.id)) entry.answered = true;
        }
        pending(next, now);
        next.receipts.push({ id: input.id, hash, updatedAt: module.updatedAt });
        await commit(next);
        return { applied: true, duplicate: false, module: input.module, updatedAt: module.updatedAt };
      }),
    };
  } catch (error) { await close(); throw error; }

  async function readFile(name) {
    const file = path.join(root, name);
    const info = await fs.lstat(file).catch((error) => { if (error.code === "ENOENT") return null; throw error; });
    if (!info) return null;
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_STATE_BYTES) fail("invalid-local-file");
    const value = JSON.parse(await fs.readFile(file, "utf8"));
    assertPlainData(value);
    return value;
  }
  async function writeFile(name, value) {
    const content = JSON.stringify(value, null, 2) + "\n";
    if (Buffer.byteLength(content) > MAX_STATE_BYTES) fail("storage-full");
    const target = path.join(root, name), temporary = path.join(root, `${name}.${randomUUID()}.tmp`);
    const info = await fs.lstat(target).catch((error) => { if (error.code === "ENOENT") return null; throw error; });
    if (info && (!info.isFile() || info.isSymbolicLink())) fail("invalid-local-file");
    try {
      const handle = await fs.open(temporary, "wx", 0o600);
      try { await handle.writeFile(content, "utf8"); await handle.sync(); } finally { await handle.close(); }
      await fs.rename(temporary, target);
    } finally { await fs.unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; }); }
  }
}

function monotonic(now, previous) { return new Date(Math.max(Date.parse(now), Date.parse(previous?.updatedAt || "") || 0)).toISOString(); }

async function acquireLock(file) {
  try { return await fs.open(file, "wx", 0o600); }
  catch (error) { if (error.code !== "EEXIST") throw error; }
  const recovery = file + ".recovery";
  try { await fs.mkdir(recovery, { mode: 0o700 }); }
  catch (error) { if (error.code === "EEXIST") fail("data-directory-in-use"); throw error; }
  try {
    const info = await fs.lstat(file).catch(error => { if (error.code === "ENOENT") return null; throw error; });
    if (info) {
      if (!info.isFile() || info.isSymbolicLink() || info.size > 32) fail("invalid-service-lock");
      const value = (await fs.readFile(file, "utf8")).trim();
      if (!/^[1-9][0-9]{0,9}$/.test(value)) fail("invalid-service-lock");
      let alive = true;
      try { process.kill(Number(value), 0); }
      catch (error) { if (error.code === "ESRCH") alive = false; }
      if (alive) fail("data-directory-in-use");
      await fs.unlink(file);
    }
    try { return await fs.open(file, "wx", 0o600); }
    catch (error) { if (error.code === "EEXIST") fail("data-directory-in-use"); throw error; }
  } finally { await fs.rmdir(recovery); }
}

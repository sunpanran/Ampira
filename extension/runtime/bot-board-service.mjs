import { fetchBounded } from "../core/network.mjs";
import { hashText } from "../core/bookmarks.mjs";
import {
  BOT_CONNECTION_KEY, BOT_LOCAL_ORIGIN, BOT_OUTBOX_LIMIT,
  botActionAcknowledged, botConnectionId, botError, botFileUrl, createBotAction,
  normalizeBotConnection, normalizeBotModule, normalizeBotRunner,
} from "../core/bot-board.mjs";
import { botAnswersQuestions, botGeneratesBrief, botOrganizesNews, mcpIsEnabled } from "../core/bot-mode.mjs";

const REFRESH_INTERVAL_MS = 2 * 1000;
const DISPLAY_MODULES = Object.freeze(["today", "replies"]);

export function createBotBoardService({
  storage, getRecord, setRecord, getSettings, hasOriginPermission,
  capturePermissionEpoch, isPermissionEpochCurrent, cacheMutations,
  prepareMessage = async () => ({ data: {} }), validateMessage = async () => {},
  fetchContent = fetchBounded, now = () => new Date().toISOString(), uuid = () => crypto.randomUUID(),
}) {
  let queue = Promise.resolve();
  return { config, configure: (body) => enqueue(() => configure(body)), disconnect: () => enqueue(disconnect), read,
    syncSummaries: (body, cleanup = false) => enqueue(() => syncSummaries(body, cleanup)),
    syncBrief: (body, cleanup = false) => enqueue(() => syncTask("briefs.json", body, botGeneratesBrief, cleanup)),
    refresh: (body) => enqueue(() => refresh(body)), submit: (body) => enqueue(() => submit(body)) };

  function enqueue(action) {
    const result = queue.then(action);
    queue = result.catch(() => {});
    return result;
  }
  async function stored() {
    return (await storage.get(BOT_CONNECTION_KEY))[BOT_CONNECTION_KEY] || null;
  }
  async function config() {
    const saved = await stored();
    const settings = await getSettings();
    return { mcpEnabled: mcpIsEnabled(settings), botGenerateBrief: settings.botGenerateBrief !== false, botAnswerQuestions: settings.botAnswerQuestions !== false,
      botOrganizeNews: settings.botOrganizeNews === true, mode: settings.dashboardMode || "standard", connectionId: saved ? botConnectionId(saved) : "", connection: saved ? {
      ...normalizeBotConnection(saved), hasToken: Boolean(saved.token),
    } : null };
  }
  async function disconnect() {
    await storage.remove(BOT_CONNECTION_KEY);
    return config();
  }
  async function configure(body = {}) {
    const connection = normalizeBotConnection(body);
    if (!mcpIsEnabled(await getSettings())) throw botError("mcpDisabled");
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!token || token.length > 512 || /[\s\r\n]/.test(token)) throw botError("credentialRequired");
    if (body.consent !== true) throw botError("consentRequired");
    const epoch = capturePermissionEpoch();
    const cacheEpoch = cacheMutations.capture();
    if (!await hasOriginPermission(BOT_LOCAL_ORIGIN)) throw botError("permissionRequired");
    const health = await fetchJson(`${connection.endpoint}/health`, token);
    if (health.data?.app !== "ampira-local-mcp" || health.data.schemaVersion !== 1 || !health.data.boardId) throw botError("invalidData");
    const verified = normalizeBotConnection({ ...connection, boardId: health.data.boardId });
    if (!mcpIsEnabled(await getSettings())) throw botError("mcpDisabled");
    if (!cacheMutations.isCurrent(cacheEpoch)) throw botError("connectionChanged");
    if (!isPermissionEpochCurrent(epoch) || !await hasOriginPermission(BOT_LOCAL_ORIGIN)) throw botError("permissionRequired");
    await storage.set({ [BOT_CONNECTION_KEY]: { ...verified, token, revision: uuid() } });
    return config();
  }
  function keys(connection) {
    const suffix = hashText(botConnectionId(connection));
    return { cache: `bot-cache:${suffix}`, outbox: `bot-outbox:${suffix}` };
  }
  async function read() {
    const saved = await stored();
    const configuration = await config();
    if (!configuration.mcpEnabled || configuration.mode !== "bot" || !saved) return { ...configuration, modules: {}, outbox: [], errors: {}, checkedAt: "" };
    if (!await hasOriginPermission(BOT_LOCAL_ORIGIN)) return {
      ...configuration, modules: {}, outbox: [], errors: { connection: "permissionRequired" }, checkedAt: "",
    };
    const key = keys(saved);
    const [cache, outbox] = await Promise.all([getRecord(key.cache, {}), getRecord(key.outbox, [])]);
    const current = await stored();
    if (current?.revision !== saved.revision || !await hasOriginPermission(BOT_LOCAL_ORIGIN)) throw botError("connectionChanged");
    const currentSettings = await getSettings();
    if (mcpIsEnabled(currentSettings) !== configuration.mcpEnabled || currentSettings.dashboardMode !== configuration.mode
      || (currentSettings.botGenerateBrief !== false) !== configuration.botGenerateBrief
      || (currentSettings.botAnswerQuestions !== false) !== configuration.botAnswerQuestions) throw botError("connectionChanged");
    const pick = (values) => Object.fromEntries(Object.entries(values || {}).filter(([kind]) => displayModules(configuration).includes(kind)));
    return { ...configuration, modules: pick(cache.modules), errors: pick(cache.errors), runner: cache.runner || null, checkedAt: cache.checkedAt || "",
      outbox: outbox.filter((item) => configuration.botAnswerQuestions && item.action.type === "message")
        .map(({ evidence, ...item }) => ({ ...item, status: botActionAcknowledged(item.action, cache.modules) ? "answered" : item.status })) };
  }
  async function context() {
    const connection = await stored();
    if (!connection?.token) throw botError("credentialRequired");
    return { connection, permissionEpoch: capturePermissionEpoch(), cacheEpoch: cacheMutations.capture() };
  }
  async function assertCurrent(ctx) {
    if (!isPermissionEpochCurrent(ctx.permissionEpoch) || !cacheMutations.isCurrent(ctx.cacheEpoch)
      || (await stored())?.revision !== ctx.connection.revision) throw botError("connectionChanged");
    const settings = await getSettings();
    if (!mcpIsEnabled(settings)) throw botError("mcpDisabled");
    if (settings.dashboardMode !== "bot") throw botError("inactive");
    if (ctx.allowed && !ctx.allowed(settings)) throw botError("inactive");
    if (!await hasOriginPermission(BOT_LOCAL_ORIGIN)) throw botError("permissionRequired");
  }
  async function request(ctx, path, method = "GET", body, validator = "") {
    await assertCurrent(ctx);
    const result = await fetchJson(botFileUrl(ctx.connection, path), ctx.connection.token, method, body, validator);
    await assertCurrent(ctx);
    if (result.boardId !== ctx.connection.boardId) throw botError("connectionChanged");
    return result;
  }
  async function fetchJson(url, token, method = "GET", body, validator = "", timeoutMs = 15000) {
    const { response, buffer } = await fetchContent(url, {
      method, redirect: "error", credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store",
      headers: { Accept: "application/json", Authorization: `Bearer ${token}`,
        ...(validator ? { "If-None-Match": validator } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }, { timeoutMs, maxBytes: 1024 * 1024 });
    const boardId = response.headers?.get?.("x-ampira-board") || "";
    if (response.status === 304 && validator) return { notModified: true, etag: validator, boardId };
    if (response.status === 404) throw botError("missingFile");
    if (response.status === 401 || response.status === 403) throw botError("accessDenied");
    if (response.status === 429) throw botError("rateLimited");
    if (response.status === 507) throw botError("storageFull");
    if (!response.ok) throw botError(response.status === 409 || response.status === 422 ? "conflict" : "networkFailed");
    try { return { data: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer)), etag: response.headers?.get?.("etag") || "", boardId }; } catch { throw botError("invalidData"); }
  }
  async function persist(ctx, key, value, kind) {
    await assertCurrent(ctx);
    await cacheMutations.run(async () => { await assertCurrent(ctx); await setRecord(key, value, kind); });
  }
  async function syncSummaries(body, cleanup) {
    return syncTask("summaries.json", body, botOrganizesNews, cleanup);
  }
  async function syncTask(path, body, allowed, cleanup) {
    const ctx = await context();
    if (cleanup) {
      if ((body.requests || []).length || (body.resultIds || []).length || body.request) throw botError("invalidData");
      if (!await hasOriginPermission(BOT_LOCAL_ORIGIN)) throw botError("permissionRequired");
    } else {
      await assertCurrent(ctx);
      if (!allowed(await getSettings())) throw botError("inactive");
    }
    let result;
    try { result = await fetchJson(botFileUrl(ctx.connection, path), ctx.connection.token, "POST", body, "", 3000); }
    catch (error) { if (error.code === "missingFile") throw botError("serviceUpdateRequired"); throw error; }
    if ((await stored())?.revision !== ctx.connection.revision || !isPermissionEpochCurrent(ctx.permissionEpoch)
      || !await hasOriginPermission(BOT_LOCAL_ORIGIN) || result.boardId !== ctx.connection.boardId) throw botError("connectionChanged");
    if (!cleanup) {
      await assertCurrent(ctx);
      if (!allowed(await getSettings())) throw botError("inactive");
    }
    return result.data;
  }
  async function refresh(body = {}) {
    const ctx = await context();
    await assertCurrent(ctx);
    const key = keys(ctx.connection);
    const previous = await getRecord(key.cache, {});
    if (!body.force && Date.parse(now()) - Date.parse(previous.checkedAt || "") < REFRESH_INTERVAL_MS) return read();
    const modules = { ...previous.modules };
    const validators = { ...previous.validators };
    const errors = {};
    for (const kind of displayModules(await config())) {
      try {
        const result = await request(ctx, `${kind}.json`, "GET", undefined, modules[kind] ? validators[kind] || "" : "");
        if (result.notModified) continue;
        const module = normalizeBotModule(kind, result.data);
        if (modules[kind] && Date.parse(module.updatedAt) < Date.parse(modules[kind].updatedAt)) throw botError("olderData");
        modules[kind] = module;
        validators[kind] = result.etag;
      } catch (error) {
        if (["connectionChanged", "permissionRequired", "inactive", "mcpDisabled"].includes(error.code)) throw error;
        errors[kind] = publicCode(error);
      }
    }
    let runner;
    try { runner = normalizeBotRunner((await request(ctx, "runner.json")).data); }
    catch (error) {
      if (["connectionChanged", "permissionRequired", "inactive", "mcpDisabled"].includes(error.code)) throw error;
      runner = error.code === "missingFile" ? { mode: "manual", status: "idle" } : { mode: "codex", status: "failed", error: "unavailable" };
    }
    await persist(ctx, key.cache, { modules, validators, errors, runner, checkedAt: now() }, "cache");
    return read();
  }
  async function submit(body = {}) {
    const ctx = { ...await context(), allowed: botAnswersQuestions };
    await assertCurrent(ctx);
    if (body.connectionId !== botConnectionId(ctx.connection)) throw botError("connectionChanged");
    const key = keys(ctx.connection);
    let outbox = await getRecord(key.outbox, []);
    let item = body.retryId ? outbox.find((entry) => entry.action.id === body.retryId) : null;
    if (body.retryId && !item) throw botError("invalidData");
    const actionType = item?.action?.type || body.type;
    if (actionType !== "message") throw botError("invalidData");
    if (item?.status === "sent") {
      if (body.retryId) await request(ctx, "runner.json", "POST", { retry: true });
      return refresh({ force: true });
    }
    if (!item) {
      if (outbox.length >= BOT_OUTBOX_LIMIT) {
        const cache = await getRecord(key.cache, {});
        outbox = outbox.filter((entry) => !botActionAcknowledged(entry.action, cache.modules));
      }
      if (outbox.length >= BOT_OUTBOX_LIMIT) throw botError("outboxFull");
      const action = createBotAction(body, { id: uuid(), now: now() });
      const prepared = await prepareMessage(action, await getSettings());
      await assertCurrent(ctx);
      item = { action: createBotAction({ ...action, ...prepared.data }, { id: action.id, now: action.createdAt }), evidence: prepared.evidence, status: "sending", error: "" };
      outbox.push(item);
    } else item.status = "sending";
    await persist(ctx, key.outbox, outbox, "state");
    try {
      await validateMessage(item.evidence);
      const path = `inbox/${item.action.id}.json`;
      // A retry checks the original operation ID after an ambiguous network failure.
      let existing = null;
      try { existing = (await request(ctx, path)).data; }
      catch (error) { if (error.code !== "missingFile") throw error; }
      if (existing && JSON.stringify(existing) !== JSON.stringify(item.action)) throw botError("conflict");
      if (!existing) {
        await request(ctx, path, "PUT", item.action);
      }
      item.status = "sent";
      item.error = "";
    } catch (error) {
      if (["connectionChanged", "permissionRequired", "inactive", "mcpDisabled"].includes(error.code)) throw error;
      item.status = "failed";
      item.error = publicCode(error);
    }
    await persist(ctx, key.outbox, outbox, "state");
    return item.status === "sent" ? refresh({ force: true }) : read();
  }
}

function displayModules(configuration) {
  return DISPLAY_MODULES.filter(kind => kind === "today" ? configuration.botGenerateBrief : configuration.botAnswerQuestions);
}

function publicCode(error) {
  return ["missingFile", "accessDenied", "rateLimited", "conflict", "invalidData", "olderData", "storageFull"].includes(error?.code)
    ? error.code : "networkFailed";
}

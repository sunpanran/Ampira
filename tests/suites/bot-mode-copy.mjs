import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createBotModeController } from "../../assets/client/bot-mode-controller.mjs";
import { messageRequestForHttp } from "../../assets/client/message-contract.mjs";
import { diffSettingsDraft } from "../../assets/client/settings-draft.mjs";

const disabledBlur = { headerImageBlurEnabled: false, headerImageBlurAmount: 12, pointerGlowEnabled: false };
assert.deepEqual(diffSettingsDraft({ ...disabledBlur, headerImageBlurAmount: 0 }, disabledBlur), {}, "an inactive remembered blur amount must not expose Save or trigger a close prompt");
assert.deepEqual(diffSettingsDraft({ ...disabledBlur, headerImageBlurAmount: 0, pointerGlowEnabled: true }, disabledBlur), { pointerGlowEnabled: true }, "real drafts on other pages must still expose Save");
assert.deepEqual(diffSettingsDraft({ ...disabledBlur, headerImageBlurEnabled: true, headerImageBlurAmount: 18 }, disabledBlur), { headerImageBlurEnabled: true, headerImageBlurAmount: 18 });
assert.deepEqual(diffSettingsDraft({ headerImageBlurEnabled: false, headerImageBlurAmount: 0 }, { headerImageBlurEnabled: true, headerImageBlurAmount: 18 }), { headerImageBlurEnabled: false, headerImageBlurAmount: 0 });

const globals = ["document", "window", "navigator", "location", "CustomEvent", "chrome", "setInterval", "clearInterval"];
const saved = globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
const nodes = new Map(), windowEvents = new Map();
const byId = id => {
  if (!nodes.has(id)) nodes.set(id, { id, dataset: {}, checked: false, hidden: false, textContent: "", disabled: false, events: new Map(),
    addEventListener(type, callback) { this.events.set(type, callback); }, focus() { documentStub.activeElement = this; },
    getClientRects() { return this.hidden ? [] : [{}]; },
    getAttribute(name) { if (!name.startsWith("data-")) return this[name] ?? null; return this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] ?? null; },
    setAttribute(name, value) { this[name] = value; },
  });
  return nodes.get(id);
};
const documentStub = { hidden: false, documentElement: { dataset: {} }, addEventListener() {}, dispatchEvent() {}, getElementById: byId,
  querySelectorAll(selector) {
    const match = /^\[(data-i18n(?:-[a-z-]+)?)\]$/.exec(selector);
    return match ? [...nodes.values()].filter(node => node.getAttribute(match[1]) !== null) : [];
  } };
const define = (key, value) => Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
try {
  let tick, granted = false, clipboardFails = false, unsupported = false, pairingResponse = { status: "waiting" };
  const posts = [], copied = [], permissions = [];
  let configuration = { mcpEnabled: false, mode: "standard", botOrganizeNews: false, connection: null };
  let configurationRead = null;
  const connection = { endpoint: "http://127.0.0.1:43123", boardId: "synthetic-board", hasToken: true };
  define("document", documentStub); define("window", { addEventListener: (type, callback) => windowEvents.set(type, callback) });
  define("navigator", { languages: ["zh-CN"], language: "zh-CN", clipboard: { writeText: async text => { if (clipboardFails) throw new Error("Synthetic clipboard denial"); copied.push(text); } } });
  define("location", { protocol: "file:" });
  define("CustomEvent", class { constructor(type, options) { this.type = type; this.detail = options?.detail; } });
  define("chrome", { permissions: { request: async value => { permissions.push(value); return granted; } } });
  define("setInterval", callback => { tick = callback; return 1; }); define("clearInterval", () => {});
  const i18n = await import(`../../assets/client/i18n.mjs?mcp-menu=${Date.now()}`);
  const controller = createBotModeController({ state: { data: {} }, t: i18n.t, loadDashboard: async () => {},
    apiGet: async () => configurationRead || structuredClone(configuration), apiPost: async (url, body) => {
      posts.push({ url, body });
      if (unsupported && url === "/api/mcp/enabled") throw { code: "UNKNOWN_REQUEST", messageKey: "background.error.unknownRequest", messageParams: { type: "mcp:enabled" } };
      if (url === "/api/mcp/enabled") configuration.mcpEnabled = body.enabled;
      if (url === "/api/bot/mode") configuration.mode = body.mode;
      if (url === "/api/bot/organization") configuration.botOrganizeNews = body.enabled;
      if (url === "/api/bot/takeover") configuration[body.scope === "brief" ? "botGenerateBrief" : body.scope === "news" ? "botOrganizeNews" : "botAnswerQuestions"] = body.enabled;
      if (url === "/api/bot/disconnect") configuration.connection = null;
      if (url === "/api/mcp/setup") return { command: "node integrations/local-mcp/connect.mjs --code synthetic-one-time-code" };
      if (url === "/api/mcp/pair") return pairingResponse;
      return structuredClone(configuration);
    },
  });
  await controller.start();
  assert(byId("mcpFeatures").hidden);
  for (const id of ["botScopesSave", "botCopyInstructions", "botEndpoint", "botToken", "botConnectionSave", "botScope-news"]) assert(!nodes.has(id), `controller must not require retired control ${id}`);
  assert.equal(messageRequestForHttp("POST", "/api/bot/scopes").request, null);
  assert.equal(messageRequestForHttp("POST", "/api/bot/config").request, null, "the removed manual pairing form must have no writable route");
  assert.equal(messageRequestForHttp("POST", "/api/bot/disconnect").request.type, "bot:disconnect");
  byId("mcpEnabledToggle").checked = true;
  await byId("mcpEnabledToggle").events.get("change")();
  assert.equal(posts.length, 0); assert.equal(byId("mcpEnabledToggle").checked, false);
  assert.equal(byId("mcpMasterStatus").textContent, i18n.t("background.bot.permissionRequired"));
  granted = true; byId("mcpEnabledToggle").checked = true;
  await byId("mcpEnabledToggle").events.get("change")();
  assert(!byId("mcpFeatures").hidden); assert(!byId("botModeToggle").checked);
  byId("botModeToggle").checked = true; await byId("botModeToggle").events.get("change")();
  byId("botOrganizationToggle").checked = true; documentStub.activeElement = byId("botOrganizationToggle");
  await byId("botOrganizationToggle").events.get("change")();
  assert.equal(configuration.botOrganizeNews, true); assert.equal(documentStub.activeElement.id, "botOrganizationToggle");
  assert(byId("botBriefToggle").checked && byId("botQuestionsToggle").checked, "existing brief and chat ownership stays selected");
  for (const [id, field] of [["botBriefToggle", "botGenerateBrief"], ["botQuestionsToggle", "botAnswerQuestions"]]) {
    byId(id).checked = false; documentStub.activeElement = byId(id);
    await byId(id).events.get("change")();
    assert.equal(configuration[field], false); assert.equal(documentStub.activeElement.id, id);
  }
  assert.equal(configuration.botOrganizeNews, true, "changing another checkbox preserves news ownership");
  assert.equal(messageRequestForHttp("POST", "/api/bot/takeover").request.type, "bot:takeover");
  const beforeCopy = permissions.length;
  await byId("mcpCopySetup").events.get("click")();
  assert.equal(permissions.length, beforeCopy + 1, "the copy gesture can recover a revoked local permission");
  assert(permissions.every(value => JSON.stringify(value.origins) === JSON.stringify(["http://127.0.0.1/*"])));
  assert(copied[0].includes("synthetic-one-time-code") && copied[0].includes("mcpServer"), "copied setup instructions retain the pairing command and client configuration step");
  await tick();
  assert.equal(byId("mcpConnectionState").textContent, i18n.t("mcp.pairing"));
  configuration.connection = connection;
  pairingResponse = { status: "connected", configuration: structuredClone(configuration) };
  await tick();
  assert.equal(byId("mcpConnectionAddress").textContent, connection.endpoint);
  assert(!byId("mcpConnectionDetails").hidden);
  assert.equal(byId("mcpSetupStatus").textContent, i18n.t("mcp.pairSuccess"));
  byId("mcpEnabledToggle").checked = false; await byId("mcpEnabledToggle").events.get("change")();
  assert(!byId("mcpConnectionDetails").hidden, "disconnect remains available while the master switch is off");
  await byId("botConnectionRemove").events.get("click")();
  assert(byId("mcpConnectionDetails").hidden); assert.equal(configuration.mode, "bot"); assert.equal(configuration.botOrganizeNews, true);
  assert.equal(documentStub.activeElement.id, "mcpEnabledToggle");
  byId("mcpEnabledToggle").checked = true; await byId("mcpEnabledToggle").events.get("change")();
  clipboardFails = true; await byId("mcpCopySetup").events.get("click")();
  assert.equal(byId("mcpSetupStatus").textContent, i18n.t("bot.copyFailed"));
  clipboardFails = false; await byId("mcpCopySetup").events.get("click")();
  pairingResponse = { status: "expired" }; await tick();
  assert.equal(byId("mcpSetupStatus").textContent, i18n.t("mcp.expired"));
  await byId("mcpCopySetup").events.get("click")();
  let resolvePair;
  pairingResponse = new Promise(resolve => { resolvePair = resolve; });
  const poll = tick();
  byId("mcpEnabledToggle").checked = false; await byId("mcpEnabledToggle").events.get("change")();
  resolvePair({ status: "connected", configuration: { ...configuration, mcpEnabled: true, connection } }); await poll;
  assert(!byId("mcpEnabledToggle").checked, "a late pairing response cannot turn MCP back on");
  let resolveConfiguration;
  const oldConfiguration = structuredClone(configuration);
  configurationRead = new Promise(resolve => { resolveConfiguration = resolve; });
  const backgroundUpdate = windowEvents.get("ampira:runtime-message")({ detail: { type: "settings.changed", payload: { mcpSettingsChanged: true } } });
  byId("mcpEnabledToggle").checked = true; await byId("mcpEnabledToggle").events.get("change")();
  resolveConfiguration(oldConfiguration); await backgroundUpdate; configurationRead = null;
  assert(byId("mcpEnabledToggle").checked, "a late background settings read must not overwrite a newer user choice");
  unsupported = true; byId("mcpEnabledToggle").checked = true;
  await byId("mcpEnabledToggle").events.get("change")();
  for (const locale of ["en", "zh-Hant", "zh-CN"]) {
    await i18n.prepareLocale(locale); i18n.setLocale(locale, { persist: false });
    assert.equal(byId("mcpMasterStatus").textContent, i18n.t("mcp.reloadRequired"));
  }
  const html = await fs.readFile(new URL("../../dashboard.html", import.meta.url), "utf8");
  const panel = html.slice(html.indexOf('data-settings-panel="bot"'), html.indexOf('data-settings-panel="cache"'));
  assert.equal((panel.match(/type="checkbox"/g) || []).length, 5, "two master switches and three independent takeover choices");
  assert(panel.includes('class="settings-sync-options mcp-takeover-options"'), "takeover choices reuse the compact checkbox row");
  assert(!/type="password"|botScope-|botScopesSave|botCopyInstructions|botConnectionSave/.test(panel));
} finally {
  windowEvents.get("pagehide")?.();
  for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
}
console.log("MCP menu and pairing flow tests passed");

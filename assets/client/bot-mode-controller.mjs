import { requestOrigins } from "./permission-client.mjs";
import { botBoardRefreshInterval } from "./bot-runner-status.mjs";

export function createBotModeController({ state, request, t, loadDashboard }) {
  const byId = id => document.getElementById(id);
  let configuration = null, running = false, refreshing = false, pairing = false, pollingPair = false;
  let timer, generation = 0, refreshedAt = 0;
  const enabled = () => configuration?.mcpEnabled === true;
  return { start };

  async function start() {
    byId("mcpEnabledToggle").addEventListener("change", () => {
      const checked = byId("mcpEnabledToggle").checked;
      const permission = checked ? requestOrigins(["http://127.0.0.1/*"]).catch(() => false) : Promise.resolve(true);
      return changeSetting("mcp:enabled", { enabled: checked }, permission);
    });
    byId("botModeToggle").addEventListener("change", () => changeSetting("bot:mode", { mode: byId("botModeToggle").checked ? "bot" : "standard" }));
    for (const [id, scope] of [["botBriefToggle", "brief"], ["botOrganizationToggle", "news"], ["botQuestionsToggle", "questions"]]) {
      byId(id).addEventListener("change", () => changeSetting("bot:takeover", { scope, enabled: byId(id).checked }));
    }
    byId("mcpCopySetup").addEventListener("click", copySetup);
    byId("botConnectionRemove").addEventListener("click", disconnect);
    window.addEventListener("ampira:runtime-message", async event => {
      if (running || event.detail?.type !== "settings.changed" || !event.detail.payload?.mcpSettingsChanged) return;
      const current = ++generation;
      try {
        const result = await request({ type: "bot:config" });
        if (current !== generation) return;
        configuration = result; if (!enabled()) pairing = false; fill(); await loadDashboard();
      } catch (error) { if (current === generation) report(error); }
    });
    window.addEventListener("ampira:bot-action", () => { void loadDashboard(); });
    document.addEventListener("visibilitychange", () => { if (!document.hidden) void tick(); });
    window.addEventListener("pagehide", () => { clearInterval(timer); generation++; });
    const initialGeneration = ++generation;
    try {
      const result = await request({ type: "bot:config" });
      if (initialGeneration === generation) { configuration = result; fill(); }
    } catch (error) { if (initialGeneration === generation) report(error); }
    timer = setInterval(tick, 2000);
    void refresh();
  }
  function fill() {
    const connection = configuration?.connection;
    byId("mcpEnabledToggle").checked = enabled();
    byId("mcpFeatures").hidden = !enabled();
    byId("botModeToggle").checked = configuration?.mode === "bot";
    byId("botModeOptions").hidden = configuration?.mode !== "bot";
    byId("botOrganizationToggle").checked = configuration?.botOrganizeNews === true;
    byId("botBriefToggle").checked = configuration?.botGenerateBrief !== false;
    byId("botQuestionsToggle").checked = configuration?.botAnswerQuestions !== false;
    byId("mcpConnectionDetails").hidden = !connection;
    byId("mcpConnectionAddress").textContent = connection?.endpoint || "";
    byId("botConnectionRemove").disabled = !connection;
    byId("mcpConnectionState").dataset.state = pairing ? "pairing" : connection ? "paired" : "unpaired";
    status("mcpConnectionState", pairing ? "mcp.pairing" : connection ? "mcp.paired" : "mcp.unpaired");
    status("mcpConnectionHelp", connection ? "" : "mcp.quickHelp");
    byId("mcpConnectionHelp").hidden = Boolean(connection);
    status("mcpMasterStatus", "");
    status("botOrganizationStatus", "");
  }
  async function changeSetting(type, body, permission = Promise.resolve(true)) {
    if (running) return;
    const focusId = document.activeElement?.id;
    busy(true); generation++;
    try {
      if (!await permission) throw { messageKey: "background.bot.permissionRequired" };
      configuration = await request({ type, payload: body });
      if (!enabled()) { pairing = false; status("mcpSetupStatus", ""); }
      fill(); await loadDashboard();
    } catch (error) { fill(); report(error); }
    finally { busy(false); if (focusId) byId(focusId)?.focus?.({ preventScroll: true }); }
  }
  async function copySetup() {
    if (running || !enabled()) return;
    const permission = requestOrigins(["http://127.0.0.1/*"]).catch(() => false);
    busy(true); generation++; pairing = false;
    status("mcpSetupStatus", "mcp.copying");
    try {
      if (!await permission) throw { messageKey: "background.bot.permissionRequired" };
      const setup = await request({ type: "mcp:setup", payload: {} });
      await navigator.clipboard.writeText(t("mcp.setupPrompt", { command: setup.command })).catch(() => { throw { messageKey: "bot.copyFailed" }; });
      pairing = true; fill(); status("mcpSetupStatus", "mcp.waiting");
    } catch (error) { report(error, "mcpSetupStatus"); }
    finally { busy(false); byId("mcpCopySetup").focus?.({ preventScroll: true }); }
  }
  async function disconnect() {
    if (running || !configuration?.connection) return;
    busy(true); generation++; pairing = false;
    try {
      configuration = await request({ type: "bot:disconnect", payload: {} });
      fill(); status("mcpSetupStatus", ""); await loadDashboard();
    } catch (error) { report(error); }
    finally { busy(false); byId(enabled() ? "mcpCopySetup" : "mcpEnabledToggle").focus?.({ preventScroll: true }); }
  }
  async function tick() {
    if (running || document.hidden || !enabled()) return;
    if (pairing && !pollingPair && byId("mcpFeatures").getClientRects().length) {
      const current = generation; pollingPair = true;
      try {
        const result = await request({ type: "mcp:pair", payload: {} });
        if (current !== generation || !enabled()) return;
        if (result.status === "connected") {
          pairing = false; configuration = result.configuration;
          fill(); status("mcpSetupStatus", ""); await loadDashboard();
        } else if (["expired", "cancelled", "idle"].includes(result.status)) {
          pairing = false; fill(); status("mcpSetupStatus", "mcp.expired");
        }
      } catch (error) { if (current === generation) report(error, "mcpSetupStatus"); }
      finally { pollingPair = false; }
    }
    void refresh();
  }
  async function refresh() {
    if (running || refreshing || document.hidden || !enabled() || configuration?.mode !== "bot" || !configuration?.connection
      || Date.now() - refreshedAt < botBoardRefreshInterval(state.data?.bot)) return;
    refreshedAt = Date.now(); refreshing = true;
    const current = generation;
    try {
      const board = await request({ type: "bot:refresh", payload: {} });
      if (current !== generation || !enabled()) return;
      if (state.data) state.data.bot = board;
      status("botOrganizationStatus", configuration.botOrganizeNews ? board.organization?.errorKey || (board.organization?.unavailable ? "background.bot.networkFailed"
        : board.organization?.failed ? "bot.organization.failed" : board.organization?.pending ? "bot.organization.waiting" : "") : "");
      await loadDashboard();
      if (current === generation && enabled()) document.dispatchEvent(new CustomEvent("ampira:bot-board-updated", { detail: board }));
    } catch (error) { if (current === generation) report(error); }
    finally { refreshing = false; }
  }
  function busy(value) {
    running = value;
    for (const control of document.querySelectorAll('[data-settings-panel="bot"] input, [data-settings-panel="bot"] button')) control.disabled = value;
    if (!value) byId("botConnectionRemove").disabled = !configuration?.connection;
  }
  function status(id, key) { byId(id).dataset.i18n = key; byId(id).textContent = key ? t(key) : ""; }
  function report(error, id = "mcpMasterStatus") {
    const key = error?.code === "UNKNOWN_REQUEST" || error?.messageKey === "background.error.unknownRequest" ? "mcp.reloadRequired" : error?.messageKey || "background.bot.networkFailed";
    status(id, key);
  }
}

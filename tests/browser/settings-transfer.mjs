import { createSettingsTransferController } from "../../assets/client/settings-transfer-controller.mjs";
import { createConfirmationDialogController } from "../../assets/client/confirmation-dialog.mjs";
import { createSettingsTransferDocument, parseSettingsTransferDocument } from "../../extension/core/settings-transfer.mjs";
import { DEFAULT_SETTINGS } from "../../extension/core/constants.mjs";
import { getElementGroups } from "../../assets/client/elements.mjs";
import { hydrateIcons } from "../../assets/client/icons.mjs";
import zhCN from "../../assets/client/locales/zh-CN.mjs";
import en from "../../assets/client/locales/en.mjs";
import zhHant from "../../assets/client/locales/zh-Hant.mjs";

const base = document.createElement("base");
base.href = new URL("../../", import.meta.url).href;
document.head.append(base);
const markup = new DOMParser().parseFromString(await (await fetch(new URL("../../dashboard.html", import.meta.url))).text(), "text/html");
for (const id of ["settingsModal", "confirmationDialog"]) document.body.append(document.importNode(markup.getElementById(id), true));
const els = Object.assign({}, ...Object.values(getElementGroups()));
let locale = "zh-CN", allowed = true, busy = false, aiConsent = false;
let importedCount = 0, authorizationCount = 0, downloadedCount = 0;
let followupMode = "", reconciliations = 0;
let bookmarkConsent = false, bookmarkDomainCount = 0;
const grantedOrigins = new Set(), grantedPermissions = new Set();
const permissionCalls = [];
const catalogs = { "zh-CN": zhCN, en, "zh-Hant": zhHant };
const t = (key, params = {}) => String(catalogs[locale][key] || key).replace(/\{(\w+)\}/g, (match, name) => params[name] ?? match);
const state = { settings: { ...DEFAULT_SETTINGS, uiLocale: locale } };
const fixture = createSettingsTransferDocument({ ...state.settings, openaiBaseUrl: "https://ai.example/v1", bookmarkConsentGranted: true }, {
  credentials: { openaiApiKey: "synthetic-browser-ai", braveSearchApiKey: "synthetic-browser-brave" },
  permissions: { permissions: ["favicon", "search", "history"], origins: ["https://feeds.example/*"] },
});
const confirmation = createConfirmationDialogController({
  dialog: els.confirmationDialog, kicker: els.confirmationKicker, title: els.confirmationTitle, body: els.confirmationBody,
  cancelButton: els.confirmationCancel, confirmButton: els.confirmationConfirm,
});
globalThis.chrome ||= {};
chrome.permissions = { request: details => {
  permissionCalls.push({ ...details, userGesture: navigator.userActivation.isActive });
  if (allowed === "error") return Promise.reject(new Error("Synthetic permission rejection"));
  if (allowed === true) {
    details.origins?.forEach(origin => grantedOrigins.add(origin));
    details.permissions?.forEach(permission => grantedPermissions.add(permission));
  }
  return Promise.resolve(allowed === true || allowed === "not-applied");
}, contains: async details => (details.origins || []).every(origin => grantedOrigins.has(origin))
  && (details.permissions || []).every(permission => grantedPermissions.has(permission)) };
const permissionRows = () => bookmarkConsent ? Array.from({ length: bookmarkDomainCount }, (_, index) => {
  const origin = `https://bookmark-${index}.example/*`;
  return { origin, granted: grantedOrigins.has(origin) };
}) : [];
const renderSettingsStatus = text => { els.settingsStatus.textContent = text; els.settingsStatus.dataset.state = "pending"; };
const controller = createSettingsTransferController({
  els, state, t, confirmAction: confirmation.confirmAction, localizedErrorMessage: error => error.message,
  renderSettingsStatus,
  request: async message => {
    if (message.type === "settings:export") { downloadedCount++; return fixture; }
    if (message.type === "settings:get") return { ...state.settings, credentialGeneration: importedCount,
      aiDisclosureAccepted: aiConsent, bookmarkConsentGranted: bookmarkConsent, sourcePermissions: permissionRows() };
    if (message.type === "settings:import") {
      const transfer = parseSettingsTransferDocument(message.payload.config, state.settings);
      importedCount++;
      aiConsent = false;
      state.settings = { ...state.settings, ...transfer.patch };
      if (typeof transfer.syncAiSettingsEnabled === "boolean") {
        if (!message.payload.restoreCredentialSync) throw new Error("Sync restoration was not confirmed");
        state.settings.syncAiSettingsEnabled = transfer.syncAiSettingsEnabled;
      }
      return { ...state.settings, committed: true, postCommit: { status: followupMode ? "pending" : "complete" }, importedFieldCount: transfer.fieldCount, importAuthorization: {
        origins: [...new Set([...transfer.permissions.origins, "https://ai.example/*", "https://api.search.brave.com/*"])],
        permissions: transfer.permissions.permissions, bookmarkConsent: transfer.permissions.bookmarkConsent,
        aiProvider: { openaiBaseUrl: state.settings.openaiBaseUrl, openaiApiStyle: state.settings.openaiApiStyle,
          openaiSummaryModel: state.settings.openaiSummaryModel, credentialGeneration: importedCount },
      } };
    }
    if (message.type === "onboarding:consent") { bookmarkConsent = true; return { sourcePermissions: permissionRows() }; }
    if (message.type === "settings:reconcile-import") {
      reconciliations++;
      return { ...state.settings, postCommit: { status: followupMode === "persistent" ? "pending" : "complete" } };
    }
    if (message.type === "permissions:origins") return permissionRows();
    if (message.type === "settings:authorize-import") { authorizationCount++; aiConsent = true; return {}; }
    throw new Error(`Unexpected fixture request: ${message.type}`);
  },
  runSettingsAction: async action => {
    busy = true;
    els.importSettings.disabled = els.exportSettings.disabled = true;
    try { return await action(() => true); } finally { busy = false; els.importSettings.disabled = els.exportSettings.disabled = false; }
  },
  loadSettings: async () => true, captureSettingsSnapshot() {}, resetSecretDrafts() {},
  prepareLocale: async () => {}, applyUiLocale() {}, getLocale: () => locale,
  inspirationPreviews: { invalidate() {} }, loadDashboard: async () => {}, triggerRefresh: async () => {},
});
els.exportSettings.addEventListener("click", controller.exportSettings);
els.importSettings.addEventListener("click", () => els.settingsImportFile.click());
els.settingsImportFile.addEventListener("change", controller.importSettingsFile);
els.settingsModal.classList.add("open");
els.settingsForm.querySelectorAll("[data-settings-panel]").forEach(panel => panel.classList.toggle("active", panel.dataset.settingsPanel === "about"));
els.settingsModal.querySelectorAll("[data-settings-tab]").forEach(tab => {
  tab.classList.toggle("active", tab.dataset.settingsTab === "about");
  tab.setAttribute("aria-selected", String(tab.dataset.settingsTab === "about"));
});
hydrateIcons();
globalThis.transferQa = {
  locale(value) {
    locale = value;
    document.documentElement.lang = value;
    document.querySelectorAll("[data-i18n]").forEach(node => { node.textContent = t(node.dataset.i18n); });
  },
  allow(value) { allowed = value; },
  revoke(origin, permission) { if (origin) grantedOrigins.delete(origin); if (permission) grantedPermissions.delete(permission); },
  get result() { return { importedCount, authorizationCount, downloadedCount, permissionCalls, busy, aiConsent,
    reconciliations, syncAiSettingsEnabled: state.settings.syncAiSettingsEnabled, bookmarkDomains: permissionRows() }; },
  async begin({ long = false, bookmarks = 0, sync, followup = "" } = {}) {
    followupMode = followup;
    bookmarkConsent = false;
    bookmarkDomainCount = bookmarks;
    grantedOrigins.clear(); grantedPermissions.clear();
    const config = structuredClone(fixture);
    config.settings.uiLocale = locale;
    if (typeof sync === "boolean") config.syncAiSettingsEnabled = sync;
    if (long) config.permissions.origins = Array.from({ length: 75 }, (_, index) => `https://source-${index}.example/*`);
    const file = new File([JSON.stringify(config)], "synthetic-settings.json", { type: "application/json" });
    els.importSettings.focus();
    return controller.importSettingsFile({ currentTarget: { files: [file], value: "selected" } });
  },
};
transferQa.locale(locale);
document.documentElement.dataset.ready = "true";

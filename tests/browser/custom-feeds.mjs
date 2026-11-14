import { createCustomFeedSettings } from "../../assets/client/custom-feed-settings.mjs";
import { getElementGroups } from "../../assets/client/elements.mjs";
import { hydrateIcons } from "../../assets/client/icons.mjs";
import { createCustomFeedService } from "../../extension/runtime/custom-feed-service.mjs";
import { createPermissionEpoch } from "../../extension/runtime/permission-epoch.mjs";
import { originPattern } from "../../extension/core/permission-state.mjs";
import { typedError } from "../../extension/runtime/runtime-result.mjs";
import zhCN from "../../assets/client/locales/zh-CN.mjs";
import en from "../../assets/client/locales/en.mjs";
import zhHant from "../../assets/client/locales/zh-Hant.mjs";

const base = document.createElement("base");
base.href = new URL("../../", import.meta.url).href;
document.head.append(base);
const markup = new DOMParser().parseFromString(await (await fetch(new URL("../../dashboard.html", import.meta.url))).text(), "text/html");
document.body.append(document.importNode(markup.getElementById("settingsModal"), true));
hydrateIcons();
const els = Object.assign({}, ...Object.values(getElementGroups()));
const state = { settings: { customFeeds: [] }, data: { sourceQuality: { records: {} } } };
const permissionEpoch = createPermissionEpoch(), granted = new Set(), calls = [];
let allowed = true, active = true, locale = "zh-CN";
const catalogs = { "zh-CN": zhCN, en, "zh-Hant": zhHant };
const t = (key, params = {}) => String(catalogs[locale][key] || key).replace(/\{(\w+)\}/g, (match, name) => params[name] ?? match);
const status = (text = "", statusName) => {
  els.settingsStatus.dataset.state = statusName === "ready" ? "ready" : "pending";
  els.settingsStatus.textContent = statusName === "ready" ? "" : text || (state.settings.customFeeds.length ? t("settings.status.unsaved") : "");
};
globalThis.chrome ||= {};
chrome.permissions = { request: async ({ origins }) => {
  calls.push({ type: "permission", origins });
  if (allowed) origins.forEach(origin => granted.add(origin));
  return allowed;
} };
const assertGranted = async url => {
  if (!granted.has(originPattern(url))) throw typedError("ORIGIN_PERMISSION_REQUIRED", "background.error.sourcePermission");
};
const service = createCustomFeedService({
  sourceFetchOptions: limit => ({ limit, validateUrl: assertGranted, validateResponse: response => assertGranted(response.url) }),
  hasOriginPermission: async url => granted.has(originPattern(url)), permissionEpoch,
});
const controller = createCustomFeedSettings({
  state, els, t, renderSettingsStatus: status,
  localizedErrorMessage: error => error.messageKey ? t(error.messageKey, error.messageParams) : error.message,
  request: async message => {
    calls.push(message);
    if (message.type === "feeds:preview") return service.preview(message.payload);
    if (message.type === "settings:get") return state.settings;
    throw new Error(`Unexpected fixture request: ${message.type}`);
  },
  runSettingsAction: async action => {
    controller.setBusy(true);
    try { await action(() => active); } finally { controller.setBusy(false); }
  },
});
els.settingsModal.classList.add("open");
els.settingsForm.querySelectorAll("[data-settings-panel]").forEach(panel => panel.classList.toggle("active", panel.dataset.settingsPanel === "bookmarks"));
els.customFeedUrl.closest("details").open = true;
els.settingsForm.scrollTop = 150;
controller.reset();
status("", "ready");
globalThis.rssQa = {
  state, calls, controller,
  permission(value) { allowed = value; },
  revoke() { granted.clear(); permissionEpoch.next(); },
  close() { active = false; controller.reset(); },
  reopen() { active = true; controller.reset(); status("", "ready"); },
  locale(value) {
    locale = value;
    document.querySelectorAll("[data-i18n]").forEach(node => { node.textContent = t(node.dataset.i18n); });
    controller.render();
  },
};
document.documentElement.dataset.ready = "true";

import { sendExtensionRequest } from "./api.mjs";
import { createHistoryPermissionController } from "./history-permission-controller.mjs";
import { getLocale, prepareLocale, setLocale, t, tc, translateDocument } from "./i18n.mjs";
import { hydrateIcons } from "./icons.mjs";
import { permissionRowCounts, requiredUngrantedOrigins } from "./permission-ui-model.mjs";
import { hydrateStorage } from "./storage.mjs";
import { createOnboardingController } from "./onboarding-controller.mjs";
import { isMicrosoftEdge, setNativeFaviconEnabled, supportsNativeFavicon } from "./urls.mjs";
import { enhanceSelectComboboxes } from "./select-combobox.mjs";
import {
  containsPermissions, removeOrigins, removePermissions,
  requestPermissionDetails, requestPermissions,
} from "./permission-client.mjs";

enhanceSelectComboboxes(document);

const microsoftEdge = isMicrosoftEdge();
const nativeFaviconSupported = supportsNativeFavicon();

const els = {
  permissionList: document.querySelector("#sourcePermissionList"),
  permissionSummary: document.querySelector("#sourcePermissionSummary"),
  permissionDetails: document.querySelector("#sourcePermissionDetails"),
  permissionActions: document.querySelector("#sourcePermissionActions"),
  grantAllSources: document.querySelector("#grantAllSources"),
  openExtensionManager: document.querySelector("#openExtensionManager"),
  grantBraveOrigin: document.querySelector("#grantBraveOrigin"),
  faviconPermissionStatus: document.querySelector("#faviconPermissionStatus"),
  toggleFaviconPermission: document.querySelector("#toggleFaviconPermission"),
  browserSearchPermissionStatus: document.querySelector("#browserSearchPermissionStatus"),
  toggleBrowserSearchPermission: document.querySelector("#toggleBrowserSearchPermission"),
};

let settings = null;
let permissionRows = [];
let permissionFeedback = "";
let permissionRefreshToken = 0;
let faviconPermissionGranted = null;
let faviconPermissionBusy = false;
let faviconPermissionError = "";
let browserSearchPermissionGranted = null;
let browserSearchPermissionBusy = false;
let browserSearchPermissionError = "";
const onboarding = createOnboardingController({ request, onSettingsChange: value => {
  settings = value;
  renderPermissionRows(value.sourcePermissions || []);
} });

setLocale(getLocale(), { persist: false });
hydrateIcons(document);
initializeExtensionUi();

async function initializeExtensionUi() {
  createHistoryPermissionController({ t });
  bindEvents();
  try {
    await hydrateStorage();
    settings = await request("settings:get");
    await prepareLocale(settings.uiLocale || getLocale());
    setLocale(settings.uiLocale || getLocale(), { persist: Boolean(settings.uiLocale), translate: false });
    translateDocument(document);
    renderPermissionRows(settings.sourcePermissions || []);
    refreshFaviconPermission({ notify: true });
    refreshBrowserSearchPermission({ notify: true });
    await onboarding.initialize(settings);
  } catch (error) {
    renderPermissionRows([]);
    setPermissionFeedback(error.message || String(error));
  }
}

function bindEvents() {
  els.grantAllSources?.addEventListener("click", (event) => grantOrigins(requiredUngrantedOrigins(permissionRows), {
    trigger: event.currentTarget,
  }));
  els.permissionList?.addEventListener("click", handlePermissionAction);
  els.openExtensionManager?.addEventListener("click", () => {
    const managerUrl = microsoftEdge ? "edge://extensions/" : `chrome://extensions/?id=${chrome.runtime.id}`;
    chrome.tabs.create({ url: managerUrl }).catch(() => {});
  });
  els.grantBraveOrigin?.addEventListener("click", (event) => grantOrigins(["https://api.search.brave.com/*"], {
    trigger: event.currentTarget,
  }));
  els.toggleFaviconPermission?.addEventListener("click", () => {
    updateFaviconPermission(faviconPermissionGranted !== true);
  });
  els.toggleBrowserSearchPermission?.addEventListener("click", () => {
    updateBrowserSearchPermission(browserSearchPermissionGranted !== true);
  });
  document.addEventListener("ampira:locale-changed", () => {
    queueMicrotask(() => {
      translateDocument(document);
      permissionFeedback = "";
      renderPermissionRows(permissionRows);
      renderFaviconPermission();
      renderBrowserSearchPermission();
      onboarding.translate();
    });
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      refreshPermissionRows();
      refreshFaviconPermission({ notify: true });
      refreshBrowserSearchPermission({ notify: true });
    }
  });
  window.addEventListener("ampira:runtime-message", (event) => {
    if (event.detail?.type === "settings.changed") refreshPermissionRows();
  });
  const handleNamedPermissionChange = (permissions) => {
    if (permissions?.permissions?.includes("favicon")) {
      refreshFaviconPermission({ notify: true });
      onboarding.refreshPermissions();
    }
    if (permissions?.permissions?.includes("search")) refreshBrowserSearchPermission({ notify: true });
  };
  chrome.permissions?.onAdded?.addListener(handleNamedPermissionChange);
  chrome.permissions?.onRemoved?.addListener(handleNamedPermissionChange);
}

async function refreshPermissionRows() {
  const token = ++permissionRefreshToken;
  try {
    const rows = await request("permissions:origins");
    if (token !== permissionRefreshToken) return;
    permissionFeedback = "";
    renderPermissionRows(rows || []);
    onboarding.refreshPermissions();
  } catch (error) {
    if (token !== permissionRefreshToken) return;
    setPermissionFeedback(error.message || String(error));
  }
}

async function refreshFaviconPermission({ notify = false } = {}) {
  const previous = faviconPermissionGranted;
  if (!nativeFaviconSupported) {
    faviconPermissionGranted = false;
    faviconPermissionError = "";
    setNativeFaviconEnabled(false);
    renderFaviconPermission();
    return false;
  }
  try {
    faviconPermissionGranted = await containsPermissions(["favicon"]);
    faviconPermissionError = "";
  } catch (error) {
    faviconPermissionGranted = false;
    faviconPermissionError = t("settings.browser.faviconError", { message: error.message || error });
  }
  setNativeFaviconEnabled(faviconPermissionGranted);
  renderFaviconPermission();
  if (notify && previous !== faviconPermissionGranted) {
    window.dispatchEvent(new CustomEvent("ampira:favicon-permission-changed", {
      detail: { granted: faviconPermissionGranted },
    }));
  }
  return faviconPermissionGranted;
}

async function updateFaviconPermission(enable, { trigger = null } = {}) {
  if (!nativeFaviconSupported) return false;
  if (faviconPermissionBusy) return false;
  faviconPermissionBusy = true;
  faviconPermissionError = "";
  if (trigger) trigger.disabled = true;
  renderFaviconPermission();
  try {
    const changed = enable
      ? await requestPermissions(["favicon"])
      : await removePermissions(["favicon"]);
    await refreshFaviconPermission({ notify: true });
    if (changed !== true) faviconPermissionError = t("settings.browser.permissionDeclined");
    return changed === true;
  } catch (error) {
    faviconPermissionError = t("settings.browser.faviconError", { message: error.message || error });
    return false;
  } finally {
    faviconPermissionBusy = false;
    if (trigger?.isConnected) trigger.disabled = false;
    renderFaviconPermission();
  }
}

function renderFaviconPermission() {
  if (els.faviconPermissionStatus) {
    els.faviconPermissionStatus.textContent = nativeFaviconSupported
      ? faviconPermissionError || (faviconPermissionGranted === null ? t("settings.browser.faviconChecking") : "")
      : t("settings.browser.faviconUnsupported");
    els.faviconPermissionStatus.hidden = nativeFaviconSupported && faviconPermissionGranted !== null && !faviconPermissionError;
  }
  if (!els.toggleFaviconPermission) return;
  els.toggleFaviconPermission.hidden = !nativeFaviconSupported;
  els.toggleFaviconPermission.disabled = faviconPermissionBusy || faviconPermissionGranted === null;
  const label = els.toggleFaviconPermission.querySelector(".btn-label");
  if (label) {
    label.textContent = faviconPermissionBusy
      ? t(faviconPermissionGranted ? "permission.updating" : "permission.requesting")
      : t(faviconPermissionGranted ? "settings.browser.faviconDisable" : "settings.browser.faviconEnable");
  }
}

async function refreshBrowserSearchPermission({ notify = false } = {}) {
  const previous = browserSearchPermissionGranted;
  try {
    browserSearchPermissionGranted = await containsPermissions(["search"]);
    browserSearchPermissionError = "";
  } catch (error) {
    browserSearchPermissionGranted = false;
    browserSearchPermissionError = t("settings.browser.searchError", { message: error.message || error });
  }
  renderBrowserSearchPermission();
  if (notify && previous !== browserSearchPermissionGranted) {
    window.dispatchEvent(new CustomEvent("ampira:browser-search-permission-changed", {
      detail: { granted: browserSearchPermissionGranted },
    }));
  }
  return browserSearchPermissionGranted;
}

async function updateBrowserSearchPermission(enable) {
  if (browserSearchPermissionBusy) return false;
  browserSearchPermissionBusy = true;
  browserSearchPermissionError = "";
  renderBrowserSearchPermission();
  try {
    const changed = enable
      ? await requestPermissions(["search"])
      : await removePermissions(["search"]);
    await refreshBrowserSearchPermission({ notify: true });
    if (changed !== true) browserSearchPermissionError = t("settings.browser.permissionDeclined");
    return changed === true;
  } catch (error) {
    browserSearchPermissionError = t("settings.browser.searchError", { message: error.message || error });
    return false;
  } finally {
    browserSearchPermissionBusy = false;
    renderBrowserSearchPermission();
  }
}

function renderBrowserSearchPermission() {
  if (els.browserSearchPermissionStatus) {
    els.browserSearchPermissionStatus.textContent = browserSearchPermissionError;
    els.browserSearchPermissionStatus.hidden = !browserSearchPermissionError;
  }
  if (!els.toggleBrowserSearchPermission) return;
  els.toggleBrowserSearchPermission.disabled = browserSearchPermissionBusy || browserSearchPermissionGranted === null;
  els.toggleBrowserSearchPermission.checked = browserSearchPermissionGranted === true;
}

async function grantOrigins(origins, { onGranted = null, permissions = [], trigger = null } = {}) {
  const requested = Array.isArray(origins) ? origins.filter(Boolean) : [];
  const requestedPermissions = Array.isArray(permissions) ? permissions.filter(Boolean) : [];
  if (!requested.length && !requestedPermissions.length) {
    if (onGranted) await onGranted();
    return;
  }
  const label = trigger?.querySelector(".btn-label");
  const idleLabel = label?.textContent || "";
  if (trigger) trigger.disabled = true;
  if (label) label.textContent = t("permission.requesting");
  setPermissionFeedback(t("permission.requesting"));
  try {
    const requestDetails = {};
    if (requested.length) requestDetails.origins = requested;
    if (requestedPermissions.length) requestDetails.permissions = requestedPermissions;
    const granted = await requestPermissionDetails(requestDetails);
    if (granted !== true) {
      setPermissionFeedback(t("permission.requestDeclined"));
      return;
    }
    await refreshPermissionRows();
    if (requestedPermissions.includes("favicon")) await refreshFaviconPermission({ notify: true });
    if (onGranted) await onGranted();
  } catch (error) {
    setPermissionFeedback(t("permission.requestDenied", { message: error.message || error }));
  } finally {
    if (trigger?.isConnected) trigger.disabled = false;
    if (label?.isConnected) label.textContent = idleLabel;
    renderPermissionActions();
  }
}

async function handlePermissionAction(event) {
  const button = event.target.closest("button[data-origin]");
  if (!button) return;
  const origin = button.dataset.origin;
  if (button.dataset.action === "remove") {
    button.disabled = true;
    setPermissionFeedback(t("permission.updating"));
    try {
      const removed = await removeOrigins([origin]);
      if (removed !== true) {
        setPermissionFeedback(t("permission.revokeDeclined"));
        button.disabled = false;
        return;
      }
      await refreshPermissionRows();
    } catch (error) {
      setPermissionFeedback(t("permission.requestDenied", { message: error.message || error }));
      button.disabled = false;
    }
    return;
  }
  grantOrigins([origin], { trigger: button });
}

function renderPermissionRows(rows) {
  permissionRows = Array.isArray(rows) ? rows : [];
  if (!els.permissionList) return;
  if (!permissionRows.length) {
    const empty = document.createElement("div");
    empty.className = "settings-cache-note";
    empty.textContent = t("permission.noSources");
    els.permissionList.replaceChildren(empty);
    renderPermissionStatus();
    renderPermissionActions();
    return;
  }
  els.permissionList.replaceChildren(...permissionRows.map((row) => {
    const item = document.createElement("div");
    item.className = "source-permission-row";
    const copy = document.createElement("div");
    copy.className = "source-permission-copy";
    const origin = document.createElement("strong");
    origin.textContent = row.origin.replace(/\/\*$/, "");
    copy.append(origin);
    const button = document.createElement("button");
    const removable = row.granted === true;
    button.className = removable ? "btn danger" : "btn";
    button.type = "button";
    button.dataset.origin = row.origin;
    button.dataset.action = removable ? "remove" : "grant";
    const buttonLabel = document.createElement("span");
    buttonLabel.className = "btn-label";
    buttonLabel.textContent = t(removable ? "permission.revoke" : "permission.grant");
    button.append(buttonLabel);
    item.append(copy, button);
    return item;
  }));
  renderPermissionStatus();
  renderPermissionActions();
}

function renderPermissionStatus() {
  const text = permissionFeedback || permissionSummaryText();
  if (els.permissionSummary) {
    els.permissionSummary.removeAttribute("data-i18n");
    const summary = permissionFeedback || (permissionRowCounts(permissionRows).required ? text : "");
    els.permissionSummary.textContent = summary;
    els.permissionSummary.hidden = !summary;
  }
}

function permissionSummaryText() {
  const counts = permissionRowCounts(permissionRows);
  const parts = [];
  if (counts.required) {
    parts.push(counts.pending === 0
      ? tc("permission.allGranted", counts.required)
      : tc("permission.summary", counts.required, { granted: counts.granted }));
  }
  return parts.join(" ") || t("permission.noneNeeded");
}

function renderPermissionActions() {
  const pending = permissionRowCounts(permissionRows).pending;
  if (els.permissionActions) els.permissionActions.hidden = pending === 0;
  if (!els.grantAllSources) return;
  els.grantAllSources.disabled = pending === 0;
  const label = els.grantAllSources.querySelector(".btn-label");
  if (label) label.textContent = tc("permission.grantPending", pending);
}

function setPermissionFeedback(message) {
  permissionFeedback = String(message || "");
  if (permissionFeedback && els.permissionDetails) els.permissionDetails.open = true;
  renderPermissionStatus();
}

function request(type, payload = {}) {
  return sendExtensionRequest({ type, payload });
}

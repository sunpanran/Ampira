import { sendExtensionRequest } from "./api.mjs";
import { getLocale, setLocale, t, tc, translateDocument } from "./i18n.mjs";
import { createIcon, hydrateIcons } from "./icons.mjs";

const els = {
  overlay: document.querySelector("#onboardingOverlay"),
  steps: [...document.querySelectorAll("[data-onboarding-step]")],
  progress: [...document.querySelectorAll(".onboarding-progress span")],
  permissionStatus: document.querySelector("#onboardingPermissionStatus"),
  grantOnboarding: document.querySelector("#onboardingGrantSources"),
  finishOnboarding: document.querySelector("#finishOnboarding"),
  permissionList: document.querySelector("#sourcePermissionList"),
  grantAllSources: document.querySelector("#grantAllSources"),
  refreshPermissions: document.querySelector("#refreshPermissionStatus"),
  openExtensionManager: document.querySelector("#openExtensionManager"),
  settingsStatus: document.querySelector("#settingsStatus"),
  grantAiOrigin: document.querySelector("#grantAiOrigin"),
  grantBraveOrigin: document.querySelector("#grantBraveOrigin"),
  apiBaseUrl: document.querySelector("#apiBaseUrlInput"),
};

let settings = null;
let permissionRows = [];
let onboardingStep = 0;

setLocale(getLocale(), { persist: false });
hydrateIcons(document);
initializeExtensionUi();

async function initializeExtensionUi() {
  bindEvents();
  try {
    settings = await request("settings:get");
    setLocale(settings.uiLocale || getLocale(), { persist: Boolean(settings.uiLocale) });
    translateDocument(document);
    renderPermissionRows(settings.sourcePermissions || []);
    if (settings.onboardingCompleted !== true) showOnboarding(0);
  } catch {
    renderPermissionRows([]);
  }
}

function bindEvents() {
  document.querySelectorAll(".onboarding-next").forEach((button) => {
    button.addEventListener("click", async () => {
      if (button.dataset.consent === "bookmarks") {
        button.disabled = true;
        try {
          settings = await request("onboarding:consent");
          permissionRows = settings.sourcePermissions || [];
        } finally {
          button.disabled = false;
        }
      }
      showOnboarding(Math.min(3, onboardingStep + 1));
    });
  });
  els.grantOnboarding?.addEventListener("click", () => grantOrigins(requiredUnGrantedOrigins(), true));
  els.finishOnboarding?.addEventListener("click", finishOnboarding);
  els.grantAllSources?.addEventListener("click", () => grantOrigins(requiredUnGrantedOrigins()));
  els.refreshPermissions?.addEventListener("click", refreshPermissionRows);
  els.permissionList?.addEventListener("click", handlePermissionAction);
  els.openExtensionManager?.addEventListener("click", () => {
    chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` }).catch(() => {});
  });
  els.grantAiOrigin?.addEventListener("click", () => grantOrigins(originPattern(els.apiBaseUrl?.value)));
  els.grantBraveOrigin?.addEventListener("click", () => grantOrigins(["https://api.search.brave.com/*"]));
  document.addEventListener("ampira:locale-changed", () => {
    translateDocument(document);
    renderPermissionRows(permissionRows);
  });
}

function showOnboarding(index) {
  onboardingStep = index;
  els.overlay.hidden = false;
  els.steps.forEach((step, stepIndex) => {
    const active = stepIndex === index;
    step.hidden = !active;
    step.classList.toggle("active", active);
  });
  els.progress.forEach((dot, dotIndex) => dot.classList.toggle("active", dotIndex <= index));
  if (index === 2) refreshPermissionRows(true);
  els.steps[index]?.querySelector("button")?.focus({ preventScroll: true });
}

async function finishOnboarding() {
  els.finishOnboarding.disabled = true;
  try {
    await request("onboarding:complete");
    els.overlay.hidden = true;
    location.reload();
  } catch (error) {
    els.finishOnboarding.textContent = error.message || String(error);
    els.finishOnboarding.disabled = false;
  }
}

async function refreshPermissionRows(forOnboarding = false) {
  try {
    const rows = await request("permissions:origins");
    renderPermissionRows(rows || []);
    if (forOnboarding) renderOnboardingPermissionStatus();
  } catch (error) {
    if (els.permissionStatus) els.permissionStatus.textContent = error.message || String(error);
  }
}

function grantOrigins(origins, advance = false) {
  const requested = Array.isArray(origins) ? origins.filter(Boolean) : [];
  if (!requested.length) {
    if (advance) showOnboarding(3);
    return;
  }
  chrome.permissions.request({ origins: requested }).then(async (granted) => {
    if (granted !== true) {
      if (els.permissionStatus) els.permissionStatus.textContent = t("permission.requestDeclined");
      return;
    }
    await refreshPermissionRows(advance);
    if (advance) showOnboarding(3);
  }).catch((error) => {
    if (els.permissionStatus) els.permissionStatus.textContent = t("permission.requestDenied", { message: error.message || error });
  });
}

function requiredUnGrantedOrigins() {
  return permissionRows
    .filter((row) => isRequiredPermission(row) && !row.granted)
    .map((row) => row.origin);
}

async function handlePermissionAction(event) {
  const button = event.target.closest("button[data-origin]");
  if (!button) return;
  const origin = button.dataset.origin;
  if (button.dataset.action === "remove") {
    try {
      const removed = await chrome.permissions.remove({ origins: [origin] });
      if (removed !== true) {
        if (els.permissionStatus) els.permissionStatus.textContent = t("permission.revokeDeclined");
        return;
      }
      await refreshPermissionRows();
    } catch (error) {
      if (els.permissionStatus) els.permissionStatus.textContent = t("permission.requestDenied", { message: error.message || error });
    }
    return;
  }
  grantOrigins([origin]);
}

function renderPermissionRows(rows) {
  permissionRows = rows;
  if (!els.permissionList) return;
  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "settings-cache-note";
    empty.textContent = t("permission.noSources");
    els.permissionList.replaceChildren(empty);
    renderOnboardingPermissionStatus();
    return;
  }
  els.permissionList.replaceChildren(...rows.map((row) => {
    const item = document.createElement("div");
    item.className = "source-permission-row";
    const copy = document.createElement("div");
    const origin = document.createElement("strong");
    origin.textContent = row.origin.replace(/\/\*$/, "");
    const state = document.createElement("span");
    state.textContent = t(row.coversRequired
      ? "permission.broadRequiredState"
      : (row.coveredByBroad
        ? "permission.broadCoverageState"
        : (row.legacy
        ? "permission.legacyState"
        : (row.granted ? "permission.grantedState" : "permission.deniedState"))));
    copy.append(origin, state);
    const button = document.createElement("button");
    const coveredByBroad = row.coveredByBroad === true;
    const removable = !coveredByBroad && (row.granted || row.legacy);
    button.className = removable ? "btn danger" : "btn";
    button.type = "button";
    button.dataset.origin = row.origin;
    button.dataset.action = removable ? "remove" : "grant";
    button.disabled = coveredByBroad;
    const buttonLabel = document.createElement("span");
    buttonLabel.className = "btn-label";
    buttonLabel.textContent = t(row.coversRequired
      ? "permission.revokeBroad"
      : (coveredByBroad ? "permission.coveredByBroad" : (removable ? "permission.revoke" : "permission.grant")));
    button.append(createIcon(removable ? "trash-01" : "plus", "btn-icon"), buttonLabel);
    item.append(createIcon("rss-01", "source-permission-icon"), copy, button);
    return item;
  }));
  renderOnboardingPermissionStatus();
}

function renderOnboardingPermissionStatus() {
  if (!els.permissionStatus) return;
  const required = permissionRows.filter(isRequiredPermission);
  const granted = required.filter((row) => row.granted).length;
  const legacyCount = permissionRows.filter((row) => row.legacy).length;
  const broadRequiredCount = permissionRows.filter((row) => row.coversRequired).length;
  const parts = [];
  if (required.length) parts.push(tc("permission.summary", required.length, { granted }));
  if (legacyCount) parts.push(tc("permission.legacySummary", legacyCount));
  if (broadRequiredCount) parts.push(t("permission.broadSummary", { count: broadRequiredCount }));
  els.permissionStatus.textContent = parts.join(" ") || t("permission.noneNeeded");
}

function isRequiredPermission(row) {
  return row?.required !== false && row?.legacy !== true;
}

function originPattern(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (url.protocol === "https:") return [`${url.origin}/*`];
    if (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)) return [`${url.origin}/*`];
  } catch {
    // The shared validation message below covers malformed URLs too.
  }
  if (els.settingsStatus) els.settingsStatus.textContent = t("permission.invalidServiceUrl");
  return [];
}

function request(type, payload = {}) {
  return sendExtensionRequest({ type, payload });
}

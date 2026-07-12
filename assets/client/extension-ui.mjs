import { sendExtensionRequest } from "./api.mjs";
import { getLocale, setLocale, t, tc, translateDocument } from "./i18n.mjs";
import { createIcon, hydrateIcons } from "./icons.mjs";
import { permissionRowCounts, requiredUngrantedOrigins } from "./permission-ui-model.mjs";
import { setNativeFaviconEnabled } from "./urls.mjs";

const els = {
  overlay: document.querySelector("#onboardingOverlay"),
  steps: [...document.querySelectorAll("[data-onboarding-step]")],
  progress: [...document.querySelectorAll(".onboarding-progress span")],
  permissionStatus: document.querySelector("#onboardingPermissionStatus"),
  grantOnboarding: document.querySelector("#onboardingGrantSources"),
  newsFolder: document.querySelector("#onboardingNewsFolder"),
  inspirationFolder: document.querySelector("#onboardingInspirationFolder"),
  folderStatus: document.querySelector("#onboardingFolderStatus"),
  saveFolders: document.querySelector("#onboardingSaveFolders"),
  apiKey: document.querySelector("#onboardingApiKey"),
  aiConsent: document.querySelector("#onboardingAiConsent"),
  aiStatus: document.querySelector("#onboardingAiStatus"),
  providerOrigin: document.querySelector("#onboardingProviderOrigin"),
  saveApiKey: document.querySelector("#onboardingSaveApiKey"),
  skipApiKey: document.querySelector("#onboardingSkipApiKey"),
  onboardingPermissionSummary: document.querySelector("#onboardingPermissionSummary"),
  folderSummary: document.querySelector("#onboardingFolderSummary"),
  aiSummary: document.querySelector("#onboardingAiSummary"),
  finishOnboarding: document.querySelector("#finishOnboarding"),
  permissionList: document.querySelector("#sourcePermissionList"),
  permissionSummary: document.querySelector("#sourcePermissionSummary"),
  permissionActions: document.querySelector("#sourcePermissionActions"),
  grantAllSources: document.querySelector("#grantAllSources"),
  openExtensionManager: document.querySelector("#openExtensionManager"),
  grantBraveOrigin: document.querySelector("#grantBraveOrigin"),
  faviconPermissionStatus: document.querySelector("#faviconPermissionStatus"),
  toggleFaviconPermission: document.querySelector("#toggleFaviconPermission"),
};

let settings = null;
let permissionRows = [];
let onboardingStep = 0;
let permissionFeedback = "";
let permissionRefreshToken = 0;
let faviconPermissionGranted = null;
let faviconPermissionBusy = false;
let faviconPermissionError = "";
const lastOnboardingStep = Math.max(0, els.steps.length - 1);

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
    refreshFaviconPermission({ notify: true });
    syncOnboardingFolderControls();
    renderOnboardingProviderOrigin();
    if (settings.onboardingCompleted !== true) showOnboarding(0);
  } catch (error) {
    renderPermissionRows([]);
    setPermissionFeedback(error.message || String(error));
  }
}

function bindEvents() {
  document.querySelectorAll(".onboarding-next").forEach((button) => {
    button.addEventListener("click", async () => {
      if (button.dataset.consent === "bookmarks") {
        button.disabled = true;
        try {
          settings = await request("onboarding:consent");
          renderPermissionRows(settings.sourcePermissions || []);
          syncOnboardingFolderControls();
        } catch (error) {
          const label = button.querySelector(".btn-label");
          if (label) label.textContent = t("onboarding.actionFailed", { message: error.message || error });
          return;
        } finally {
          button.disabled = false;
        }
      }
      if (button === els.skipApiKey && els.apiKey) els.apiKey.value = "";
      showOnboarding(Math.min(lastOnboardingStep, onboardingStep + 1));
    });
  });
  document.querySelectorAll('[data-permission="favicon"]').forEach((button) => {
    button.addEventListener("click", () => updateFaviconPermission(true, { trigger: button }));
  });
  els.grantOnboarding?.addEventListener("click", (event) => grantOrigins(requiredUngrantedOrigins(permissionRows), {
    advance: true,
    permissions: ["favicon"],
    trigger: event.currentTarget,
  }));
  els.newsFolder?.addEventListener("change", renderOnboardingFolderStatus);
  els.inspirationFolder?.addEventListener("change", renderOnboardingFolderStatus);
  els.saveFolders?.addEventListener("click", saveOnboardingFolders);
  els.aiConsent?.addEventListener("change", () => setOnboardingStatus(els.aiStatus, ""));
  els.apiKey?.addEventListener("input", () => setOnboardingStatus(els.aiStatus, ""));
  els.saveApiKey?.addEventListener("click", saveOnboardingApiKey);
  els.finishOnboarding?.addEventListener("click", finishOnboarding);
  els.grantAllSources?.addEventListener("click", (event) => grantOrigins(requiredUngrantedOrigins(permissionRows), {
    trigger: event.currentTarget,
  }));
  els.permissionList?.addEventListener("click", handlePermissionAction);
  els.openExtensionManager?.addEventListener("click", () => {
    chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` }).catch(() => {});
  });
  els.grantBraveOrigin?.addEventListener("click", (event) => grantOrigins(["https://api.search.brave.com/*"], {
    trigger: event.currentTarget,
  }));
  els.toggleFaviconPermission?.addEventListener("click", () => {
    updateFaviconPermission(faviconPermissionGranted !== true);
  });
  document.addEventListener("ampira:locale-changed", () => {
    queueMicrotask(() => {
      translateDocument(document);
      permissionFeedback = "";
      renderPermissionRows(permissionRows);
      renderFaviconPermission();
      syncOnboardingFolderControls({ preserveSelection: true });
      renderOnboardingProviderOrigin();
      renderOnboardingSummary();
    });
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      refreshPermissionRows();
      refreshFaviconPermission({ notify: true });
    }
  });
  window.addEventListener("ampira:runtime-message", (event) => {
    if (event.detail?.type === "settings.changed") refreshPermissionRows();
  });
  const handleNamedPermissionChange = (permissions) => {
    if (permissions?.permissions?.includes("favicon")) refreshFaviconPermission({ notify: true });
  };
  chrome.permissions?.onAdded?.addListener(handleNamedPermissionChange);
  chrome.permissions?.onRemoved?.addListener(handleNamedPermissionChange);
}

function showOnboarding(index) {
  onboardingStep = Math.max(0, Math.min(lastOnboardingStep, index));
  els.overlay.hidden = false;
  els.steps.forEach((step, stepIndex) => {
    const active = stepIndex === onboardingStep;
    step.hidden = !active;
    step.classList.toggle("active", active);
  });
  els.progress.forEach((dot, dotIndex) => dot.classList.toggle("active", dotIndex <= onboardingStep));
  const title = els.steps[onboardingStep]?.querySelector("h1[id]");
  if (title) els.overlay.setAttribute("aria-labelledby", title.id);
  if (onboardingStep === 1) refreshPermissionRows();
  if (onboardingStep === 2) syncOnboardingFolderControls({ preserveSelection: true });
  if (onboardingStep === 3) renderOnboardingProviderOrigin();
  if (onboardingStep === 4) renderOnboardingSummary();
  els.steps[onboardingStep]?.querySelector("input:not([disabled]), select:not([disabled]), button:not([disabled])")?.focus({ preventScroll: true });
}

function syncOnboardingFolderControls({ preserveSelection = false } = {}) {
  if (!els.newsFolder || !els.inspirationFolder) return;
  const options = Array.isArray(settings?.bookmarkFolderOptions) ? settings.bookmarkFolderOptions : [];
  const newsSelection = preserveSelection
    ? els.newsFolder.value
    : (settings?.newsBookmarkFolder || settings?.defaultNewsBookmarkFolder || "");
  const inspirationSelection = preserveSelection
    ? els.inspirationFolder.value
    : (settings?.inspirationBookmarkFolder || settings?.defaultInspirationBookmarkFolder || "");
  populateFolderSelect(els.newsFolder, options, newsSelection);
  populateFolderSelect(els.inspirationFolder, options, inspirationSelection);
  if (els.newsFolder.value && els.newsFolder.value === els.inspirationFolder.value) {
    const alternate = options.find((option) => option?.name && option.name !== els.newsFolder.value)?.name || "";
    if (alternate) els.inspirationFolder.value = alternate;
  }
  renderOnboardingFolderStatus();
}

function populateFolderSelect(select, options, selectedValue) {
  const names = options.map((option) => String(option?.name || "").trim()).filter(Boolean);
  if (!names.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = t("settings.bookmarks.none");
    option.disabled = true;
    select.replaceChildren(option);
    select.disabled = true;
    return;
  }
  select.disabled = false;
  select.replaceChildren(...names.map((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    return option;
  }));
  select.value = names.includes(selectedValue) ? selectedValue : names[0];
}

function renderOnboardingFolderStatus() {
  if (!els.folderStatus || !els.saveFolders) return;
  const news = els.newsFolder?.value || "";
  const inspiration = els.inspirationFolder?.value || "";
  const same = Boolean(news && news === inspiration);
  const complete = Boolean(news && inspiration && !same);
  els.saveFolders.disabled = !complete;
  if (!news || !inspiration) {
    setOnboardingStatus(els.folderStatus, t("onboarding.step3.noFolders"));
  } else if (same) {
    setOnboardingStatus(els.folderStatus, t("settings.bookmarks.same"), "error");
  } else {
    setOnboardingStatus(els.folderStatus, t("onboarding.step3.selection", { news, inspiration }));
  }
}

async function saveOnboardingFolders() {
  const newsBookmarkFolder = els.newsFolder?.value || "";
  const inspirationBookmarkFolder = els.inspirationFolder?.value || "";
  if (!newsBookmarkFolder || !inspirationBookmarkFolder || newsBookmarkFolder === inspirationBookmarkFolder) return;
  els.saveFolders.disabled = true;
  setOnboardingStatus(els.folderStatus, t("onboarding.step3.saving"));
  try {
    settings = await request("settings:save", { newsBookmarkFolder, inspirationBookmarkFolder });
    renderPermissionRows(settings.sourcePermissions || []);
    setOnboardingStatus(els.folderStatus, t("onboarding.step3.saved"), "success");
    showOnboarding(3);
  } catch (error) {
    setOnboardingStatus(els.folderStatus, t("onboarding.actionFailed", { message: error.message || error }), "error");
  } finally {
    const news = els.newsFolder?.value || "";
    const inspiration = els.inspirationFolder?.value || "";
    els.saveFolders.disabled = !news || !inspiration || news === inspiration;
  }
}

function renderOnboardingProviderOrigin() {
  if (!els.providerOrigin) return;
  const value = settings?.openaiBaseUrl || settings?.baseUrl || "";
  const pattern = originPattern(value);
  els.providerOrigin.textContent = pattern
    ? t("onboarding.step4.providerOrigin", { origin: pattern.replace(/\/\*$/, "") })
    : t("permission.invalidServiceUrl");
}

async function saveOnboardingApiKey() {
  const openaiApiKey = String(els.apiKey?.value || "").trim();
  if (!openaiApiKey) {
    setOnboardingStatus(els.aiStatus, t("onboarding.step4.keyRequired"), "error");
    els.apiKey?.focus();
    return;
  }
  if (els.aiConsent?.checked !== true) {
    setOnboardingStatus(els.aiStatus, t("onboarding.step4.consentRequired"), "error");
    els.aiConsent?.focus();
    return;
  }
  const baseUrl = settings?.openaiBaseUrl || settings?.baseUrl || "";
  const pattern = originPattern(baseUrl);
  if (!pattern) {
    setOnboardingStatus(els.aiStatus, t("permission.invalidServiceUrl"), "error");
    return;
  }
  els.saveApiKey.disabled = true;
  setOnboardingStatus(els.aiStatus, t("permission.requesting"));
  try {
    const granted = await chrome.permissions.request({ origins: [pattern] });
    if (granted !== true) {
      setOnboardingStatus(els.aiStatus, t("permission.requestDeclined"), "error");
      return;
    }
    settings = await request("settings:save", { openaiApiKey, aiDisclosureAccepted: true });
    els.apiKey.value = "";
    els.aiConsent.checked = false;
    setOnboardingStatus(els.aiStatus, t("onboarding.step4.saved"), "success");
    showOnboarding(4);
  } catch (error) {
    setOnboardingStatus(els.aiStatus, t("onboarding.actionFailed", { message: error.message || error }), "error");
  } finally {
    els.saveApiKey.disabled = false;
  }
}

function originPattern(value) {
  try {
    const url = new URL(value);
    const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
    if (url.protocol !== "https:" && !localHttp) return "";
    return `${url.origin}/*`;
  } catch {
    return "";
  }
}

function setOnboardingStatus(element, message, state = "") {
  if (!element) return;
  element.textContent = String(message || "");
  if (state) element.dataset.state = state;
  else delete element.dataset.state;
}

function renderOnboardingSummary() {
  if (els.onboardingPermissionSummary) els.onboardingPermissionSummary.textContent = permissionSummaryText();
  if (els.folderSummary) {
    const news = settings?.newsBookmarkFolder || settings?.defaultNewsBookmarkFolder || "";
    const inspiration = settings?.inspirationBookmarkFolder || settings?.defaultInspirationBookmarkFolder || "";
    els.folderSummary.textContent = news && inspiration
      ? t("onboarding.step5.folderSummary", { news, inspiration })
      : t("onboarding.step5.notConfigured");
  }
  if (els.aiSummary) {
    els.aiSummary.textContent = t(settings?.hasOpenAIKey
      ? "onboarding.step5.configured"
      : "onboarding.step5.notConfigured");
  }
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

async function refreshPermissionRows() {
  const token = ++permissionRefreshToken;
  try {
    const rows = await request("permissions:origins");
    if (token !== permissionRefreshToken) return;
    permissionFeedback = "";
    renderPermissionRows(rows || []);
  } catch (error) {
    if (token !== permissionRefreshToken) return;
    setPermissionFeedback(error.message || String(error));
  }
}

async function refreshFaviconPermission({ notify = false } = {}) {
  const previous = faviconPermissionGranted;
  try {
    faviconPermissionGranted = await chrome.permissions.contains({ permissions: ["favicon"] });
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
  if (faviconPermissionBusy) return false;
  faviconPermissionBusy = true;
  faviconPermissionError = "";
  if (trigger) trigger.disabled = true;
  renderFaviconPermission();
  try {
    const changed = enable
      ? await chrome.permissions.request({ permissions: ["favicon"] })
      : await chrome.permissions.remove({ permissions: ["favicon"] });
    await refreshFaviconPermission({ notify: true });
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
    els.faviconPermissionStatus.textContent = faviconPermissionError || t(faviconPermissionGranted === null
      ? "settings.browser.faviconChecking"
      : (faviconPermissionGranted ? "settings.browser.faviconEnabled" : "settings.browser.faviconDisabled"));
  }
  if (!els.toggleFaviconPermission) return;
  els.toggleFaviconPermission.disabled = faviconPermissionBusy || faviconPermissionGranted === null;
  const label = els.toggleFaviconPermission.querySelector(".btn-label");
  if (label) {
    label.textContent = faviconPermissionBusy
      ? t(faviconPermissionGranted ? "permission.updating" : "permission.requesting")
      : t(faviconPermissionGranted ? "settings.browser.faviconDisable" : "settings.browser.faviconEnable");
  }
}

async function grantOrigins(origins, { advance = false, permissions = [], trigger = null } = {}) {
  const requested = Array.isArray(origins) ? origins.filter(Boolean) : [];
  const requestedPermissions = Array.isArray(permissions) ? permissions.filter(Boolean) : [];
  if (!requested.length && !requestedPermissions.length) {
    if (advance) showOnboarding(Math.min(lastOnboardingStep, onboardingStep + 1));
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
    const granted = await chrome.permissions.request(requestDetails);
    if (granted !== true) {
      setPermissionFeedback(t("permission.requestDeclined"));
      return;
    }
    await refreshPermissionRows();
    if (requestedPermissions.includes("favicon")) await refreshFaviconPermission({ notify: true });
    if (advance) showOnboarding(Math.min(lastOnboardingStep, onboardingStep + 1));
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
      const removed = await chrome.permissions.remove({ origins: [origin] });
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
    item.append(createIcon("key-01", "source-permission-icon"), copy, button);
    return item;
  }));
  renderPermissionStatus();
  renderPermissionActions();
}

function renderPermissionStatus() {
  const text = permissionFeedback || permissionSummaryText();
  if (els.permissionStatus) els.permissionStatus.textContent = text;
  if (els.permissionSummary) els.permissionSummary.textContent = text;
}

function permissionSummaryText() {
  const counts = permissionRowCounts(permissionRows);
  const parts = [];
  if (counts.required) {
    parts.push(counts.pending === 0
      ? tc("permission.allGranted", counts.required)
      : tc("permission.summary", counts.required, { granted: counts.granted }));
  }
  if (counts.legacy) parts.push(tc("permission.legacySummary", counts.legacy));
  if (counts.broadRequired) parts.push(t("permission.broadSummary", { count: counts.broadRequired }));
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
  renderPermissionStatus();
}

function request(type, payload = {}) {
  return sendExtensionRequest({ type, payload });
}

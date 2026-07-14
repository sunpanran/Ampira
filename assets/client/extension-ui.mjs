import { sendExtensionRequest } from "./api.mjs";
import { getLocale, setLocale, t, tc, translateDocument } from "./i18n.mjs";
import { createIcon, hydrateIcons } from "./icons.mjs";
import { permissionRowCounts, requiredUngrantedOrigins } from "./permission-ui-model.mjs";
import { INSPIRATION_PRESET_VALUE, inspirationBookmarkValue, inspirationSelectionValue, parseInspirationSelection } from "./inspiration-source-selection.mjs";
import { PUBLIC_FEED_VALUE, newsBookmarkValue, newsSelectionValue, parseNewsSelection } from "./news-source-selection.mjs";
import { hydrateStorage, readValue, writeValue } from "./storage.mjs";
import { setNativeFaviconEnabled } from "./urls.mjs";

const ONBOARDING_PROGRESS_KEY = "dash.onboarding.progress";

const els = {
  overlay: document.querySelector("#onboardingOverlay"),
  steps: [...document.querySelectorAll("[data-onboarding-step]")],
  progress: [...document.querySelectorAll(".onboarding-progress span")],
  startOnboarding: document.querySelector("#onboardingStart"),
  permissionStatus: document.querySelector("#onboardingPermissionStatus"),
  grantOnboarding: document.querySelector("#onboardingGrantSources"),
  skipPermissions: document.querySelector("#onboardingSkipPermissions"),
  newsFolder: document.querySelector("#onboardingNewsFolder"),
  inspirationFolder: document.querySelector("#onboardingInspirationFolder"),
  folderStatus: document.querySelector("#onboardingFolderStatus"),
  saveFolders: document.querySelector("#onboardingSaveFolders"),
  skipFolders: document.querySelector("#onboardingSkipFolders"),
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
    await hydrateStorage();
    settings = await request("settings:get");
    setLocale(settings.uiLocale || getLocale(), { persist: Boolean(settings.uiLocale) });
    translateDocument(document);
    renderPermissionRows(settings.sourcePermissions || []);
    refreshFaviconPermission({ notify: true });
    syncOnboardingFolderControls();
    if (settings.onboardingCompleted !== true) showOnboarding(initialOnboardingStep());
  } catch (error) {
    renderPermissionRows([]);
    setPermissionFeedback(error.message || String(error));
  }
}

function bindEvents() {
  els.startOnboarding?.addEventListener("click", acceptBookmarkConsent);
  els.grantOnboarding?.addEventListener("click", (event) => grantOrigins(requiredUngrantedOrigins(permissionRows), {
    finish: true,
    permissions: ["favicon"],
    trigger: event.currentTarget,
  }));
  els.skipPermissions?.addEventListener("click", (event) => finishOnboarding(event.currentTarget));
  els.newsFolder?.addEventListener("change", renderOnboardingFolderStatus);
  els.inspirationFolder?.addEventListener("change", handleOnboardingInspirationSelection);
  els.saveFolders?.addEventListener("click", saveOnboardingFolders);
  els.skipFolders?.addEventListener("click", showOnboardingPermissions);
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
  if (onboardingStep === 1) syncOnboardingFolderControls({ preserveSelection: true });
  if (onboardingStep === 2) refreshPermissionRows();
  els.steps[onboardingStep]?.querySelector("input:not([disabled]), select:not([disabled]), button:not([disabled])")?.focus({ preventScroll: true });
}

function initialOnboardingStep() {
  if (settings?.bookmarkConsentGranted !== true) return 0;
  return readValue(ONBOARDING_PROGRESS_KEY) === "permissions" ? 2 : 1;
}

async function acceptBookmarkConsent(event) {
  const button = event.currentTarget;
  const label = button.querySelector(".btn-label");
  button.disabled = true;
  try {
    settings = await request("onboarding:consent");
    renderPermissionRows(settings.sourcePermissions || []);
    syncOnboardingFolderControls();
    writeValue(ONBOARDING_PROGRESS_KEY, "folders");
    showOnboarding(1);
  } catch (error) {
    if (label) label.textContent = t("onboarding.actionFailed", { message: error.message || error });
  } finally {
    button.disabled = false;
  }
}

function showOnboardingPermissions() {
  writeValue(ONBOARDING_PROGRESS_KEY, "permissions");
  showOnboarding(2);
}

function syncOnboardingFolderControls({ preserveSelection = false } = {}) {
  if (!els.newsFolder || !els.inspirationFolder) return;
  const options = Array.isArray(settings?.bookmarkFolderOptions) ? settings.bookmarkFolderOptions : [];
  const newsSelection = preserveSelection
    ? els.newsFolder.value
    : newsSelectionValue(
      settings?.newsSourceMode,
      settings?.newsBookmarkFolder || settings?.defaultNewsBookmarkFolder,
    );
  const inspirationSelection = preserveSelection
    ? els.inspirationFolder.value
    : inspirationSelectionValue(
      settings?.inspirationSourceMode,
      settings?.inspirationBookmarkFolder || settings?.defaultInspirationBookmarkFolder,
    );
  populateNewsSourceSelect(els.newsFolder, options, newsSelection);
  populateInspirationSourceSelect(els.inspirationFolder, options, inspirationSelection);
  renderOnboardingFolderStatus();
}

function handleOnboardingInspirationSelection() {
  const selection = selectedOnboardingInspirationSource();
  settings = {
    ...(settings || {}),
    inspirationSourceMode: selection.mode,
    ...(selection.mode === "bookmarks" ? { inspirationBookmarkFolder: selection.folder } : {}),
  };
  renderOnboardingFolderStatus();
}

function populateNewsSourceSelect(select, options, selectedValue) {
  const folders = options.map((item) => ({
    name: String(item?.name || "").trim(),
    count: Number(item?.count || 0),
  })).filter((item) => item.name);
  const selected = parseNewsSelection(selectedValue, settings?.newsBookmarkFolder);
  const optionNodes = [createOption(PUBLIC_FEED_VALUE, t("settings.bookmarks.publicFeedTitle"))];
  if (selected.mode === "bookmarks" && selected.folder
    && !folders.some((item) => item.name === selected.folder)) {
    optionNodes.push(createOption(
      newsBookmarkValue(selected.folder),
      t("settings.bookmarks.notFound", { name: selected.folder }),
    ));
  }
  optionNodes.push(...folders.map((item) => createOption(
    newsBookmarkValue(item.name),
    t("settings.bookmarks.folderOption", { name: item.name, count: item.count }),
  )));
  select.replaceChildren(...optionNodes);
  select.value = newsSelectionValue(selected.mode, selected.folder);
  if (!select.value) select.value = PUBLIC_FEED_VALUE;
  select.disabled = false;
}

function populateInspirationSourceSelect(select, options, selectedValue) {
  const folders = options.map((item) => ({
    name: String(item?.name || "").trim(),
    count: Number(item?.count || 0),
  })).filter((item) => item.name);
  const selected = parseInspirationSelection(selectedValue, settings?.inspirationBookmarkFolder);
  const optionNodes = [createOption(INSPIRATION_PRESET_VALUE, t("settings.bookmarks.presetTitle"))];
  if (selected.folder && !folders.some((item) => item.name === selected.folder)) {
    optionNodes.push(createOption(
      inspirationBookmarkValue(selected.folder),
      t("settings.bookmarks.notFound", { name: selected.folder }),
    ));
  }
  optionNodes.push(...folders.map((item) => createOption(
    inspirationBookmarkValue(item.name),
    t("settings.bookmarks.folderOption", { name: item.name, count: item.count }),
  )));
  select.replaceChildren(...optionNodes);
  select.value = inspirationSelectionValue(selected.mode, selected.folder);
  if (!select.value) select.value = INSPIRATION_PRESET_VALUE;
  select.disabled = false;
}

function createOption(value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  return option;
}

function selectedOnboardingInspirationSource() {
  return parseInspirationSelection(
    els.inspirationFolder?.value,
    settings?.inspirationBookmarkFolder || settings?.defaultInspirationBookmarkFolder,
  );
}

function selectedOnboardingNewsSource() {
  return parseNewsSelection(
    els.newsFolder?.value,
    settings?.newsBookmarkFolder || settings?.defaultNewsBookmarkFolder,
  );
}

function renderOnboardingFolderStatus() {
  if (!els.folderStatus || !els.saveFolders) return;
  const selectedNews = selectedOnboardingNewsSource();
  const news = selectedNews.mode === "public" ? t("settings.bookmarks.publicFeedTitle") : selectedNews.folder;
  const selectedInspiration = selectedOnboardingInspirationSource();
  const inspiration = selectedInspiration.folder;
  const mode = selectedInspiration.mode;
  const same = selectedNews.mode === "bookmarks" && Boolean(news && news === inspiration);
  const complete = mode === "preset" || Boolean(news && inspiration && !same);
  els.saveFolders.disabled = !complete;
  if (mode === "preset") {
    setOnboardingStatus(els.folderStatus, t(news ? "onboarding.step3.presetWithNews" : "onboarding.step3.presetReady", {
      news,
      inspiration: t("settings.bookmarks.presetTitle"),
    }));
  } else if (!news || !inspiration) {
    setOnboardingStatus(els.folderStatus, t("onboarding.step3.noFolders"));
  } else if (same) {
    setOnboardingStatus(els.folderStatus, t("settings.bookmarks.same"), "error");
  } else {
    setOnboardingStatus(els.folderStatus, t("onboarding.step3.selection", { news, inspiration }));
  }
}

async function saveOnboardingFolders() {
  const selectedNews = selectedOnboardingNewsSource();
  const newsBookmarkFolder = selectedNews.folder;
  const newsSourceMode = selectedNews.mode;
  const selectedInspiration = selectedOnboardingInspirationSource();
  const inspirationBookmarkFolder = selectedInspiration.folder;
  const inspirationSourceMode = selectedInspiration.mode;
  if (newsSourceMode === "bookmarks" && inspirationSourceMode === "bookmarks"
    && (!newsBookmarkFolder || !inspirationBookmarkFolder || newsBookmarkFolder === inspirationBookmarkFolder)) return;
  els.saveFolders.disabled = true;
  setOnboardingStatus(els.folderStatus, t("onboarding.step3.saving"));
  try {
    settings = await request("settings:save", {
      newsBookmarkFolder,
      newsSourceMode,
      inspirationBookmarkFolder,
      inspirationSourceMode,
    });
    renderPermissionRows(settings.sourcePermissions || []);
    setOnboardingStatus(els.folderStatus, t("onboarding.step3.saved"), "success");
    showOnboardingPermissions();
  } catch (error) {
    setOnboardingStatus(els.folderStatus, t("onboarding.actionFailed", { message: error.message || error }), "error");
  } finally {
    const news = selectedOnboardingNewsSource();
    const inspiration = selectedOnboardingInspirationSource();
    els.saveFolders.disabled = news.mode === "bookmarks" && inspiration.mode === "bookmarks"
      && (!news.folder || !inspiration.folder || news.folder === inspiration.folder);
  }
}

function setOnboardingStatus(element, message, state = "") {
  if (!element) return;
  element.textContent = String(message || "");
  if (state) element.dataset.state = state;
  else delete element.dataset.state;
}

async function finishOnboarding(trigger) {
  if (trigger) trigger.disabled = true;
  try {
    await request("onboarding:complete");
    writeValue(ONBOARDING_PROGRESS_KEY, "");
    els.overlay.hidden = true;
    location.reload();
  } catch (error) {
    setPermissionFeedback(t("onboarding.actionFailed", { message: error.message || error }));
    if (trigger?.isConnected) trigger.disabled = false;
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

async function grantOrigins(origins, { finish = false, permissions = [], trigger = null } = {}) {
  const requested = Array.isArray(origins) ? origins.filter(Boolean) : [];
  const requestedPermissions = Array.isArray(permissions) ? permissions.filter(Boolean) : [];
  if (!requested.length && !requestedPermissions.length) {
    if (finish) await finishOnboarding(trigger);
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
    if (finish) await finishOnboarding(trigger);
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

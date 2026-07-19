import { sendExtensionRequest } from "./api.mjs";
import { getLocale, prepareLocale, setLocale, t, tc, translateDocument } from "./i18n.mjs";
import { createIcon, hydrateIcons } from "./icons.mjs";
import { permissionRowCounts, requiredUngrantedOrigins } from "./permission-ui-model.mjs";
import { INSPIRATION_PRESET_VALUE, inspirationBookmarkValue, inspirationSelectionValue, parseInspirationSelection } from "./inspiration-source-selection.mjs";
import { PUBLIC_FEED_VALUE, newsBookmarkValue, newsSelectionValue, parseNewsSelection } from "./news-source-selection.mjs";
import { hydrateStorage, readValue, writeValue } from "./storage.mjs";
import { isMicrosoftEdge, setNativeFaviconEnabled, supportsNativeFavicon } from "./urls.mjs";
import { enhanceSelectComboboxes } from "./select-combobox.mjs";
import {
  containsPermissions, removeOrigins, removePermissions,
  requestPermissionDetails, requestPermissions,
} from "./permission-client.mjs";

enhanceSelectComboboxes(document);

const ONBOARDING_PROGRESS_KEY = "dash.onboarding.progress";
const microsoftEdge = isMicrosoftEdge();
const nativeFaviconSupported = supportsNativeFavicon();

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
  aiStatus: document.querySelector("#onboardingAiStatus"),
  configureAi: document.querySelector("#onboardingConfigureAi"),
  skipAi: document.querySelector("#onboardingSkipAi"),
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
let onboardingStep = 0;
let permissionFeedback = "";
let permissionRefreshToken = 0;
let faviconPermissionGranted = null;
let faviconPermissionBusy = false;
let faviconPermissionError = "";
let browserSearchPermissionGranted = null;
let browserSearchPermissionBusy = false;
let browserSearchPermissionError = "";
let onboardingCompletionPending = false;
const lastOnboardingStep = Math.max(0, els.steps.length - 1);

setLocale(getLocale(), { persist: false });
hydrateIcons(document);
initializeExtensionUi();

async function initializeExtensionUi() {
  bindEvents();
  try {
    await hydrateStorage();
    settings = await request("settings:get");
    await prepareLocale(settings.uiLocale || getLocale());
    setLocale(settings.uiLocale || getLocale(), { persist: Boolean(settings.uiLocale), translate: false });
    translateDocument(document);
    syncOnboardingPermissionLabel();
    renderPermissionRows(settings.sourcePermissions || []);
    refreshFaviconPermission({ notify: true });
    refreshBrowserSearchPermission({ notify: true });
    syncOnboardingFolderControls();
    if (settings.onboardingCompleted !== true) showOnboarding(initialOnboardingStep());
  } catch (error) {
    renderPermissionRows([]);
    setPermissionFeedback(error.message || String(error));
  }
}

function syncOnboardingPermissionLabel() {
  const label = els.grantOnboarding?.querySelector(".btn-label");
  if (!label) return;
  const key = nativeFaviconSupported ? "onboarding.step2.grant" : "onboarding.step2.grantSites";
  label.dataset.i18n = key;
  label.textContent = t(key);
}

function bindEvents() {
  els.startOnboarding?.addEventListener("click", acceptBookmarkConsent);
  els.grantOnboarding?.addEventListener("click", (event) => grantOrigins(requiredUngrantedOrigins(permissionRows), {
    onGranted: showOnboardingAi,
    permissions: nativeFaviconSupported ? ["favicon"] : [],
    trigger: event.currentTarget,
  }));
  els.skipPermissions?.addEventListener("click", showOnboardingAi);
  els.newsFolder?.addEventListener("change", renderOnboardingFolderStatus);
  els.inspirationFolder?.addEventListener("change", handleOnboardingInspirationSelection);
  els.saveFolders?.addEventListener("click", saveOnboardingFolders);
  els.skipFolders?.addEventListener("click", showOnboardingPermissions);
  els.configureAi?.addEventListener("click", (event) => finishOnboarding(event.currentTarget, { openAiSettings: true }));
  els.skipAi?.addEventListener("click", (event) => finishOnboarding(event.currentTarget));
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
      syncOnboardingPermissionLabel();
      permissionFeedback = "";
      renderPermissionRows(permissionRows);
      renderFaviconPermission();
      renderBrowserSearchPermission();
      syncOnboardingFolderControls({ preserveSelection: true });
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
    if (permissions?.permissions?.includes("favicon")) refreshFaviconPermission({ notify: true });
    if (permissions?.permissions?.includes("search")) refreshBrowserSearchPermission({ notify: true });
  };
  chrome.permissions?.onAdded?.addListener(handleNamedPermissionChange);
  chrome.permissions?.onRemoved?.addListener(handleNamedPermissionChange);
}

function showOnboarding(index) {
  const nextStep = Math.max(0, Math.min(lastOnboardingStep, index));
  document.documentElement.classList.remove("has-first-frame-motion");
  els.overlay.dataset.stepDirection = nextStep < onboardingStep ? "back" : "forward";
  onboardingStep = nextStep;
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
  const progress = readValue(ONBOARDING_PROGRESS_KEY);
  if (progress === "ai") return 3;
  if (progress === "permissions") return 2;
  return 1;
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

function showOnboardingAi() {
  writeValue(ONBOARDING_PROGRESS_KEY, "ai");
  setOnboardingStatus(els.aiStatus, "");
  showOnboarding(3);
}

function syncOnboardingFolderControls({ preserveSelection = false } = {}) {
  if (!els.newsFolder || !els.inspirationFolder) return;
  const options = Array.isArray(settings?.bookmarkFolderOptions) ? settings.bookmarkFolderOptions : [];
  const newsSelection = preserveSelection
    ? els.newsFolder.value
    : newsSelectionValue(
      settings?.newsSourceMode,
      settings?.newsBookmarkFolder,
    );
  const inspirationSelection = preserveSelection
    ? els.inspirationFolder.value
    : inspirationSelectionValue(
      settings?.inspirationSourceMode,
      settings?.inspirationBookmarkFolder,
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
    inspirationBookmarkFolder: selection.folder,
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
  if (selected.mode === "bookmarks" && selected.folder
    && !folders.some((item) => item.name === selected.folder)) {
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
  return parseInspirationSelection(els.inspirationFolder?.value);
}

function selectedOnboardingNewsSource() {
  return parseNewsSelection(els.newsFolder?.value);
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
      publicFeedSupplementEnabled: newsSourceMode === "public",
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

async function finishOnboarding(trigger, { openAiSettings = false } = {}) {
  if (onboardingCompletionPending) return;
  onboardingCompletionPending = true;
  setOnboardingStatus(els.aiStatus, "");
  setOnboardingCompletionBusy(true);
  try {
    settings = await request("onboarding:complete");
    writeValue(ONBOARDING_PROGRESS_KEY, "");
    els.overlay.hidden = true;
    const targetUrl = new URL("dashboard.html", location.href);
    if (openAiSettings) targetUrl.searchParams.set("open", "ai-settings");
    location.replace(targetUrl.href);
  } catch (error) {
    onboardingCompletionPending = false;
    setOnboardingStatus(els.aiStatus, t("onboarding.actionFailed", { message: error.message || error }), "error");
    setOnboardingCompletionBusy(false);
    trigger?.focus({ preventScroll: true });
  }
}

function setOnboardingCompletionBusy(busy) {
  if (els.configureAi) els.configureAi.disabled = busy;
  if (els.skipAi) els.skipAi.disabled = busy;
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
      ? faviconPermissionError || t(faviconPermissionGranted === null
      ? "settings.browser.faviconChecking"
      : (faviconPermissionGranted ? "settings.browser.faviconEnabled" : "settings.browser.faviconDisabled"))
      : t("settings.browser.faviconUnsupported");
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
    els.browserSearchPermissionStatus.textContent = browserSearchPermissionError || t(browserSearchPermissionGranted === null
      ? "settings.browser.searchChecking"
      : (browserSearchPermissionGranted ? "settings.browser.searchEnabled" : "settings.browser.searchDisabled"));
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
  if (els.permissionDetails && permissionRowCounts(permissionRows).pending > 0) els.permissionDetails.open = true;
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
    const state = document.createElement("span");
    state.textContent = t(row.granted ? "permission.grantedState" : "permission.deniedState");
    copy.append(origin, state);
    const button = document.createElement("button");
    const removable = row.granted === true;
    button.className = removable ? "btn danger" : "btn";
    button.type = "button";
    button.dataset.origin = row.origin;
    button.dataset.action = removable ? "remove" : "grant";
    const buttonLabel = document.createElement("span");
    buttonLabel.className = "btn-label";
    buttonLabel.textContent = t(removable ? "permission.revoke" : "permission.grant");
    button.append(createIcon(removable ? "trash-01" : "plus", "btn-icon"), buttonLabel);
    item.append(copy, button);
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

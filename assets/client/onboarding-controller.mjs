import { t } from "./i18n.mjs";
import { readValue, writeValue } from "./storage.mjs";
import { containsPermissions, requestPermissionDetails } from "./permission-client.mjs";
import { supportsNativeFavicon } from "./urls.mjs";
import { PUBLIC_FEED_VALUE, newsBookmarkValue, newsSelectionValue } from "./news-source-selection.mjs";
import { INSPIRATION_PRESET_VALUE, inspirationBookmarkValue, inspirationSelectionValue } from "./inspiration-source-selection.mjs";
import { onboardingInitialStep, onboardingPermissionRequest, onboardingSourceMode, onboardingSourcePatch } from "./onboarding-model.mjs";

const PROGRESS_KEY = "dash.onboarding.progress";

export function createOnboardingController({ request, onSettingsChange }) {
  const overlay = document.querySelector("#onboardingOverlay");
  const find = id => overlay.querySelector(`#${id}`);
  const steps = [...overlay.querySelectorAll("[data-onboarding-step]")];
  const sources = [...overlay.querySelectorAll('input[name="onboardingSource"]')];
  const start = find("onboardingStart");
  const next = find("onboardingSaveFolders");
  const grant = find("onboardingGrantSources");
  const back = find("onboardingBack");
  const news = find("onboardingNewsFolder");
  const inspiration = find("onboardingInspirationFolder");
  const sourceStatus = find("onboardingFolderStatus");
  const permissionStatus = find("onboardingPermissionStatus");
  let settings = {}, mode = "preset", step = 0, busy = false, refreshToken = 0;
  let sourceReady = false;
  let permissionReady = false;
  const faviconSupported = supportsNativeFavicon();
  let faviconGranted = false;
  const inertSiblings = new Map();

  function permissionRequest() {
    return onboardingPermissionRequest(settings.onboardingSourcePermissions, { faviconSupported, faviconGranted });
  }

  function readFaviconPermission() {
    return faviconSupported ? containsPermissions(["favicon"]) : Promise.resolve(false);
  }

  function updateSettings(value) {
    settings = value;
    onSettingsChange(value);
  }

  function setStatus(element, message = "", state = "") {
    element.textContent = message;
    element.hidden = !message;
    element.dataset.state = state;
  }

  function setBusy(value) {
    busy = value;
    overlay.setAttribute("aria-busy", String(value));
    overlay.querySelectorAll("button, input, select").forEach(element => { element.disabled = value; });
    render();
  }

  function fillSelect(select, preset, selected, encode, labelKey) {
    const items = [{ value: preset, label: t(labelKey) }, ...(settings.bookmarkFolderOptions || []).map(item => ({
      value: encode(item.name), label: t("settings.bookmarks.folderOption", { name: item.name, count: item.count }),
    }))];
    select.replaceChildren(...items.map(({ value, label }) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      return option;
    }));
    select.value = items.some(item => item.value === selected) ? selected : preset;
  }

  function fillFolders(preserve = false) {
    fillSelect(news, PUBLIC_FEED_VALUE,
      preserve ? news.value : newsSelectionValue(settings.newsSourceMode, settings.newsBookmarkFolder),
      newsBookmarkValue, "settings.bookmarks.publicFeedTitle");
    fillSelect(inspiration, INSPIRATION_PRESET_VALUE,
      preserve ? inspiration.value : inspirationSelectionValue(settings.inspirationSourceMode, settings.inspirationBookmarkFolder),
      inspirationBookmarkValue, "settings.bookmarks.presetTitle");
  }

  function row(origin) {
    const element = document.createElement("div");
    element.className = "onboarding-origin";
    element.textContent = origin.replace(/\/$/, "").replace(/\/\*$/, "");
    return element;
  }

  function renderOrigins() {
    const rows = settings.onboardingSourcePermissions || [];
    find("onboardingOrigins").replaceChildren(...rows.slice(0, 3).map(item => row(item.origin)));
    find("onboardingRemainingOrigins").replaceChildren(...rows.slice(3).map(item => row(item.origin)));
    find("onboardingMoreOrigins").hidden = rows.length <= 3;
    find("onboardingMoreLabel").textContent = t("onboarding.sites.more", { count: Math.max(0, rows.length - 3) });
    find("onboardingOriginCount").textContent = t("onboarding.sites.count", { count: rows.length });
    find("onboardingOriginSource").textContent = t(mode === "preset" ? "settings.bookmarks.publicFeedTitle" : "onboarding.sites.bookmarks");
    find("onboardingFaviconNotice").hidden = !faviconSupported;
    const pending = Object.keys(permissionRequest()).length;
    grant.querySelector(".btn-label").textContent = t(pending ? "onboarding.sites.grant" : "onboarding.sites.enter");
  }

  function render() {
    const personal = mode === "bookmarks";
    const consent = settings.bookmarkConsentGranted === true;
    const folders = settings.bookmarkFolderOptions || [];
    const patch = onboardingSourcePatch(mode, news.value, inspiration.value);
    sources.forEach(input => { input.checked = input.value === mode; });
    find("onboardingPublicDetails").hidden = personal;
    find("onboardingBookmarkConsent").hidden = !personal || consent;
    find("onboardingFolderFields").hidden = !personal || !consent || !folders.length;
    find("onboardingNoFolders").hidden = !personal || !consent || folders.length > 0;
    const invalid = personal && consent && folders.length > 0 && !patch;
    start.disabled = busy || !sourceReady;
    next.disabled = busy || invalid || !sourceReady;
    grant.disabled = busy || !permissionReady;
    back.disabled = busy;
    next.querySelector(".btn-label").textContent = t(personal && !consent ? "onboarding.sources.read"
      : personal && !folders.length ? "onboarding.sources.usePreset" : "onboarding.sources.next");
    if (invalid) setStatus(sourceStatus, t("settings.bookmarks.same"), "error");
    steps.forEach((element, index) => {
      element.hidden = step !== index;
      element.classList.toggle("active", step === index);
    });
    find("onboardingBrand").hidden = step !== 0;
    back.hidden = step === 0;
    const backLabel = find("onboardingBackLabel");
    backLabel.dataset.i18n = step === 1 ? "onboarding.welcome.back" : "onboarding.sources.back";
    backLabel.textContent = t(backLabel.dataset.i18n);
    find("onboardingCurrentStep").textContent = String(step + 1);
    const progress = find("onboardingProgress");
    progress.setAttribute("aria-valuenow", String(step + 1));
    progress.setAttribute("aria-valuetext", t("onboarding.progressStep", { current: step + 1, total: steps.length }));
    overlay.setAttribute("aria-labelledby", steps[step].querySelector("h1").id);
    renderOrigins();
  }

  function show(index) {
    overlay.dataset.stepDirection = index < step ? "back" : "forward";
    step = index;
    document.documentElement.classList.remove("has-first-frame-motion");
    overlay.hidden = false;
    const ownedPopovers = new Set([...overlay.querySelectorAll("[aria-controls]")]
      .map(element => element.getAttribute("aria-controls")));
    for (const sibling of overlay.parentElement.children) {
      if (sibling === overlay || ownedPopovers.has(sibling.id) || /^(SCRIPT|STYLE|LINK)$/.test(sibling.tagName)) continue;
      if (!inertSiblings.has(sibling)) inertSiblings.set(sibling, sibling.inert);
      sibling.inert = true;
    }
    render();
    steps[step].querySelector("h1").focus({ preventScroll: true });
  }

  async function initialize(value) {
    updateSettings(value);
    faviconGranted = await readFaviconPermission();
    sourceReady = true;
    permissionReady = true;
    mode = onboardingSourceMode(settings);
    fillFolders();
    translate();
    if (settings.onboardingCompleted !== true) {
      show(onboardingInitialStep(readValue(PROGRESS_KEY)));
    }
  }

  function translate() {
    fillFolders(true);
    const catalog = settings.onboardingPublicSources || [];
    find("onboardingPublicCount").textContent = t("onboarding.sources.list", { count: catalog.length });
    find("onboardingPublicList").replaceChildren(...catalog.map(item => {
      const element = document.createElement("li");
      element.textContent = item.title;
      return element;
    }));
    render();
  }

  async function refreshPermissions() {
    if (overlay.hidden || busy || step !== 2) return;
    const token = ++refreshToken;
    permissionReady = false;
    render();
    try {
      const [value, hasFavicon] = await Promise.all([request("settings:get"), readFaviconPermission()]);
      if (token !== refreshToken || busy || step !== 2) return;
      updateSettings(value);
      faviconGranted = hasFavicon;
      permissionReady = true;
      render();
    } catch (error) {
      if (token !== refreshToken) return;
      setStatus(permissionStatus, t("onboarding.actionFailed", { message: error.message || error }), "error");
    }
  }

  async function advance() {
    if (busy || step !== 1 || !sourceReady) return;
    ++refreshToken;
    setBusy(true);
    setStatus(sourceStatus);
    try {
      if (mode === "bookmarks" && settings.bookmarkConsentGranted !== true) {
        updateSettings(await request("onboarding:consent"));
        fillFolders();
        if ((settings.bookmarkFolderOptions || []).length && news.value === PUBLIC_FEED_VALUE) {
          news.value = newsBookmarkValue(settings.bookmarkFolderOptions[0].name);
        }
        return;
      }
      if (mode === "bookmarks" && !settings.bookmarkFolderOptions?.length) mode = "preset";
      const patch = onboardingSourcePatch(mode, news.value, inspiration.value);
      if (!patch) return;
      const [value, hasFavicon] = await Promise.all([request("settings:save", patch), readFaviconPermission()]);
      updateSettings(value);
      faviconGranted = hasFavicon;
      permissionReady = true;
      writeValue(PROGRESS_KEY, "permissions");
      setStatus(permissionStatus);
      show(2);
    } catch (error) {
      setStatus(sourceStatus, t("onboarding.actionFailed", { message: error.message || error }), "error");
    } finally {
      setBusy(false);
    }
  }

  async function complete() {
    await request("onboarding:complete");
    writeValue(PROGRESS_KEY, "");
    for (const [sibling, inert] of inertSiblings) sibling.inert = inert;
    inertSiblings.clear();
    overlay.hidden = true;
    location.replace(new URL("dashboard.html", location.href).href);
  }

  async function finish() {
    if (busy || step !== 2 || !permissionReady) return;
    ++refreshToken;
    setBusy(true);
    const status = permissionStatus;
    setStatus(status);
    try {
      const details = permissionRequest();
      // Keep the browser request on the initiating user gesture; the scope was prepared by settings:save.
      if (Object.keys(details).length && !await requestPermissionDetails(details)) {
        setStatus(status, t("onboarding.sites.declined"), "error");
        return;
      }
      const [value, hasFavicon] = await Promise.all([request("settings:get"), readFaviconPermission()]);
      updateSettings(value);
      faviconGranted = hasFavicon;
      if (Object.keys(permissionRequest()).length) {
        setStatus(status, t("onboarding.sites.declined"), "error");
        return;
      }
      await complete();
    } catch (error) {
      setStatus(status, t("onboarding.actionFailed", { message: error.message || error }), "error");
    } finally {
      setBusy(false);
    }
  }

  sources.forEach(input => input.addEventListener("change", () => {
    mode = input.value;
    setStatus(sourceStatus);
    render();
  }));
  for (const select of [news, inspiration]) select.addEventListener("change", () => { setStatus(sourceStatus); render(); });
  start.addEventListener("click", () => {
    if (busy || step !== 0 || !sourceReady) return;
    writeValue(PROGRESS_KEY, "sources");
    show(1);
  });
  next.addEventListener("click", advance);
  grant.addEventListener("click", finish);
  back.addEventListener("click", () => {
    if (busy || step === 0) return;
    ++refreshToken;
    writeValue(PROGRESS_KEY, step === 2 ? "sources" : "welcome");
    show(step - 1);
  });
  overlay.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (!busy && step > 0) back.click();
    }
    if (event.key !== "Tab") return;
    const controls = [...overlay.querySelectorAll("button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [role='combobox']")]
      .filter(element => element.getClientRects().length && !element.closest("[hidden]")
        && (element.type !== "radio" || element.checked));
    if (!controls.length) { event.preventDefault(); return; }
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && (document.activeElement === first || document.activeElement.tagName === "H1")) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  return { initialize, translate, refreshPermissions };
}

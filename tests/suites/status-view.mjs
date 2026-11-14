import assert from "node:assert/strict";
import { createStatusView } from "../../assets/client/status-view.mjs";

export function runStatusViewTests() {
  const state = { data: { ai: { enabled: true }, organization: { available: true, running: false } } };
  const els = Object.fromEntries([
    "organizeNews", "refresh", "settingsRefresh", "settingsOverviewTitle",
    "settingsOverviewMeta", "settingsQuotaStatus", "settingsQuotaMeter", "settingsCacheOverviewStatus",
    "settingsCacheOverviewDetail", "settingsCacheLoadingIcon", "settingsAutoAiStatus", "settingsAutoAiDetail",
  ].map(name => [name, createElement()]));
  const cacheItem = createElement();
  els.settingsCacheOverviewStatus.closest = () => cacheItem;
  let locale = "zh-CN";
  const t = key => `${locale}:${key}`;
  const { renderStatus, renderOverviewStatus } = createStatusView({
    state, els, t, formatDateTime: value => value, localizedStatusMessage: () => "",
    localizedErrorMessage: error => t(error.messageKey),
    setIconLabel(node, name, text) {
      const key = { sparkling: "stars-01", synchronize: "refresh-cw-01" }[name] || name;
      node.children = [createElement(`btn-icon icon-${key}`), createElement("btn-label")];
      node.children[1].textContent = text;
    },
  });
  const button = els.organizeNews;
  renderStatus();
  assert.equal(els.settingsOverviewTitle.hidden, true, "normal overview updates must not show a repeated service heading");
  assert.equal(els.settingsOverviewTitle.textContent, "");
  const idleIcon = button.children[0], idleLabel = button.children[1];
  for (let i = 0; i < 5; i++) renderStatus();
  assert.equal(button.children[0], idleIcon, "background progress must not reload the idle organization icon");
  assert.equal(button.children[1], idleLabel, "unchanged status must retain the label node");
  assert.equal(button.disabled, false);

  state.newsOrganizeRequest = true;
  renderStatus();
  const spinner = button.children[0], label = button.children[1];
  assert.notEqual(spinner, idleIcon, "starting organization must display its running icon");
  assert.equal(button.disabled, true);
  assert.equal(button.attributes.get("aria-busy"), "true");
  assert.equal(button.classList.contains("is-loading"), true);
  assert.equal(label.textContent, t("action.organizing"));
  for (let i = 0; i < 5; i++) {
    state.data.organization.processed = i;
    renderStatus();
  }
  assert.equal(button.children[0], spinner, "progress updates must preserve the active animation's DOM node");
  state.data.organization.running = true;
  state.newsOrganizeRequest = false;
  renderStatus();
  assert.equal(button.children[0], spinner, "handoff from local request to background work must not restart the spinner");

  locale = "en";
  renderStatus();
  assert.equal(button.children[0], spinner, "changing language must preserve the running animation");
  assert.equal(button.children[1], label);
  assert.equal(label.textContent, t("action.organizing"));
  state.data.organization.running = false;
  renderStatus();
  const completedIcon = button.children[0];
  assert.notEqual(completedIcon, spinner);
  assert.equal(button.disabled, false);
  assert.equal(button.attributes.get("aria-busy"), "false");
  assert.equal(button.classList.contains("is-loading"), false);
  assert.equal(button.children[1].textContent, t("action.organizeNews"));
  state.data.organization = { provider: "bot", available: false, running: false };
  renderStatus();
  assert.equal(button.children[0], completedIcon, "availability changes must not reload an unchanged icon");
  assert.equal(button.disabled, true);
  assert.equal(button.title, t("bot.connectFirst"));

  state.data.cache = { configuredSources: 2, refreshableSources: 0 };
  renderStatus();
  for (const refresh of [els.refresh, els.settingsRefresh]) {
    assert.equal(refresh.disabled, true);
    assert.equal(refresh.attributes.get("title"), t("status.refreshUnavailable.permission"), "unavailable refresh actions must retain an accessible reason without a separate caption");
    assert.equal(refresh.attributes.get("aria-busy"), "false");
  }
  assert.equal(els.settingsCacheOverviewDetail.textContent, t("status.refreshUnavailable.permission"));
  assert.equal(cacheItem.attributes.get("data-state"), "unavailable");

  state.data.status = { running: true, progress: 0.5 };
  renderStatus();
  for (const refresh of [els.refresh, els.settingsRefresh]) {
    assert.equal(refresh.disabled, true);
    assert.equal(refresh.children[1].textContent, t("status.caching"));
    assert.equal(refresh.attributes.get("aria-busy"), "true");
    assert.equal(refresh.attributes.has("title"), false, "the caching label must not repeat a stale prerequisite hint");
  }
  assert.equal(els.settingsCacheOverviewDetail.textContent, t("settings.overview.cacheProgress"));
  assert.equal(cacheItem.attributes.get("data-state"), "running");

  state.data.status.running = false;
  state.data.cache.refreshableSources = 2;
  renderStatus();
  for (const refresh of [els.refresh, els.settingsRefresh]) {
    assert.equal(refresh.disabled, false);
    assert.equal(refresh.children[1].textContent, t("action.refreshNews"));
    assert.equal(refresh.attributes.get("aria-busy"), "false");
    assert.equal(refresh.attributes.has("title"), false);
  }
  state.data.organization = null;
  const originalMatchMedia = Object.getOwnPropertyDescriptor(globalThis, "matchMedia");
  try {
    Object.defineProperty(globalThis, "matchMedia", { configurable: true, value: () => ({ matches: true }) });
    state.data.status.running = true;
    renderStatus();
    els.settingsRefresh.children[0].addEventListener = () => assert.fail("reduced motion must not wait for a spinner iteration that never occurs");
    state.data.status.running = false;
    renderStatus();
    assert.equal(els.settingsRefresh.classList.contains("is-loading"), false);
    assert.equal(els.settingsRefresh.classList.contains("is-spinner-stopping"), false);
    assert.equal(els.settingsRefresh.children[1].textContent, t("action.refreshNews"));
  } finally {
    if (originalMatchMedia) Object.defineProperty(globalThis, "matchMedia", originalMatchMedia);
    else delete globalThis.matchMedia;
  }
  state.data.ai = { enabled: true, configured: true, disclosureAccepted: true, permissionGranted: true, autoStatus: { phase: "no-candidates" } };
  renderStatus();
  assert.equal(els.settingsOverviewMeta.hidden, true);
  assert.equal(els.settingsAutoAiDetail.hidden, true, "empty work queues must not show a repeated zero-count explanation");
  assert.equal(els.settingsCacheOverviewDetail.hidden, true, "a ready cache without a timestamp needs no empty record caption");
  assert.equal(cacheItem.attributes.get("data-state"), "ready");
  state.data.ai.autoStatus = { phase: "error", errorStage: "cards", errorKey: "synthetic.failure" };
  renderStatus();
  assert.equal(els.settingsAutoAiDetail.hidden, false, "a later error must reveal its reason after a quiet state");
  assert.equal(els.settingsAutoAiDetail.textContent, t("settings.auto.errorDetail"));

  renderOverviewStatus(t("status.refreshRequestFailed"), "Synthetic request error");
  assert.equal(els.settingsOverviewTitle.hidden, false, "request failures must still reveal their title");
  assert.equal(els.settingsOverviewTitle.textContent, t("status.refreshRequestFailed"));
  assert.equal(els.settingsOverviewMeta.hidden, false);
  assert.equal(els.settingsOverviewMeta.textContent, "Synthetic request error");
  renderStatus();
  assert.equal(els.settingsOverviewTitle.hidden, true, "a recovered overview must clear the transient error heading");
  assert.equal(els.settingsOverviewTitle.textContent, "");
  assert.equal(els.settingsOverviewMeta.hidden, true);
  renderOverviewStatus("", "Synthetic request detail");
  assert.equal(els.settingsOverviewTitle.hidden, true);
  assert.equal(els.settingsOverviewMeta.hidden, false, "a standalone request detail must remain visible");

  for (const [usedToday, dailyLimit, label, value, limit, progress, exhausted] of [
    [68, 160, "68 / 160", "68", "160", "42.5%", "false"],
    [160, 160, "160 / 160", "160", "160", "100%", "true"],
    [180, 160, "180 / 160", "160", "160", "100%", "true"],
    [-4, 0, "0 / 1", "0", "1", "0%", "false"],
    [3.9, 8.9, "3 / 8", "3", "8", "37.5%", "false"],
    [NaN, Infinity, "0 / 160", "0", "160", "0%", "false"],
  ]) {
    Object.assign(state.data.ai, { usedToday, dailyLimit });
    renderStatus();
    assert.equal(els.settingsQuotaStatus.textContent, label, "quota copy must retain actual usage even above the limit");
    assert.equal(els.settingsQuotaMeter.attributes.get("aria-valuenow"), value);
    assert.equal(els.settingsQuotaMeter.attributes.get("aria-valuemax"), limit);
    assert.equal(els.settingsQuotaMeter.attributes.get("aria-valuetext"), label);
    assert.equal(els.settingsQuotaMeter.style.getPropertyValue("--settings-quota-progress"), progress, "quota bars must remain within their track for invalid or over-limit data");
    assert.equal(els.settingsQuotaMeter.dataset.exhausted, exhausted, "quota warning must clear when usage returns below the limit");
  }
}

function createElement(className = "") {
  const classes = new Set(className.split(" ").filter(Boolean));
  const properties = new Map();
  return {
    children: [], dataset: {}, attributes: new Map(), textContent: "",
    style: {
      setProperty(name, value) { properties.set(name, String(value)); },
      getPropertyValue(name) { return properties.get(name) || ""; },
    },
    classList: {
      contains: name => classes.has(name),
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      toggle(name, active) { if (active) classes.add(name); else classes.delete(name); },
    },
    closest: () => null,
    querySelector(selector) { return this.children.find(node => node.classList.contains(selector.slice(1))) || null; },
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    removeAttribute(name) { this.attributes.delete(name); },
  };
}

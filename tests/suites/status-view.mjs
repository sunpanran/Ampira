import assert from "node:assert/strict";
import { createStatusView } from "../../assets/client/status-view.mjs";

export function runStatusViewTests() {
  const state = { data: { ai: { enabled: true }, organization: { available: true, running: false } } };
  const els = Object.fromEntries([
    "organizeNews", "refresh", "settingsRefresh", "refreshAvailability", "settingsOverviewTitle",
    "settingsOverviewMeta", "settingsQuotaStatus", "settingsQuotaDetail", "settingsCacheOverviewStatus",
    "settingsCacheOverviewDetail", "settingsCacheLoadingIcon", "settingsAutoAiStatus", "settingsAutoAiDetail",
    "settingsCacheStatus",
  ].map(name => [name, createElement()]));
  let locale = "zh-CN";
  const t = key => `${locale}:${key}`;
  const { renderStatus } = createStatusView({
    state, els, t, formatDateTime: value => value, localizedStatusMessage: () => "",
    setIconLabel(node, name, text) {
      const key = { sparkling: "stars-01", synchronize: "refresh-cw-01" }[name] || name;
      node.children = [createElement(`btn-icon icon-${key}`), createElement("btn-label")];
      node.children[1].textContent = text;
    },
  });
  const button = els.organizeNews;
  renderStatus();
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
}

function createElement(className = "") {
  const classes = new Set(className.split(" ").filter(Boolean));
  return {
    children: [], dataset: {}, attributes: new Map(), textContent: "",
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

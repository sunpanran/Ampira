import assert from "node:assert/strict";
import { createWeatherCardView } from "../../assets/client/weather-card-view.mjs";
import { WEATHER_LOCATION_KEY, normalizeWeatherLocation } from "../../assets/client/utility-card-model.mjs";
import { translate } from "../helpers/full-i18n.mjs";

export async function runWeatherCityMenuTests() {
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  const doc = { createElement: tag => new TestNode(tag, doc) };
  Object.defineProperty(globalThis, "document", { configurable: true, value: doc });
  try {
    for (const [locale, label] of [["zh-CN", "切换城市"], ["zh-Hant", "切換城市"], ["en", "Change city"]]) {
      await checkCityMenu(doc, locale, label);
    }
  } finally {
    if (original) Object.defineProperty(globalThis, "document", original);
    else delete globalThis.document;
  }
}

async function checkCityMenu(doc, locale, label) {
  const initial = normalizeWeatherLocation({ name: "Beijing", latitude: 39.9, longitude: 116.4, countryCode: "CN" });
  const next = normalizeWeatherLocation({ name: "Shanghai", latitude: 31.2, longitude: 121.5, countryCode: "CN" });
  const state = { weatherLocation: initial };
  const writes = [], requests = [];
  let rendered, active = true, granted = true, permissions = 0, invalidations = 0, resolveSearch;
  const view = createWeatherCardView({
    state, t: (key, params) => translate(locale, key, params), getLocale: () => locale,
    createIcon: () => doc.createElement("img"), createEmptyState: () => doc.createElement("div"),
    request: message => { requests.push(message); return new Promise(resolve => { resolveSearch = resolve; }); },
    writeJson: (key, value) => writes.push([key, value]), writeValue() {},
    requestWeatherPermissions: async () => { permissions += 1; return granted; },
    localizedErrorMessage: error => error.message,
    weatherState: { read: () => ({}), ensure() {}, invalidate: () => { invalidations += 1; } },
    requestRender: () => { rendered = view.render(); }, isActive: () => active,
  });
  const change = view.contextActions()[0];
  assert.equal(change.label, label);
  change.action();
  const editor = rendered.content;
  const [input, submit] = editor.children[0].children;
  assert.equal(doc.activeElement, input, "opening from the menu focuses the existing city editor");
  assert.equal(input.value, initial.name);
  assert.equal(writes.length + requests.length + permissions, 0, "opening the editor must not save or request permissions");

  input.value = "Shanghai"; await input.emit("input");
  change.action();
  assert.equal(rendered.content, editor);
  assert.equal(input.value, "Shanghai", "reopening the menu preserves the current draft");
  assert.equal(submit.disabled, false);
  const search = editor.children[0].emit("submit");
  await Promise.resolve();
  assert.deepEqual(requests, [{ type: "weather:search", payload: { query: "Shanghai", locale } }]);
  assert(input.disabled && submit.disabled);
  change.action();
  assert.equal(input.value, "Shanghai", "reopening during a search preserves its query");
  assert.equal(permissions, 1, "reopening does not duplicate the permission request or search");
  resolveSearch({ locations: [next] }); await search;
  const results = editor.children.find(node => node.className.includes("weather-location-list"));
  change.action();
  assert(editor.children.includes(results), "reopening preserves completed search results");
  await results.children[0].emit("click");
  assert.deepEqual(state.weatherLocation, next);
  assert.deepEqual(writes, [[WEATHER_LOCATION_KEY, next]], "selection uses the existing city persistence path");
  assert.equal(invalidations, 1, "selection refreshes shared weather data");
  assert.notEqual(rendered.content, editor);
  change.action(); assert.equal(input.value, next.name, "the next edit starts with the newly selected city");

  granted = false;
  await editor.children[0].emit("submit");
  assert.equal(requests.length, 1, "denied permission must not search or change the saved city");
  assert.deepEqual(state.weatherLocation, next);
  assert.equal(editor.children[1].textContent, translate(locale, "weather.permission.declined"));
  assert.equal(input.disabled, false);

  granted = true;
  const pending = editor.children[0].emit("submit"); await Promise.resolve();
  active = false; view.deactivate();
  resolveSearch({ locations: [initial] }); await pending;
  active = true; change.action();
  assert.equal(input.value, next.name);
  assert.equal(editor.children.length, 1, "leaving the card discards late search results");
  assert.equal(input.disabled, false);
  assert.equal(writes.length, 1);
}

class TestNode {
  constructor(tag, doc) {
    Object.assign(this, { tag, doc, children: [], listeners: {}, className: "", value: "", attributes: {} });
    this.classList = { toggle() {} };
  }
  append(...nodes) { for (const node of nodes) { node.parentElement = this; this.children.push(node); } }
  remove() { this.parentElement.children = this.parentElement.children.filter(node => node !== this); }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }
  focus() { if (!this.disabled) this.doc.activeElement = this; }
  async emit(type) { for (const callback of this.listeners[type] || []) await callback({ preventDefault() {} }); }
}

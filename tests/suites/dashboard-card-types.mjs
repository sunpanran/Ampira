import assert from "node:assert/strict";
import { DASHBOARD_CARD_TYPES, DASHBOARD_CARD_TYPES_KEY, CARD_TYPE_ICONS, normalizeDashboardCardTypes, todoCardTarget } from "../../assets/client/dashboard-card-types.mjs";
import { DASHBOARD_CARD_IDS, swapDashboardCards } from "../../extension/core/dashboard-layout.mjs";
import { createWeatherCardState } from "../../assets/client/weather-card-state.mjs";

export async function runDashboardCardTypeTests() {
  assert.equal(DASHBOARD_CARD_TYPES_KEY, "dash.dashboard.cardTypes.v1");
  assert.deepEqual(DASHBOARD_CARD_TYPES, ["news", "digest", "inspiration", "queue", "todo", "events", "weather", "stocks", "countdown", "archive"]);
  assert.notEqual(CARD_TYPE_ICONS.todo, CARD_TYPE_ICONS.archive, "to-dos must have a distinct checklist icon");
  const defaults = { utility: "events", digest: "digest", archive: "archive", news: "news", inspiration: "inspiration", queue: "queue" };
  assert.deepEqual(normalizeDashboardCardTypes(null, "weather"), { ...defaults, utility: "weather" });
  assert.deepEqual(normalizeDashboardCardTypes({}, "invalid"), defaults);
  assert.deepEqual(normalizeDashboardCardTypes({ utility: "archive", digest: "invalid", archive: "todo", news: "weather" }, "weather"),
    { ...defaults, utility: "archive", archive: "todo", news: "weather" });
  assert.deepEqual(normalizeDashboardCardTypes({ utility: "countdown", digest: "todo", archive: "weather" }),
    { ...defaults, utility: "countdown", digest: "todo", archive: "weather" }, "existing three-card settings must gain the original large-card defaults without resetting saved types");
  for (const type of DASHBOARD_CARD_TYPES) {
    const saved = Object.fromEntries(DASHBOARD_CARD_IDS.map(id => [id, type]));
    assert.deepEqual(normalizeDashboardCardTypes(JSON.parse(JSON.stringify(saved)), "events"), saved, "duplicate types survive a storage round trip");
  }
  const types = { utility: "digest", digest: "todo", archive: "todo" };
  const order = swapDashboardCards(DASHBOARD_CARD_IDS, "digest", "archive");
  assert.equal(todoCardTarget(types, order, "digest"), "digest", "a focused to-do instance wins");
  assert.equal(todoCardTarget(types, order, "news"), "archive", "otherwise use the first to-do in visual order");
  assert.equal(todoCardTarget({ ...defaults, news: "todo" }, order, "news"), "news", "large-card instances support the same to-do keyboard shortcut");
  assert.equal(todoCardTarget({ utility: "weather", digest: "digest", archive: "archive" }, order, "archive"), "utility");
  assert.deepEqual(types, { utility: "digest", digest: "todo", archive: "todo" }, "layout swaps must not rewrite instance types");
  await testSharedWeather();
}

async function testSharedWeather() {
  const city = latitude => ({ name: "Fixture", latitude, longitude: 121, countryCode: "CN" });
  const state = { weatherLocation: city(31) };
  const requests = [];
  let notifications = 0;
  const weather = createWeatherCardState({
    state, localizedErrorMessage: error => error.message, notify: () => { notifications += 1; },
    apiPost: (url, payload) => new Promise((resolve, reject) => requests.push({ url, payload, resolve, reject })),
  });
  const forecast = (label, extra = {}) => ({ label, fetchedAt: new Date().toISOString(), ...extra });
  const first = weather.ensure();
  assert.equal(weather.ensure(), first, "multiple weather instances share the same pending request");
  await Promise.resolve();
  assert.equal(requests.length, 1);
  assert(weather.read().busy);
  requests[0].resolve(forecast("first")); await first;
  assert.equal(weather.read().forecast.label, "first");
  await weather.ensure(); assert.equal(requests.length, 1, "fresh shared data must not be refetched on mode changes");
  weather.invalidate();
  const obsolete = weather.ensure(); await Promise.resolve();
  state.weatherLocation = city(32);
  const current = weather.ensure(); await Promise.resolve();
  requests[2].resolve(forecast("new-city")); await current;
  requests[1].resolve(forecast("old-city")); await obsolete;
  assert.equal(weather.read().forecast.label, "new-city", "a prior city's response must not replace the active city's data");
  weather.invalidate();
  const denied = weather.ensure(); await Promise.resolve();
  requests[3].reject(Object.assign(new Error("Permission required"), { code: "WEATHER_PERMISSION_REQUIRED" })); await denied;
  assert.equal(weather.read().error.code, "WEATHER_PERMISSION_REQUIRED");
  await weather.ensure(); assert.equal(requests.length, 4, "rendering an error must not loop requests");
  const retried = weather.retry(); assert.equal(weather.retry(), retried); await Promise.resolve();
  requests[4].resolve(forecast("stale", { stale: true })); await retried;
  await weather.ensure(); assert.equal(requests.length, 5, "a stale response remains readable without a retry loop");
  const staleRetry = weather.ensure({ retryStale: true }); await Promise.resolve();
  requests[5].resolve(forecast("fresh")); await staleRetry;
  weather.invalidate();
  const revoked = weather.ensure(); await Promise.resolve();
  weather.invalidate();
  requests[6].resolve(forecast("revoked")); await revoked;
  assert.equal(weather.read().forecast, null, "permission invalidation must reject an already pending response");
  assert(notifications > 0);
}

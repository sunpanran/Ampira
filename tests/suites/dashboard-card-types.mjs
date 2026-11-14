import assert from "node:assert/strict";
import { DASHBOARD_CARD_GROUPS, DASHBOARD_CARD_TYPES, DASHBOARD_CARD_TYPES_KEY, CARD_TYPE_ICONS, CARD_TYPE_TITLES, normalizeDashboardCardTypes, todoCardTarget } from "../../assets/client/dashboard-card-types.mjs";
import { DASHBOARD_CARD_IDS, swapDashboardCards } from "../../extension/core/dashboard-layout.mjs";
import { createWeatherCardState, defaultWeatherLocation } from "../../assets/client/weather-card-state.mjs";

export async function runDashboardCardTypeTests() {
  assert.equal(DASHBOARD_CARD_TYPES_KEY, "dash.dashboard.cardTypes.v1");
  assert.deepEqual([...DASHBOARD_CARD_TYPES].sort(), ["news", "digest", "inspiration", "queue", "todo", "notes", "worldClock", "focus", "topics", "events", "calendar", "weather", "stocks", "countdown", "archive"].sort(), "grouping must keep every card type available exactly once");
  assert(DASHBOARD_CARD_GROUPS.find(group => group.labelKey === "utility.group.life").types.includes("calendar"));
  assert.equal(new Set(DASHBOARD_CARD_GROUPS.map(group => group.labelKey)).size, DASHBOARD_CARD_GROUPS.length);
  for (const group of DASHBOARD_CARD_GROUPS) {
    assert(group.types.length > 0, "categories must not be empty");
    for (const type of group.types) assert(CARD_TYPE_ICONS[type] && CARD_TYPE_TITLES[type]);
  }
  assert.notEqual(CARD_TYPE_ICONS.todo, CARD_TYPE_ICONS.archive, "to-dos must have a distinct checklist icon");
  const defaults = { utility: "weather", digest: "digest", archive: "todo", news: "news", inspiration: "inspiration", queue: "queue" };
  assert.deepEqual(normalizeDashboardCardTypes(), defaults, "new dashboards show weather, digest and to-dos beside news, inspiration and the reading queue");
  assert.deepEqual(normalizeDashboardCardTypes(null, null), defaults, "missing storage uses the default card types");
  for (const legacyMode of ["events", "weather", "todo"]) {
    assert.deepEqual(normalizeDashboardCardTypes(null, legacyMode), { ...defaults, utility: legacyMode }, "valid legacy utility choices must be preserved");
  }
  assert.deepEqual(normalizeDashboardCardTypes({}, "invalid"), defaults);
  assert.deepEqual(normalizeDashboardCardTypes({ utility: "invalid", archive: "invalid" }), defaults, "invalid saved types fall back to the new defaults");
  const previousDefaults = { ...defaults, utility: "events", archive: "archive" };
  assert.deepEqual(normalizeDashboardCardTypes(previousDefaults), previousDefaults, "explicitly saved card types must not be replaced by new defaults");
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
  assert.equal(todoCardTarget(defaults, DASHBOARD_CARD_IDS, "utility"), "archive", "the default to-do shortcut targets the lower compact card");
  assert.equal(todoCardTarget(types, order, "digest"), "digest", "a focused to-do instance wins");
  assert.equal(todoCardTarget(types, order, "news"), "archive", "otherwise use the first to-do in visual order");
  assert.equal(todoCardTarget({ ...defaults, news: "todo" }, order, "news"), "news", "large-card instances support the same to-do keyboard shortcut");
  assert.equal(todoCardTarget({ utility: "weather", digest: "digest", archive: "archive" }, order, "archive"), "utility");
  assert.deepEqual(types, { utility: "digest", digest: "todo", archive: "todo" }, "layout swaps must not rewrite instance types");
  await testSharedWeather();
  await testDefaultWeather();
  await testWeatherRecovery();
}

async function testSharedWeather() {
  let currentTime = Date.now();
  const city = latitude => ({ name: "Fixture", latitude, longitude: 121, countryCode: "CN" });
  const state = { weatherLocation: city(31) };
  const requests = [];
  let notifications = 0;
  const weather = createWeatherCardState({
    now: () => currentTime,
    state, localizedErrorMessage: error => error.message, notify: () => { notifications += 1; },
    request: ({ type, payload }) => new Promise((resolve, reject) => requests.push({ type, payload, resolve, reject })),
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
  await weather.ensure({ retryStale: true });
  assert.equal(requests.length, 5, "stale cache retries must also respect the cooldown");
  currentTime += 60_000;
  const staleRetry = weather.ensure({ retryStale: true }); await Promise.resolve();
  requests[5].resolve(forecast("fresh")); await staleRetry;
  weather.invalidate();
  const revoked = weather.ensure(); await Promise.resolve();
  weather.invalidate();
  requests[6].resolve(forecast("revoked")); await revoked;
  assert.equal(weather.read().forecast, null, "permission invalidation must reject an already pending response");
  assert(notifications > 0);
}

async function testDefaultWeather() {
  const state = { weatherLocation: null };
  let locale = "zh-CN";
  const requests = [];
  const weather = createWeatherCardState({
    state, getLocale: () => locale, notify() {}, localizedErrorMessage: error => error.message,
    request: ({ type, payload }) => new Promise(resolve => requests.push({ type, payload, resolve })),
  });
  const first = weather.ensure();
  await Promise.resolve();
  assert.deepEqual(requests[0].payload, { latitude: 39.9075, longitude: 116.39723, countryCode: "CN" });
  assert.equal(state.weatherLocation, null, "the fallback must not be saved as a user-selected city");
  locale = "en";
  const second = weather.ensure();
  await Promise.resolve();
  assert.deepEqual(requests[1].payload, { latitude: 51.50853, longitude: -0.12574, countryCode: "GB" });
  requests[1].resolve({ city: "London", fetchedAt: new Date().toISOString() }); await second;
  requests[0].resolve({ city: "Beijing", fetchedAt: new Date().toISOString() }); await first;
  assert.equal(weather.read().forecast.city, "London", "a late response for the previous language must be ignored");
  state.weatherLocation = { ...defaultWeatherLocation("zh-CN"), name: "Saved city" };
  const saved = weather.ensure(); await Promise.resolve();
  requests[2].resolve({ city: "saved", fetchedAt: new Date().toISOString() }); await saved;
  locale = "zh-Hant";
  await weather.ensure();
  assert.equal(requests.length, 3, "language changes must preserve an explicitly selected city");
  assert.equal(state.weatherLocation.name, "Saved city");
  state.weatherLocation = null;
  await weather.ensure();
  assert.equal(requests.length, 3, "removing a selection with identical fallback coordinates can reuse its forecast");
}

async function testWeatherRecovery() {
  let currentTime = Date.now(), calls = 0, failure = "network";
  const weather = createWeatherCardState({
    state: { weatherLocation: null }, now: () => currentTime, notify() {}, localizedErrorMessage: error => error.message,
    request: async () => {
      calls += 1;
      if (failure) throw Object.assign(new Error(failure), {
        code: failure === "permission" ? "WEATHER_PERMISSION_REQUIRED" : "WEATHER_TIMEOUT",
        retryable: failure !== "permission",
      });
      return { fetchedAt: new Date(currentTime).toISOString() };
    },
  });
  await weather.ensure();
  assert.equal(weather.read().error.code, "WEATHER_TIMEOUT");
  await weather.ensure({ retryStale: true });
  currentTime += 59_999;
  await weather.ensure();
  assert.equal(calls, 1, "renders and tab switches must not rapidly repeat failed requests");
  failure = "";
  currentTime += 1;
  await weather.ensure();
  assert.equal(calls, 2);
  assert(weather.read().forecast, "a transient failure recovers on the next scheduled refresh");
  weather.invalidate(); failure = "network";
  await weather.ensure();
  failure = "";
  await weather.ensure({ retryError: true });
  assert.equal(calls, 4, "a network-online event may recover immediately within the cooldown");
  weather.invalidate(); failure = "permission";
  await weather.ensure();
  currentTime += 120_000;
  await weather.ensure({ retryError: true });
  assert.equal(calls, 5, "permission errors must wait for a user-initiated grant");
  assert.equal(weather.read().error.code, "WEATHER_PERMISSION_REQUIRED");
}

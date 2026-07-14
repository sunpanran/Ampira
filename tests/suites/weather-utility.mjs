import assert from "node:assert/strict";
import {
  WEATHER_CACHE_FRESH_MS,
  WEATHER_CACHE_KEY,
  WEATHER_CACHE_STALE_MS,
  WEATHER_FORECAST_ORIGIN,
  WEATHER_GEOCODING_ORIGIN,
  WEATHER_ORIGINS,
  normalizeWeatherForecastResponse,
  normalizeWeatherQuery,
  normalizeWeatherSearchResponse,
  weatherConditionKey,
  weatherLocationFingerprint,
} from "../../extension/core/weather.mjs";
import { createWeatherService } from "../../extension/runtime/weather-service.mjs";
import { searchChinaLocations } from "../../extension/core/china-location-search.mjs";
import { createPermissionGateway } from "../../extension/runtime/permission-gateway.mjs";
import {
  TODO_ITEM_LIMIT,
  TODO_TEXT_LIMIT,
  createTodoItem,
  nextUtilityMode,
  normalizeTodoItems,
  normalizeUtilityMode,
  normalizeWeatherLocation,
  sortedTodoItems,
  weatherConditionIconName,
} from "../../assets/client/utility-card-model.mjs";

export async function runWeatherUtilityTests() {
  assert.equal(normalizeUtilityMode("weather"), "weather");
  assert.equal(normalizeUtilityMode("invalid"), "events");
  assert.equal(nextUtilityMode("events"), "weather");
  assert.equal(nextUtilityMode("weather"), "todo");
  assert.equal(nextUtilityMode("todo"), "events");
  assert.equal(nextUtilityMode("invalid"), "weather");
  assert.deepEqual(
    ["clear", "partlyCloudy", "overcast", "fog", "drizzle", "rain", "snow", "thunderstorm", "unknown", "invalid"]
      .map(weatherConditionIconName),
    ["sun", "cloud-sun", "cloud", "cloud-fog", "cloud-drizzle", "cloud-rain", "cloud-snow", "cloud-lightning", "cloud", "cloud-sun"],
  );

  assert.equal(normalizeWeatherQuery("  New   York  "), "New York");
  assert.equal(normalizeWeatherQuery("x"), "");
  assert.equal(normalizeWeatherQuery("x".repeat(81)), "");
  assert.equal(weatherLocationFingerprint(31.230416, 121.473701), "31.2304,121.4737");
  assert.equal(weatherLocationFingerprint(91, 0), "");
  assert.deepEqual(
    [0, 2, 3, 45, 53, 63, 73, 95, 20].map(weatherConditionKey),
    ["clear", "partlyCloudy", "overcast", "fog", "drizzle", "rain", "snow", "thunderstorm", "unknown"],
  );

  const cixiLocations = searchChinaLocations("慈溪", "zh-CN");
  assert.deepEqual(cixiLocations.map((location) => [location.name, location.admin2, location.admin1]), [
    ["慈溪市", "宁波市", "浙江省"],
  ]);
  assert.equal(cixiLocations[0].source, "geonames");
  assert.equal(cixiLocations[0].confidence, "high");
  assert.equal(searchChinaLocations("慈溪市", "zh-CN")[0].id, cixiLocations[0].id);
  assert.equal(searchChinaLocations("Cixi", "en")[0].name, "Cixi");
  assert.equal(searchChinaLocations("Paris", "en").length, 0);
  assert.equal(searchChinaLocations("朝阳", "zh-CN")[0].name, "朝阳市", "prefecture cities must outrank same-name county seats");

  const locations = normalizeWeatherSearchResponse({ results: [
    {
      id: 1,
      name: " Shanghai ",
      admin1: "Shanghai",
      admin2: "Shanghai",
      country: "China",
      country_code: "CN",
      feature_code: "PPLA",
      population: 24874500,
      latitude: 31.2304,
      longitude: 121.4737,
    },
    { id: 2, name: "Broken", latitude: 120, longitude: 0 },
    ...Array.from({ length: 6 }, (_, index) => ({
      id: index + 3,
      name: `City ${index}`,
      latitude: index,
      longitude: index,
    })),
  ] });
  assert.equal(locations.length, 5, "weather location results must be filtered before applying the five-result response cap");
  assert.equal(locations[0].name, "Shanghai");
  assert.equal(locations[0].admin2, "Shanghai");
  assert.equal(locations[0].countryCode, "CN");
  assert.equal(locations[0].confidence, "high");
  assert.deepEqual(normalizeWeatherLocation(locations[0]), { ...locations[0], id: "1" });
  assert.equal(normalizeWeatherLocation({ name: "Bad", latitude: 0, longitude: 181 }), null);

  const forecastPayload = weatherFixture();
  const normalizedForecast = normalizeWeatherForecastResponse(forecastPayload);
  assert.equal(normalizedForecast.daily.length, 3);
  assert.equal(normalizedForecast.current.temperatureC, 27.3);
  assert.deepEqual(
    normalizedForecast.daily.map((day) => day.weatherCode),
    [2, 2, 0],
    "daily labels must use the predominant daytime condition instead of one severe hourly event",
  );
  assert.equal(normalizeWeatherForecastResponse({ ...forecastPayload, daily: { ...forecastPayload.daily, time: ["2026-07-14"] } }), null);
  assert.equal(normalizeWeatherForecastResponse({ ...forecastPayload, current: { ...forecastPayload.current, temperature_2m: "hot" } }), null);

  const permissionGateway = createPermissionGateway({
    chrome: {
      i18n: { getUILanguage: () => "en-US" },
      bookmarks: { getTree: async () => { throw new Error("weather permissions must not require bookmark access"); } },
      permissions: { getAll: async () => ({ origins: [] }) },
    },
    getSettings: async () => ({
      bookmarkConsentGranted: false,
      publicFeedSupplementEnabled: false,
      uiLocale: "en",
      openaiBaseUrl: "",
      aiDisclosureAccepted: false,
      webImageSearchEnabled: false,
    }),
    secretStatus: async () => ({ hasOpenAIKey: false, hasImageSearchKey: false }),
    getRecord: async (key, fallback) => key === "client-state"
      ? { "dash.utility.weather.optedIn": "true" }
      : fallback,
  });
  assert.deepEqual(
    (await permissionGateway.selectedOrigins()).map((row) => row.origin).sort(),
    WEATHER_ORIGINS.map((origin) => `${origin}/*`).sort(),
    "Settings Browser must list both weather origins after local opt-in",
  );

  const blankTodo = createTodoItem("   ", new Date("2026-07-14T00:00:00Z"));
  assert.equal(blankTodo, null);
  const longTodo = createTodoItem("任".repeat(TODO_TEXT_LIMIT + 1), new Date("2026-07-14T00:00:00Z"));
  assert.equal(Array.from(longTodo.text).length, TODO_TEXT_LIMIT);
  const rawTodos = [
    { id: "older", text: " older ", completed: false, createdAt: "2026-07-13T00:00:00Z", completedAt: "" },
    { id: "newer", text: "newer", completed: false, createdAt: "2026-07-14T00:00:00Z", completedAt: "" },
    { id: "done", text: "done", completed: true, createdAt: "2026-07-15T00:00:00Z", completedAt: "2026-07-15T01:00:00Z" },
    { id: "broken-done", text: "broken", completed: true, createdAt: "2026-07-15T00:00:00Z", completedAt: "not-a-date" },
    { id: "oversize", text: "x".repeat(TODO_TEXT_LIMIT + 1), completed: false, createdAt: "2026-07-15T00:00:00Z", completedAt: "" },
  ];
  assert.deepEqual(sortedTodoItems(rawTodos).map((item) => item.id), ["newer", "older", "done"]);
  assert.equal(normalizeTodoItems(Array.from({ length: TODO_ITEM_LIMIT + 5 }, (_, index) => ({
    id: `todo-${index}`,
    text: `Todo ${index}`,
    completed: false,
    createdAt: new Date(2026, 0, index + 1).toISOString(),
    completedAt: "",
  }))).length, TODO_ITEM_LIMIT);

  await testWeatherService(forecastPayload);
}

async function testWeatherService(forecastPayload) {
  const deniedFetch = () => { throw new Error("network must not be touched without permission"); };
  const denied = createWeatherService({
    hasOriginPermissions: async () => false,
    getRecord: async () => null,
    setRecord: async () => {},
    typedError,
    fetchBoundedResponse: deniedFetch,
  });
  await assert.rejects(() => denied.searchLocations({ query: "Paris", locale: "en" }), (error) => (
    error.code === "WEATHER_PERMISSION_REQUIRED" && error.messageKey === "background.error.weatherPermission"
  ));
  const deniedLocal = await denied.searchLocations({ query: "慈溪", locale: "zh-CN" });
  assert.equal(deniedLocal.locations[0].admin2, "宁波市", "bundled China locations must not require or touch a remote origin");

  let currentTime = Date.parse("2026-07-14T08:00:00Z");
  const records = new Map();
  const requests = [];
  let failForecast = false;
  const service = createWeatherService({
    hasOriginPermissions: async (origins) => origins.length === 2 && origins.every((origin) => WEATHER_ORIGINS.includes(origin)),
    getRecord: async (key, fallback) => records.has(key) ? records.get(key) : fallback,
    setRecord: async (key, value) => records.set(key, value),
    typedError,
    now: () => currentTime,
    fetchBoundedResponse: async (url, options, limits) => {
      requests.push({ url, options, limits });
      const parsed = new URL(url);
      if (failForecast && parsed.origin === WEATHER_FORECAST_ORIGIN) throw new Error("offline");
      const payload = parsed.origin === WEATHER_GEOCODING_ORIGIN
        ? { results: [{ id: 42, name: "Paris", admin1: "Ile-de-France", country: "France", latitude: 48.8566, longitude: 2.3522 }] }
        : forecastPayload;
      const response = responseDescriptor(url);
      await limits.validateResponse(response);
      return {
        response,
        buffer: new TextEncoder().encode(JSON.stringify(payload)).buffer,
      };
    },
  });

  const localSearch = await service.searchLocations({ query: "慈溪", locale: "zh-CN" });
  assert.equal(localSearch.locations[0].name, "慈溪市");
  assert.equal(requests.length, 0, "a bundled China match must not call the Open-Meteo geocoder");

  const search = await service.searchLocations({ query: "Paris", locale: "zh-CN" });
  assert.equal(search.locations.length, 1);
  const searchUrl = new URL(requests[0].url);
  assert.equal(searchUrl.origin, WEATHER_GEOCODING_ORIGIN);
  assert.equal(searchUrl.pathname, "/v1/search");
  assert.equal(searchUrl.searchParams.get("count"), "5");
  assert.equal(searchUrl.searchParams.get("language"), "zh");
  assert.equal(requests[0].limits.timeoutMs, 8000);
  assert.equal(requests[0].limits.maxBytes, 128 * 1024);

  const location = { latitude: 48.8566, longitude: 2.3522 };
  const first = await service.getForecast(location);
  assert.equal(first.stale, false);
  assert.equal(requests.length, 2);
  const forecastUrl = new URL(requests[1].url);
  assert.equal(forecastUrl.origin, WEATHER_FORECAST_ORIGIN);
  assert.equal(forecastUrl.pathname, "/v1/forecast");
  assert.equal(forecastUrl.searchParams.get("forecast_days"), "3");
  assert.equal(forecastUrl.searchParams.get("temperature_unit"), "celsius");
  assert.equal(forecastUrl.searchParams.get("hourly"), "weather_code");
  assert.equal(records.get(WEATHER_CACHE_KEY).capability, "weather");

  currentTime += WEATHER_CACHE_FRESH_MS;
  const fresh = await service.getForecast(location);
  assert.equal(fresh.stale, false);
  assert.equal(requests.length, 2, "a 30-minute weather cache must avoid another network request");

  currentTime += 1;
  failForecast = true;
  const stale = await service.getForecast(location);
  assert.equal(stale.stale, true);
  assert.equal(requests.length, 3);

  currentTime = Date.parse(records.get(WEATHER_CACHE_KEY).fetchedAt) + WEATHER_CACHE_STALE_MS + 1;
  await assert.rejects(() => service.getForecast(location), (error) => error.code === "WEATHER_NETWORK_ERROR");
  assert.equal(await service.weatherCachePermitted(records.get(WEATHER_CACHE_KEY)), true);

  const wrongOrigin = createWeatherService({
    hasOriginPermissions: async () => true,
    getRecord: async () => null,
    setRecord: async () => {},
    typedError,
    fetchBoundedResponse: async (_url, _options, limits) => {
      const response = responseDescriptor("https://unexpected.example/v1/search");
      await limits.validateResponse(response);
      return { response, buffer: new ArrayBuffer(0) };
    },
  });
  await assert.rejects(() => wrongOrigin.searchLocations({ query: "Paris" }), (error) => error.code === "WEATHER_ORIGIN_MISMATCH");
}

function responseDescriptor(url) {
  return {
    url,
    ok: true,
    status: 200,
    headers: { get: (name) => name.toLowerCase() === "content-type" ? "application/json; charset=utf-8" : "" },
  };
}

function typedError(code, messageKey, messageParams = {}, retryable = false, details = {}) {
  const error = new Error(code);
  Object.assign(error, { code, messageKey, messageParams, retryable, details });
  return error;
}

function weatherFixture() {
  const dates = ["2026-07-14", "2026-07-15", "2026-07-16"];
  const daytimeCodes = [
    [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
    [2, 2, 2, 2, 2, 95, 2, 2, 2, 2, 2],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ];
  return {
    timezone: "Europe/Paris",
    current: {
      temperature_2m: 27.34,
      apparent_temperature: 28.7,
      weather_code: 2,
      is_day: 1,
    },
    daily: {
      time: dates,
      weather_code: [2, 61, 0],
      temperature_2m_max: [29.4, 25.2, 30.1],
      temperature_2m_min: [20.2, 18.4, 19.8],
      precipitation_probability_max: [10, 80, 0],
    },
    hourly: {
      time: dates.flatMap((date) => Array.from({ length: 11 }, (_, index) => `${date}T${String(index + 8).padStart(2, "0")}:00`)),
      weather_code: daytimeCodes.flat(),
    },
  };
}

import assert from "node:assert/strict";
import fs from "node:fs/promises";
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
import { defaultWeatherLocation } from "../../assets/client/weather-card-state.mjs";
import {
  CHINA_LOCATION_DATA_MAX_BYTES,
  createChinaLocationLoader,
} from "../../extension/core/china-location-loader.mjs";
import { searchChinaLocationRecords } from "../../extension/core/china-location-search.mjs";
import { createPermissionGateway } from "../../extension/runtime/permission-gateway.mjs";
import {
  TODO_ITEM_LIMIT,
  TODO_TEXT_LIMIT,
  createTodoItem,
  UTILITY_MODES,
  normalizeTodoItems,
  normalizeUtilityMode,
  normalizeWeatherLocation,
  sortedTodoItems,
  weatherConditionIconName,
} from "../../assets/client/utility-card-model.mjs";

export async function runWeatherUtilityTests() {
  const chinaLocationRecords = JSON.parse(await fs.readFile(
    new URL("../../extension/data/china-locations.json", import.meta.url),
    "utf8",
  ));
  assert.equal(normalizeUtilityMode("weather"), "weather");
  assert.equal(normalizeUtilityMode("invalid"), "weather");
  assert.equal(normalizeUtilityMode(), "weather");
  assert.deepEqual(UTILITY_MODES.map(normalizeUtilityMode), ["events", "weather", "todo"]);
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
    [0, 2, 3, 45, 53, 63, 73, 95, 97, 20].map(weatherConditionKey),
    ["clear", "partlyCloudy", "overcast", "fog", "drizzle", "rain", "snow", "thunderstorm", "thunderstorm", "unknown"],
  );

  const cixiLocations = searchChinaLocationRecords(chinaLocationRecords, "慈溪", "zh-CN");
  const beijing = defaultWeatherLocation("zh-CN");
  const beijingRecord = searchChinaLocationRecords(chinaLocationRecords, "北京", "zh-CN")[0];
  assert.equal(beijing.id, beijingRecord.id);
  assert.equal(weatherLocationFingerprint(beijing.latitude, beijing.longitude),
    weatherLocationFingerprint(beijingRecord.latitude, beijingRecord.longitude));
  assert.deepEqual(defaultWeatherLocation("zh-Hant"), beijing);
  assert.deepEqual(defaultWeatherLocation(), beijing);
  assert.equal(defaultWeatherLocation("en").name, "London");
  assert.equal(defaultWeatherLocation("en-GB").countryCode, "GB");
  assert.equal(weatherLocationFingerprint(defaultWeatherLocation("en").latitude, defaultWeatherLocation("en").longitude), "51.5085,-0.1257");
  assert.deepEqual(cixiLocations.map((location) => [location.name, location.admin2, location.admin1]), [
    ["慈溪市", "宁波市", "浙江省"],
  ]);
  assert.equal(cixiLocations[0].source, "geonames");
  assert.equal(cixiLocations[0].confidence, "high");
  assert.equal(searchChinaLocationRecords(chinaLocationRecords, "慈溪市", "zh-CN")[0].id, cixiLocations[0].id);
  assert.equal(searchChinaLocationRecords(chinaLocationRecords, "Cixi", "en")[0].name, "Cixi");
  assert.equal(searchChinaLocationRecords(chinaLocationRecords, "Paris", "en").length, 0);
  assert.equal(searchChinaLocationRecords(chinaLocationRecords, "朝阳", "zh-CN")[0].name, "朝阳市", "prefecture cities must outrank same-name county seats");
  await testChinaLocationLoader(chinaLocationRecords[0]);

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
  assert.equal(normalizedForecast.daily.length, 5);
  assert.equal(normalizedForecast.current.date, "2026-07-14");
  assert.equal(normalizedForecast.current.temperatureC, 27.3);
  assert.equal(normalizedForecast.current.precipitationProbability, 10);
  assert.equal(normalizedForecast.current.relativeHumidity, 64);
  assert.equal(normalizedForecast.current.windSpeedKmh, 12.4);
  assert.equal(weatherConditionKey(normalizedForecast.current.weatherCode), "partlyCloudy");
  assert.deepEqual(normalizedForecast.daily.map((day) => day.precipitationProbabilityPeak), [80, 0, 20, 40, 60]);
  assert.equal(normalizedForecast.daily.at(-1).date, "2026-07-19");
  for (const [humidity, wind] of [[null, undefined], [101, -1], ["wet", "windy"]]) {
    const missingMetrics = normalizeWeatherForecastResponse({ ...forecastPayload, current: {
      ...forecastPayload.current, relative_humidity_2m: humidity, wind_speed_10m: wind,
    } });
    assert.equal(missingMetrics.current.relativeHumidity, null, "missing extra readings must not become zero or discard the forecast");
    assert.equal(missingMetrics.current.windSpeedKmh, null);
    assert.equal(missingMetrics.daily.length, 5);
  }
  const calm = normalizeWeatherForecastResponse({ ...forecastPayload, current: {
    ...forecastPayload.current, relative_humidity_2m: 0, wind_speed_10m: 0,
  } });
  assert.equal(calm.current.relativeHumidity, 0);
  assert.equal(calm.current.windSpeedKmh, 0);
  const realtimeConditionPayload = weatherFixture();
  realtimeConditionPayload.daily.weather_code[0] = 95;
  const realtimeCondition = normalizeWeatherForecastResponse(realtimeConditionPayload);
  assert.equal(
    weatherConditionKey(realtimeCondition.current.weatherCode),
    "partlyCloudy",
    "today's realtime condition must come from current weather instead of the hourly forecast",
  );
  assert.deepEqual(
    normalizedForecast.daily.map((day) => day.weatherCode),
    [61, 0, 2, 3, 61],
    "daily peak conditions must retain the provider's native weather code for secondary warnings",
  );
  assert.equal(normalizeWeatherForecastResponse({ ...forecastPayload, daily: { ...forecastPayload.daily, time: ["2026-07-14"] } }), null);
  assert.equal(normalizeWeatherForecastResponse({ ...forecastPayload, current: { ...forecastPayload.current, temperature_2m: "hot" } }), null);
  assert.equal(normalizeWeatherForecastResponse({ ...forecastPayload, current: { ...forecastPayload.current, temperature_2m: null } }), null);
  const incompleteForecast = weatherFixture();
  incompleteForecast.daily.temperature_2m_max.pop();
  assert.equal(normalizeWeatherForecastResponse(incompleteForecast), null, "all five future days must have matching data arrays");
  testDailyWeatherSummary();

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

  await testWeatherService(forecastPayload, chinaLocationRecords);
}

async function testWeatherService(forecastPayload, chinaLocationRecords) {
  const deniedFetch = () => { throw new Error("network must not be touched without permission"); };
  let lazyLoadCalls = 0;
  const denied = createWeatherService({
    hasOriginPermissions: async () => false,
    getRecord: async () => null,
    setRecord: async () => {},
    typedError,
    fetchBoundedResponse: deniedFetch,
    loadChinaLocationRecords: async () => {
      lazyLoadCalls += 1;
      return chinaLocationRecords;
    },
  });
  await assert.rejects(() => denied.searchLocations({ query: "x", locale: "en" }), (error) => error.code === "INVALID_WEATHER_QUERY");
  await assert.rejects(() => denied.getForecast(defaultWeatherLocation("zh-CN")), (error) => error.code === "WEATHER_PERMISSION_REQUIRED",
    "default cities must not bypass optional weather access");
  assert.equal(lazyLoadCalls, 0, "invalid searches must be rejected before loading the packaged China index");
  await assert.rejects(() => denied.searchLocations({ query: "Paris", locale: "en" }), (error) => (
    error.code === "WEATHER_PERMISSION_REQUIRED" && error.messageKey === "background.error.weatherPermission"
  ));
  assert.equal(lazyLoadCalls, 1);
  const deniedLocal = await denied.searchLocations({ query: "慈溪", locale: "zh-CN" });
  assert.equal(deniedLocal.locations[0].admin2, "宁波市", "bundled China locations must not require or touch a remote origin");
  assert.equal(lazyLoadCalls, 2, "weather service delegates caching to its packaged location loader");

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
    loadChinaLocationRecords: async () => chinaLocationRecords,
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
  assert.equal(requests[0].limits.timeoutMs, 15000);
  assert.equal(requests[0].limits.maxBytes, 128 * 1024);

  const failedLocalIndexRequests = [];
  const failedLocalIndexService = createWeatherService({
    hasOriginPermissions: async () => true,
    getRecord: async () => null,
    setRecord: async () => {},
    typedError,
    loadChinaLocationRecords: async () => { throw new Error("missing packaged index"); },
    fetchBoundedResponse: async (url, _options, limits) => {
      failedLocalIndexRequests.push(url);
      const response = responseDescriptor(url);
      await limits.validateResponse(response);
      return {
        response,
        buffer: new TextEncoder().encode(JSON.stringify({
          results: [{ id: 42, name: "Paris", country: "France", latitude: 48.8566, longitude: 2.3522 }],
        })).buffer,
      };
    },
  });
  const fallbackSearch = await failedLocalIndexService.searchLocations({ query: "Paris", locale: "en" });
  assert.equal(fallbackSearch.locations[0].name, "Paris");
  assert.equal(new URL(failedLocalIndexRequests[0]).origin, WEATHER_GEOCODING_ORIGIN, "a failed packaged index must fall back to the authorized geocoder");

  const location = { latitude: 48.8566, longitude: 2.3522 };
  const legacyForecast = normalizeWeatherForecastResponse(forecastPayload);
  records.set("weather-forecast-v4", {
    ...legacyForecast,
    daily: legacyForecast.daily.slice(0, 2),
    locationFingerprint: weatherLocationFingerprint(location.latitude, location.longitude),
    fetchedAt: new Date(currentTime).toISOString(),
  });
  const first = await service.getForecast(location);
  assert.equal(first.stale, false);
  assert.equal(requests.length, 2, "the old two-day cache must not bypass the extended forecast request");
  assert.equal(first.daily.length, 5);
  assert.equal(first.current.relativeHumidity, 64);
  assert.equal(first.current.windSpeedKmh, 12.4);
  const forecastUrl = new URL(requests[1].url);
  assert.equal(forecastUrl.origin, WEATHER_FORECAST_ORIGIN);
  assert.equal(forecastUrl.pathname, "/v1/forecast");
  assert.equal(forecastUrl.searchParams.get("forecast_days"), "6");
  assert.equal(forecastUrl.searchParams.get("temperature_unit"), "celsius");
  assert.equal(forecastUrl.searchParams.get("wind_speed_unit"), "kmh");
  assert.equal(forecastUrl.searchParams.get("current"), "temperature_2m,apparent_temperature,weather_code,relative_humidity_2m,wind_speed_10m");
  assert.equal(forecastUrl.searchParams.get("hourly"), "precipitation_probability,weather_code");
  assert.equal(forecastUrl.searchParams.get("daily"), "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max");
  assert.equal(forecastUrl.searchParams.has("models"), false, "Open-Meteo must select its native best-match model");
  assert.equal(records.get(WEATHER_CACHE_KEY).capability, "weather");

  currentTime += WEATHER_CACHE_FRESH_MS;
  const fresh = await service.getForecast(location);
  assert.equal(fresh.stale, false);
  assert.deepEqual(fresh.daily, first.daily, "cached forecasts retain all five future days");
  assert.equal(requests.length, 2, "a 30-minute weather cache must avoid another network request");

  currentTime += 1;
  failForecast = true;
  const stale = await service.getForecast(location);
  assert.equal(stale.stale, true);
  assert.deepEqual(stale.daily, first.daily, "offline fallback retains the extended forecast");
  assert.equal(requests.length, 3);

  const midnightCache = {
    ...records.get(WEATHER_CACHE_KEY),
    fetchedAt: "2026-07-14T21:50:00.000Z",
  };
  const midnightService = createWeatherService({
    hasOriginPermissions: async () => true,
    getRecord: async () => midnightCache,
    setRecord: async () => {},
    typedError,
    now: () => Date.parse("2026-07-14T22:10:00.000Z"),
    fetchBoundedResponse: async () => { throw new Error("offline"); },
  });
  await assert.rejects(
    () => midnightService.getForecast(location),
    (error) => error.code === "WEATHER_NETWORK_ERROR",
    "a previous local date must not be served from an otherwise fresh cache",
  );

  currentTime = Date.parse(records.get(WEATHER_CACHE_KEY).fetchedAt) + WEATHER_CACHE_STALE_MS + 1;
  await assert.rejects(() => service.getForecast(location), (error) => error.code === "WEATHER_NETWORK_ERROR");
  assert.equal(await service.weatherCachePermitted(records.get(WEATHER_CACHE_KEY)), true);

  const wrongOrigin = createWeatherService({
    hasOriginPermissions: async () => true,
    getRecord: async () => null,
    setRecord: async () => {},
    typedError,
    loadChinaLocationRecords: async () => chinaLocationRecords,
    fetchBoundedResponse: async (_url, _options, limits) => {
      const response = responseDescriptor("https://unexpected.example/v1/search");
      await limits.validateResponse(response);
      return { response, buffer: new ArrayBuffer(0) };
    },
  });
  await assert.rejects(() => wrongOrigin.searchLocations({ query: "Paris" }), (error) => error.code === "WEATHER_ORIGIN_MISMATCH");

  const timedOut = createWeatherService({
    hasOriginPermissions: async () => true,
    getRecord: async () => null,
    setRecord: async () => {},
    typedError,
    fetchBoundedResponse: async () => { throw Object.assign(new Error("timeout"), { code: "NETWORK_TIMEOUT" }); },
  });
  await assert.rejects(() => timedOut.getForecast(defaultWeatherLocation("en")), (error) => (
    error.code === "WEATHER_TIMEOUT" && error.messageKey === "background.error.weatherTimeout" && error.retryable === true
  ), "a timed-out forecast must remain distinguishable and retryable");
}

function testDailyWeatherSummary() {
  const summarize = (codes, peak, edit = () => {}) => {
    const payload = weatherFixture();
    payload.daily.weather_code[1] = peak;
    payload.hourly.weather_code.splice(24, 24, ...codes);
    edit(payload.hourly);
    return normalizeWeatherForecastResponse(payload).daily[0];
  };
  const intermittent = summarize([...Array(13).fill(3), ...Array(11).fill(51)], 53);
  assert.equal(intermittent.dominantWeatherCode, 3, "mostly overcast hours must not become an all-day drizzle label");
  assert.equal(intermittent.weatherCode, 51, "intermittent drizzle must remain available in the daily description");
  const persistent = summarize([...Array(16).fill(51), ...Array(8).fill(3)], 53);
  assert.equal(persistent.dominantWeatherCode, 51, "sustained drizzle must not be suppressed to match a dry forecast");
  const changingIntensity = summarize([...Array(9).fill(3), ...Array(8).fill(61), ...Array(7).fill(51)], 61);
  assert.equal(changingIntensity.dominantWeatherCode, 61, "rain and drizzle must count together when wet weather dominates");
  const storm = summarize([...Array(23).fill(3), 97], 97);
  assert.equal(storm.dominantWeatherCode, 3);
  assert.equal(storm.weatherCode, 95, "a short heavy thunderstorm must remain in the secondary condition");
  assert.equal(summarize([...Array(12).fill(3), ...Array(12).fill(61)], 61).dominantWeatherCode, 61, "ties retain the wetter condition");
  assert.equal(summarize([...Array(12).fill(95), ...Array(12).fill(61)], 95).dominantWeatherCode, 95, "rain must not win a tie against thunderstorms");
  assert.equal(summarize(Array(24).fill(0), 0).dominantWeatherCode, 0);
  for (const edit of [
    hourly => { delete hourly.weather_code; },
    hourly => { hourly.weather_code[24] = null; },
    hourly => { hourly.weather_code[24] = 20; },
    hourly => { hourly.time[24] = hourly.time[25]; },
    hourly => { hourly.time[24] = "2026-07-16T00:00"; },
  ]) {
    assert.equal(summarize(Array(24).fill(3), 53, edit).dominantWeatherCode, 51,
      "missing, invalid, duplicate or wrong-date hours must not turn the daily peak into a dry summary");
  }
}

async function testChinaLocationLoader(sampleRecord) {
  const payload = new TextEncoder().encode(JSON.stringify([sampleRecord])).buffer;
  let requestCount = 0;
  const load = createChinaLocationLoader({
    dataUrl: "chrome-extension://test/extension/data/china-locations.json",
    fetchImpl: async () => {
      requestCount += 1;
      return responseWithBuffer(payload);
    },
  });
  const [first, second] = await Promise.all([load(), load()]);
  assert.equal(requestCount, 1, "concurrent first searches must share one packaged data request");
  assert.equal(first, second, "the validated location index must be memoized");
  assert.equal((await load())[0].id, sampleRecord.id);
  assert.equal(requestCount, 1, "later searches must reuse the parsed location index");

  let failedRequests = 0;
  const retryingLoad = createChinaLocationLoader({
    fetchImpl: async () => {
      failedRequests += 1;
      return failedRequests === 1
        ? responseWithBuffer(new Uint8Array(CHINA_LOCATION_DATA_MAX_BYTES + 1).buffer)
        : responseWithBuffer(payload);
    },
  });
  await assert.rejects(retryingLoad, /size limit/, "oversized packaged data must be rejected");
  assert.equal((await retryingLoad())[0].id, sampleRecord.id);
  assert.equal(failedRequests, 2, "a failed first load must be cleared so a later search can retry");

  const malformedLoad = createChinaLocationLoader({
    fetchImpl: async () => responseWithBuffer(new TextEncoder().encode("[{}]").buffer),
  });
  await assert.rejects(malformedLoad, /invalid record/, "malformed records must not enter the search index");
}

function responseWithBuffer(buffer) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => "application/json" },
    async arrayBuffer() { return buffer; },
  };
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
  const dates = ["2026-07-14", "2026-07-15", "2026-07-16", "2026-07-17", "2026-07-18", "2026-07-19"];
  const codes = [2, 61, 0, 2, 3, 61];
  const probabilities = [10, 80, 0, 20, 40, 60];
  return {
    timezone: "Europe/Paris",
    current: {
      time: "2026-07-14T08:00",
      temperature_2m: 27.34,
      apparent_temperature: 28.7,
      weather_code: 2,
      relative_humidity_2m: 64,
      wind_speed_10m: 12.36,
    },
    daily: {
      time: dates,
      weather_code: codes,
      temperature_2m_max: [29.4, 25.2, 30.1, 28.1, 27.2, 26.3],
      temperature_2m_min: [20.2, 18.4, 19.8, 19.2, 18.1, 17.3],
      precipitation_probability_max: probabilities,
    },
    hourly: {
      time: dates.flatMap((date) => Array.from({ length: 24 }, (_, index) => `${date}T${String(index).padStart(2, "0")}:00`)),
      weather_code: codes.flatMap(code => Array(24).fill(code)),
      precipitation_probability: probabilities.flatMap(value => Array(24).fill(value)),
    },
  };
}

import { decodeResponseBuffer, fetchBounded } from "../core/network.mjs";
import { searchChinaLocations } from "../core/china-location-search.mjs";
import {
  WEATHER_CACHE_FRESH_MS,
  WEATHER_CACHE_KEY,
  WEATHER_CACHE_STALE_MS,
  WEATHER_FORECAST_ORIGIN,
  WEATHER_GEOCODING_ORIGIN,
  WEATHER_ORIGINS,
  normalizeWeatherCoordinates,
  normalizeWeatherForecastResponse,
  normalizeWeatherQuery,
  normalizeWeatherSearchResponse,
  weatherApiLanguage,
  weatherLocationFingerprint,
} from "../core/weather.mjs";

const WEATHER_FETCH_TIMEOUT_MS = 8000;
const WEATHER_MAX_RESPONSE_BYTES = 128 * 1024;

export function createWeatherService(options) {
  const {
    hasOriginPermissions,
    getRecord,
    setRecord,
    typedError,
    now = () => Date.now(),
    fetchBoundedResponse = fetchBounded,
    decodeBuffer = decodeResponseBuffer,
  } = options;

  return { searchLocations, getForecast, weatherCachePermitted };

  async function searchLocations(payload = {}) {
    const query = normalizeWeatherQuery(payload.query);
    if (!query) throw typedError("INVALID_WEATHER_QUERY", "background.error.weatherQuery", {}, false);
    const localLocations = searchChinaLocations(query, payload.locale);
    if (localLocations.length) return { locations: localLocations };
    await assertWeatherPermission();
    const url = new URL("/v1/search", WEATHER_GEOCODING_ORIGIN);
    url.searchParams.set("name", query);
    url.searchParams.set("count", "5");
    url.searchParams.set("language", weatherApiLanguage(payload.locale));
    url.searchParams.set("format", "json");
    const response = await fetchJson(url, WEATHER_GEOCODING_ORIGIN);
    return { locations: normalizeWeatherSearchResponse(response) };
  }

  async function getForecast(payload = {}) {
    await assertWeatherPermission();
    const coordinates = normalizeWeatherCoordinates(payload.latitude, payload.longitude);
    if (!coordinates) throw typedError("INVALID_WEATHER_LOCATION", "background.error.weatherLocation", {}, false);
    const fingerprint = weatherLocationFingerprint(coordinates.latitude, coordinates.longitude);
    const cached = await getRecord(WEATHER_CACHE_KEY, null);
    const age = cacheAge(cached, fingerprint, now());
    if (age <= WEATHER_CACHE_FRESH_MS) return publicForecast(cached, false);

    const url = new URL("/v1/forecast", WEATHER_FORECAST_ORIGIN);
    url.searchParams.set("latitude", String(coordinates.latitude));
    url.searchParams.set("longitude", String(coordinates.longitude));
    url.searchParams.set("current", "temperature_2m,apparent_temperature,weather_code,is_day");
    url.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max");
    url.searchParams.set("temperature_unit", "celsius");
    url.searchParams.set("timezone", "auto");
    url.searchParams.set("forecast_days", "3");
    try {
      const response = await fetchJson(url, WEATHER_FORECAST_ORIGIN);
      const forecast = normalizeWeatherForecastResponse(response);
      if (!forecast) throw typedError("INVALID_WEATHER_RESPONSE", "background.error.weatherData", {}, true);
      const record = {
        capability: "weather",
        locationFingerprint: fingerprint,
        providerOrigins: [...WEATHER_ORIGINS],
        fetchedAt: new Date(now()).toISOString(),
        ...forecast,
      };
      await setRecord(WEATHER_CACHE_KEY, record, "cache");
      return publicForecast(record, false);
    } catch (error) {
      if (age <= WEATHER_CACHE_STALE_MS) return publicForecast(cached, true);
      throw error;
    }
  }

  async function weatherCachePermitted(record) {
    if (record?.capability !== "weather") return false;
    return hasOriginPermissions(WEATHER_ORIGINS);
  }

  async function assertWeatherPermission() {
    if (await hasOriginPermissions(WEATHER_ORIGINS)) return;
    throw typedError("WEATHER_PERMISSION_REQUIRED", "background.error.weatherPermission", {}, false, {
      origin: WEATHER_FORECAST_ORIGIN,
    });
  }

  async function fetchJson(url, expectedOrigin) {
    let result;
    try {
      result = await fetchBoundedResponse(url.href, {
        headers: { accept: "application/json" },
      }, {
        timeoutMs: WEATHER_FETCH_TIMEOUT_MS,
        maxBytes: WEATHER_MAX_RESPONSE_BYTES,
        validateResponse(response) {
          const responseOrigin = safeOrigin(response.url || url.href);
          if (responseOrigin !== expectedOrigin) {
            throw typedError("WEATHER_ORIGIN_MISMATCH", "background.error.weatherData", {}, false);
          }
          if (!response.ok) {
            throw typedError("WEATHER_HTTP_ERROR", "background.error.weatherUnavailable", { status: response.status }, response.status === 429 || response.status >= 500, {
              status: response.status,
              origin: expectedOrigin,
            });
          }
          const contentType = String(response.headers.get("content-type") || "").toLowerCase();
          if (contentType && !contentType.includes("json")) {
            throw typedError("INVALID_WEATHER_RESPONSE", "background.error.weatherData", {}, false);
          }
        },
      });
    } catch (error) {
      if (error?.messageKey) throw error;
      throw typedError("WEATHER_NETWORK_ERROR", "background.error.weatherUnavailable", {}, true, {
        origin: expectedOrigin,
      });
    }
    try {
      return JSON.parse(decodeBuffer(result.buffer, result.response.headers.get("content-type") || ""));
    } catch {
      throw typedError("INVALID_WEATHER_RESPONSE", "background.error.weatherData", {}, false);
    }
  }
}

function cacheAge(record, fingerprint, currentTime) {
  if (!record || record.locationFingerprint !== fingerprint) return Number.POSITIVE_INFINITY;
  const fetchedAt = Date.parse(String(record.fetchedAt || ""));
  if (!Number.isFinite(fetchedAt)) return Number.POSITIVE_INFINITY;
  return Math.max(0, currentTime - fetchedAt);
}

function publicForecast(record, stale) {
  return {
    timezone: String(record.timezone || "UTC"),
    current: record.current,
    daily: Array.isArray(record.daily) ? record.daily.slice(0, 3) : [],
    fetchedAt: String(record.fetchedAt || ""),
    stale: stale === true,
  };
}

function safeOrigin(value) {
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

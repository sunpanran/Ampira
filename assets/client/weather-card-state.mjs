import { WEATHER_CACHE_FRESH_MS, weatherLocationFingerprint } from "../../extension/core/weather.mjs";
import { normalizeWeatherLocation } from "./utility-card-model.mjs";
import { normalizeLocale } from "../../extension/core/locale.mjs";

const RETRY_DELAY_MS = 60_000;

const DEFAULT_WEATHER_LOCATIONS = Object.freeze({
  "zh-CN": Object.freeze(normalizeWeatherLocation({
    id: "geonames:1816670", name: "Beijing", countryCode: "CN",
    latitude: 39.9075, longitude: 116.39723,
    source: "geonames", featureCode: "PPLC", confidence: "high",
  })),
  en: Object.freeze(normalizeWeatherLocation({
    id: "geonames:2643743", name: "London", countryCode: "GB",
    latitude: 51.50853, longitude: -0.12574,
    source: "geonames", featureCode: "PPLC", confidence: "high",
  })),
});

export function defaultWeatherLocation(locale) {
  return DEFAULT_WEATHER_LOCATIONS[normalizeLocale(locale) === "en" ? "en" : "zh-CN"];
}

export function createWeatherCardState({ state, request, getLocale = () => "zh-CN", localizedErrorMessage, notify, now = () => Date.now() }) {
  let generation = 0;
  let fingerprint = "";
  let forecast = null;
  let error = null;
  let pending = null;
  let attempted = false;
  let retryAt = 0;
  const currentLocation = () => normalizeWeatherLocation(state.weatherLocation) || defaultWeatherLocation(getLocale());
  const locationKey = () => {
    const location = currentLocation();
    return weatherLocationFingerprint(location.latitude, location.longitude);
  };

  function reset() {
    generation += 1;
    fingerprint = locationKey();
    forecast = null;
    error = null;
    pending = null;
    attempted = false;
    retryAt = 0;
  }

  function read({ retryStale = false, retryError = false } = {}) {
    if (fingerprint !== locationKey()) reset();
    if (error?.retryable && (retryError || now() >= retryAt)) {
      error = null;
      attempted = false;
    }
    if (forecast) {
      const fetchedAt = Date.parse(String(forecast.fetchedAt || ""));
      const expired = !Number.isFinite(fetchedAt) || now() - fetchedAt > WEATHER_CACHE_FRESH_MS;
      if (expired && forecast.stale !== true || retryStale && forecast.stale === true && now() >= retryAt) {
        forecast = null;
        error = null;
        attempted = false;
      }
    }
    return { forecast, error, busy: Boolean(pending) };
  }

  function ensure(options) {
    read(options);
    const location = currentLocation();
    if (forecast || error || attempted) return pending || Promise.resolve();
    const token = generation;
    const key = fingerprint;
    attempted = true;
    pending = Promise.resolve().then(() => request({ type: "weather:get", payload: {
      latitude: location.latitude, longitude: location.longitude, countryCode: location.countryCode,
    } })).then((result) => {
      if (token === generation && key === locationKey()) {
        forecast = result;
        retryAt = now() + RETRY_DELAY_MS;
      }
    }).catch((cause) => {
      if (token === generation && key === locationKey()) {
        error = { code: cause?.code || "", message: localizedErrorMessage(cause), retryable: cause?.retryable === true };
        retryAt = now() + RETRY_DELAY_MS;
      }
    }).finally(() => {
      if (token !== generation) return;
      pending = null;
      notify();
    });
    notify();
    return pending;
  }

  return {
    read, ensure,
    invalidate() { reset(); notify(); },
    setError(value) { error = value; notify(); },
    retry() { read(); if (pending) return pending; error = null; attempted = false; return ensure(); },
  };
}

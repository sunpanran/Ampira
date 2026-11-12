import { WEATHER_CACHE_FRESH_MS, weatherLocationFingerprint } from "../../extension/core/weather.mjs";
import { normalizeWeatherLocation } from "./utility-card-model.mjs";

export function createWeatherCardState({ state, apiPost, localizedErrorMessage, notify }) {
  let generation = 0;
  let fingerprint = "";
  let forecast = null;
  let error = null;
  let pending = null;
  let attempted = false;
  const locationKey = () => state.weatherLocation
    ? weatherLocationFingerprint(state.weatherLocation.latitude, state.weatherLocation.longitude) : "";

  function reset() {
    generation += 1;
    fingerprint = locationKey();
    forecast = null;
    error = null;
    pending = null;
    attempted = false;
  }

  function read({ retryStale = false } = {}) {
    if (fingerprint !== locationKey()) reset();
    if (forecast) {
      const fetchedAt = Date.parse(String(forecast.fetchedAt || ""));
      const expired = !Number.isFinite(fetchedAt) || Date.now() - fetchedAt > WEATHER_CACHE_FRESH_MS;
      if (expired && forecast.stale !== true || retryStale && forecast.stale === true) {
        forecast = null;
        error = null;
        attempted = false;
      }
    }
    return { forecast, error, busy: Boolean(pending) };
  }

  function ensure(options) {
    read(options);
    const location = normalizeWeatherLocation(state.weatherLocation);
    if (!location || forecast || error || attempted) return pending || Promise.resolve();
    const token = generation;
    const key = fingerprint;
    attempted = true;
    pending = Promise.resolve().then(() => apiPost("/api/weather/forecast", {
      latitude: location.latitude, longitude: location.longitude, countryCode: location.countryCode,
    })).then((result) => {
      if (token === generation && key === locationKey()) forecast = result;
    }).catch((cause) => {
      if (token === generation && key === locationKey()) error = { code: cause?.code || "", message: localizedErrorMessage(cause) };
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

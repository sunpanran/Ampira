import { WEATHER_CACHE_FRESH_MS, WEATHER_ORIGINS, weatherConditionKey, weatherLocationFingerprint } from "../../extension/core/weather.mjs";
import {
  UTILITY_MODE_KEY,
  WEATHER_LOCATION_KEY,
  WEATHER_OPTED_IN_KEY,
  nextUtilityMode,
  normalizeUtilityMode,
  normalizeWeatherLocation,
  weatherConditionIconName,
} from "./utility-card-model.mjs";
import { createTodoCardView } from "./todo-card-view.mjs";

const MODE_TITLE_KEYS = Object.freeze({
  events: "events.cardTitle",
  weather: "weather.cardTitle",
  todo: "todo.cardTitle",
});
const MODE_ICONS = Object.freeze({ events: "news", weather: "cloud-sun", todo: "check" });

export function createUtilityCardView(options) {
  const {
    state, t, tc, getLocale, apiPost, createEmptyState, createIcon,
    createEventsContent, writeJson, writeValue, requestWeatherPermissions,
    localizedErrorMessage,
  } = options;
  let eventItems = [];
  let weatherEditing = !state.weatherLocation;
  let weatherQuery = "";
  let weatherLocations = [];
  let weatherSearchBusy = false;
  let weatherSearchError = "";
  let weatherForecast = null;
  let weatherForecastBusy = false;
  let weatherForecastError = null;
  let weatherAttemptedFingerprint = "";
  let weatherRequestToken = 0;

  const card = document.createElement("section");
  card.className = "efficiency-card utility-card";
  card.dataset.efficiencyCard = "utility";
  const head = document.createElement("div");
  head.className = "efficiency-head";
  const title = document.createElement("div");
  title.className = "efficiency-title";
  const tools = document.createElement("div");
  tools.className = "efficiency-head-tools";
  const switchButton = document.createElement("button");
  switchButton.className = "efficiency-action utility-switch";
  switchButton.type = "button";
  switchButton.addEventListener("click", switchMode);
  const meta = document.createElement("span");
  meta.className = "efficiency-meta utility-meta";
  const locationButton = document.createElement("button");
  locationButton.className = "efficiency-meta utility-location-button";
  locationButton.type = "button";
  locationButton.hidden = true;
  locationButton.addEventListener("click", editWeatherLocation);
  const todoView = createTodoCardView({
    state,
    t,
    createIcon,
    writeJson,
    requestRender: () => render(eventItems),
    getContentRoot: () => body,
    getFocusFallback: () => switchButton,
  });
  tools.append(meta, locationButton, todoView.addButton, switchButton);
  head.append(title, tools);
  const body = document.createElement("div");
  body.className = "utility-card-body";
  card.append(head, body);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.utilityMode === "weather" && expireWeatherForecast({ retryStale: true })) render(eventItems);
  });

  return { render, invalidateWeather };

  function render(items = eventItems, options = {}) {
    eventItems = Array.isArray(items) ? items : [];
    state.utilityMode = normalizeUtilityMode(state.utilityMode);
    if (state.utilityMode === "weather") expireWeatherForecast();
    const nextMode = nextUtilityMode(state.utilityMode);
    card.dataset.utilityMode = state.utilityMode;
    title.replaceChildren(
      createIcon(utilityModeIconName(), "card-icon"),
      document.createTextNode(t(MODE_TITLE_KEYS[state.utilityMode])),
    );
    switchButton.textContent = t("utility.switch");
    switchButton.title = t("utility.switchTo", { type: t(MODE_TITLE_KEYS[nextMode]) });
    switchButton.setAttribute("aria-label", switchButton.title);
    syncHeaderMeta();

    const content = state.utilityMode === "events"
      ? createEventsContent(eventItems)
      : state.utilityMode === "weather"
        ? createWeatherContent()
        : todoView.createContent();
    body.replaceChildren(content);
    if (options.animate === true) animateContent();
    if (state.utilityMode === "weather" && state.weatherLocation && !weatherEditing) {
      const fingerprint = locationFingerprint(state.weatherLocation);
      if (!weatherForecast && !weatherForecastBusy && !weatherForecastError && weatherAttemptedFingerprint !== fingerprint) {
        queueMicrotask(loadWeatherForecast);
      }
    }
    return card;
  }

  function utilityModeIconName() {
    if (state.utilityMode !== "weather" || !weatherForecast?.current) return MODE_ICONS[state.utilityMode];
    return weatherConditionIconName(weatherConditionKey(weatherForecast.current.weatherCode));
  }

  function switchMode() {
    todoView.resetComposer();
    state.utilityMode = nextUtilityMode(state.utilityMode);
    if (state.utilityMode === "weather") expireWeatherForecast({ retryStale: true });
    writeValue(UTILITY_MODE_KEY, state.utilityMode);
    render(eventItems, { animate: true });
  }

  function syncHeaderMeta() {
    const pendingTodos = todoView.syncAddButton(state.utilityMode === "todo");
    locationButton.hidden = true;
    meta.hidden = false;
    if (state.utilityMode === "events") {
      meta.textContent = tc("unit.entries", eventItems.length);
      return;
    }
    if (state.utilityMode === "todo") {
      meta.textContent = tc("todo.pending", pendingTodos);
      return;
    }
    if (state.weatherLocation) {
      meta.hidden = true;
      locationButton.hidden = false;
      locationButton.textContent = state.weatherLocation.name;
      locationButton.title = t("weather.location.change", { location: weatherLocationLabel(state.weatherLocation) });
      locationButton.setAttribute("aria-label", locationButton.title);
      return;
    }
    meta.textContent = t("weather.location.unset");
  }

  function createWeatherContent() {
    if (weatherEditing || !state.weatherLocation) return createWeatherEditor();
    if (weatherForecastBusy) {
      return createEmptyState({
        title: t("weather.loading.title"),
        body: t("weather.loading.body"),
        variant: "compact",
      });
    }
    if (weatherForecastError) {
      return createEmptyState({
        title: t("weather.error.title"),
        body: weatherForecastError.message,
        variant: "compact",
        actionLabel: t(weatherForecastError.code === "WEATHER_PERMISSION_REQUIRED" ? "weather.permission.retry" : "weather.retry"),
        onAction: weatherForecastError.code === "WEATHER_PERMISSION_REQUIRED" ? reauthorizeWeather : retryWeatherForecast,
      });
    }
    if (!weatherForecast) {
      return createEmptyState({
        title: t("weather.loading.title"),
        body: t("weather.loading.body"),
        variant: "compact",
      });
    }
    return createForecastRows(weatherForecast);
  }

  function createWeatherEditor() {
    const editor = document.createElement("div");
    editor.className = "weather-editor";
    const usesLocalLocations = weatherLocations.some((location) => location.source === "geonames");
    editor.classList.toggle("has-location-attribution", usesLocalLocations);
    const form = document.createElement("form");
    form.className = "utility-entry-form weather-search-form";
    const input = document.createElement("input");
    input.className = "utility-entry-input";
    input.type = "search";
    input.maxLength = 80;
    input.autocomplete = "off";
    input.spellcheck = false;
    input.placeholder = t("weather.search.placeholder");
    input.setAttribute("aria-label", t("weather.search.label"));
    input.value = weatherQuery;
    input.disabled = weatherSearchBusy;
    input.addEventListener("input", () => {
      weatherQuery = input.value;
      submit.disabled = weatherSearchBusy || weatherQuery.trim().length < 2;
    });
    const submit = document.createElement("button");
    submit.className = "efficiency-action utility-entry-submit";
    submit.type = "submit";
    submit.textContent = t(weatherSearchBusy ? "weather.search.searching" : "weather.search.action");
    submit.disabled = weatherSearchBusy || weatherQuery.trim().length < 2;
    form.addEventListener("submit", searchWeatherLocations);
    form.append(input, submit);
    editor.append(form);

    if (weatherSearchError) {
      const error = document.createElement("p");
      error.className = "utility-inline-status is-error";
      error.setAttribute("role", "alert");
      error.textContent = weatherSearchError;
      editor.append(error);
    }
    if (weatherLocations.length) {
      const list = document.createElement("div");
      list.className = "weather-location-list utility-scroll-list";
      list.setAttribute("aria-label", t("weather.search.results"));
      list.append(...weatherLocations.map(createWeatherLocationButton));
      editor.append(list);
      if (usesLocalLocations) editor.append(createLocationAttribution());
    }
    queueMicrotask(() => {
      if (state.utilityMode === "weather" && weatherEditing && !weatherSearchBusy) input.focus({ preventScroll: true });
    });
    return editor;
  }

  function createWeatherLocationButton(location) {
    const button = document.createElement("button");
    button.className = "efficiency-row weather-location-row";
    button.type = "button";
    const main = document.createElement("span");
    main.className = "efficiency-row-main";
    const name = document.createElement("span");
    name.className = "efficiency-row-title";
    name.textContent = location.name;
    const detail = document.createElement("span");
    detail.className = "efficiency-row-meta";
    const administrativeLabel = weatherAdministrativeLabel(location);
    detail.textContent = location.confidence === "verify"
      ? [administrativeLabel, t("weather.search.verify")].filter(Boolean).join(" · ")
      : administrativeLabel;
    main.append(name, detail);
    button.append(main);
    button.addEventListener("click", () => selectWeatherLocation(location));
    return button;
  }

  function createLocationAttribution({ compact = false } = {}) {
    const attribution = document.createElement("a");
    attribution.className = "weather-attribution weather-location-attribution";
    attribution.href = "https://www.geonames.org/";
    attribution.target = "_blank";
    attribution.rel = "noreferrer";
    attribution.textContent = t(compact ? "weather.locationAttributionShort" : "weather.locationAttribution");
    if (compact) {
      attribution.setAttribute("aria-label", t("weather.locationAttribution"));
      attribution.title = t("weather.locationAttribution");
    }
    return attribution;
  }

  async function searchWeatherLocations(event) {
    event.preventDefault();
    if (weatherSearchBusy) return;
    const query = weatherQuery.trim();
    if (query.length < 2) {
      weatherSearchError = t("weather.search.invalid");
      render(eventItems);
      return;
    }
    weatherSearchBusy = true;
    weatherSearchError = "";
    weatherLocations = [];
    writeValue(WEATHER_OPTED_IN_KEY, "true");
    render(eventItems);
    try {
      const granted = await requestWeatherPermissions(WEATHER_ORIGINS);
      if (granted !== true) {
        weatherSearchError = t("weather.permission.declined");
        return;
      }
      const result = await apiPost("/api/weather/search", { query, locale: getLocale() });
      weatherLocations = Array.isArray(result?.locations)
        ? result.locations.map(normalizeWeatherLocation).filter(Boolean).slice(0, 5)
        : [];
      if (!weatherLocations.length) weatherSearchError = t("weather.search.empty");
    } catch (error) {
      weatherSearchError = localizedErrorMessage(error);
    } finally {
      weatherSearchBusy = false;
      if (state.utilityMode === "weather") render(eventItems);
    }
  }

  function selectWeatherLocation(location) {
    const normalized = normalizeWeatherLocation(location);
    if (!normalized) return;
    state.weatherLocation = normalized;
    writeJson(WEATHER_LOCATION_KEY, normalized);
    writeValue(WEATHER_OPTED_IN_KEY, "true");
    weatherEditing = false;
    weatherQuery = "";
    weatherLocations = [];
    weatherSearchError = "";
    weatherForecast = null;
    weatherForecastError = null;
    weatherAttemptedFingerprint = "";
    render(eventItems, { animate: true });
  }

  function editWeatherLocation() {
    weatherEditing = true;
    weatherQuery = state.weatherLocation?.name || "";
    weatherLocations = [];
    weatherSearchError = "";
    render(eventItems, { animate: true });
  }

  async function loadWeatherForecast() {
    const location = normalizeWeatherLocation(state.weatherLocation);
    if (!location || weatherForecastBusy) return;
    const fingerprint = locationFingerprint(location);
    const token = ++weatherRequestToken;
    weatherAttemptedFingerprint = fingerprint;
    weatherForecastBusy = true;
    weatherForecastError = null;
    if (state.utilityMode === "weather") render(eventItems);
    try {
      const result = await apiPost("/api/weather/forecast", {
        latitude: location.latitude,
        longitude: location.longitude,
      });
      if (token !== weatherRequestToken || fingerprint !== locationFingerprint(state.weatherLocation)) return;
      weatherForecast = result;
    } catch (error) {
      if (token !== weatherRequestToken) return;
      weatherForecast = null;
      weatherForecastError = { code: error?.code || "", message: localizedErrorMessage(error) };
    } finally {
      if (token === weatherRequestToken) weatherForecastBusy = false;
      if (token === weatherRequestToken && state.utilityMode === "weather") render(eventItems);
    }
  }

  async function reauthorizeWeather() {
    writeValue(WEATHER_OPTED_IN_KEY, "true");
    const granted = await requestWeatherPermissions(WEATHER_ORIGINS);
    if (granted !== true) {
      weatherForecastError = { code: "WEATHER_PERMISSION_REQUIRED", message: t("weather.permission.declined") };
      render(eventItems);
      return;
    }
    retryWeatherForecast();
  }

  function retryWeatherForecast() {
    weatherForecastError = null;
    weatherAttemptedFingerprint = "";
    loadWeatherForecast();
  }

  function createForecastRows(forecast) {
    const wrapper = document.createElement("div");
    wrapper.className = "weather-forecast";
    const list = document.createElement("div");
    list.className = "efficiency-list utility-scroll-list weather-forecast-list";
    list.append(...forecast.daily.map((day, index) => createForecastRow(day, index, forecast)));
    const attribution = document.createElement("a");
    attribution.className = "weather-attribution";
    attribution.href = "https://open-meteo.com/";
    attribution.target = "_blank";
    attribution.rel = "noreferrer";
    attribution.textContent = t("weather.attributionShort");
    attribution.setAttribute("aria-label", t("weather.attributionLabel"));
    attribution.title = t("weather.attributionLabel");
    const attributions = document.createElement("div");
    attributions.className = "weather-attributions";
    const attributionGroup = document.createElement("div");
    attributionGroup.className = "weather-attribution-group";
    attributionGroup.append(attribution);
    if (state.weatherLocation?.source === "geonames") {
      const separator = document.createElement("span");
      separator.className = "weather-attribution-separator";
      separator.setAttribute("aria-hidden", "true");
      separator.textContent = "·";
      attributionGroup.append(separator, createLocationAttribution({ compact: true }));
    }
    attributions.append(attributionGroup);
    wrapper.append(list, attributions);
    return wrapper;
  }

  function createForecastRow(day, index, forecast) {
    const row = document.createElement("div");
    row.className = "efficiency-row weather-row";
    row.classList.toggle("is-current", index === 0);
    const main = document.createElement("span");
    main.className = "efficiency-row-main";
    const titleNode = document.createElement("span");
    titleNode.className = "efficiency-row-title";
    titleNode.textContent = `${weatherDayLabel(day.date, index, forecast.timezone)} · ${t(`weather.condition.${weatherConditionKey(day.weatherCode)}`)}`;
    const detail = document.createElement("span");
    detail.className = "efficiency-row-meta";
    const precipitation = t("weather.precipitation", { value: day.precipitationProbability });
    detail.textContent = index === 0
      ? [
          t("weather.current", { value: formatTemperature(forecast.current.temperatureC) }),
          t("weather.feelsLike", { value: formatTemperature(forecast.current.apparentTemperatureC) }),
          precipitation,
          forecast.stale ? t("weather.stale") : "",
        ].filter(Boolean).join(" · ")
      : precipitation;
    main.append(titleNode, detail);
    const badge = document.createElement("span");
    badge.className = "efficiency-score weather-temperature-range";
    badge.textContent = `${formatTemperature(day.temperatureMaxC)} / ${formatTemperature(day.temperatureMinC)}`;
    row.append(main, badge);
    return row;
  }

  function invalidateWeather() {
    weatherRequestToken += 1;
    weatherForecast = null;
    weatherForecastBusy = false;
    weatherForecastError = null;
    weatherAttemptedFingerprint = "";
    if (state.utilityMode === "weather") render(eventItems);
  }

  function expireWeatherForecast({ retryStale = false } = {}) {
    if (!weatherForecast) return false;
    const fetchedAt = Date.parse(String(weatherForecast.fetchedAt || ""));
    const expired = !Number.isFinite(fetchedAt) || Date.now() - fetchedAt > WEATHER_CACHE_FRESH_MS;
    if (!(expired && weatherForecast.stale !== true) && !(retryStale && weatherForecast.stale === true)) return false;
    weatherForecast = null;
    weatherForecastError = null;
    weatherAttemptedFingerprint = "";
    return true;
  }

  function animateContent() {
    if (!body.animate || globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return;
    body.animate([
      { opacity: .35, transform: "translateY(4px)" },
      { opacity: 1, transform: "translateY(0)" },
    ], { duration: 160, easing: "cubic-bezier(.22, .8, .3, 1)" });
  }

  function weatherDayLabel(date, index, timezone) {
    if (index === 0) return t("weather.day.today");
    if (index === 1) return t("weather.day.tomorrow");
    const value = new Date(`${date}T12:00:00Z`);
    try {
      return new Intl.DateTimeFormat(getLocale(), { month: "numeric", day: "numeric", weekday: "short", timeZone: timezone || "UTC" }).format(value);
    } catch {
      return date;
    }
  }

  function weatherLocationLabel(location) {
    return [location.name, weatherAdministrativeLabel(location)].filter(Boolean).join(" · ");
  }

  function weatherAdministrativeLabel(location) {
    return [...new Set([location.admin2, location.admin1, location.country].filter(Boolean))].join(" · ");
  }

  function locationFingerprint(location) {
    return location ? weatherLocationFingerprint(location.latitude, location.longitude) : "";
  }

  function formatTemperature(value) {
    return `${Math.round(Number(value) || 0)}°`;
  }
}

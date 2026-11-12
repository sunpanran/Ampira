import { WEATHER_ORIGINS, weatherConditionKey } from "../../extension/core/weather.mjs";
import { WEATHER_LOCATION_KEY, WEATHER_OPTED_IN_KEY, normalizeWeatherLocation, weatherConditionIconName } from "./utility-card-model.mjs";
import { spanText } from "./dom.mjs";

export function createWeatherCardView({ state, t, getLocale, apiPost, createEmptyState, createIcon,
  writeJson, writeValue, requestWeatherPermissions, localizedErrorMessage, weatherState, requestRender, isActive }) {
  let weatherEditing = false;
  let weatherQuery = "", weatherLocations = [], weatherSearchError = "";
  let weatherSearchBusy = false, searchToken = 0;
  let editor = null, editorForm = null, editorInput = null, editorSubmit = null, editorSignature = "";
  const locationButton = document.createElement("button");
  locationButton.className = "efficiency-meta utility-location-button";
  locationButton.type = "button";
  locationButton.addEventListener("click", editWeatherLocation);

  return {
    render() {
      const { forecast } = weatherState.read();
      if (state.weatherLocation) {
        locationButton.textContent = state.weatherLocation.name;
        locationButton.title = t("weather.location.change", { location: weatherLocationLabel(state.weatherLocation) });
        locationButton.setAttribute("aria-label", locationButton.title);
      }
      if (state.weatherLocation && !weatherEditing) queueMicrotask(() => { if (isActive()) weatherState.ensure(); });
      return {
        icon: forecast?.current ? weatherConditionIconName(weatherConditionKey(forecast.current.weatherCode)) : "cloud-sun",
        meta: state.weatherLocation ? locationButton : spanText(t("weather.location.unset"), "efficiency-meta"),
        content: createWeatherContent(),
      };
    },
    deactivate() { weatherEditing = false; searchToken += 1; weatherSearchBusy = false; },
  };

  function createWeatherContent() {
    const { forecast: weatherForecast, busy: weatherForecastBusy, error: weatherForecastError } = weatherState.read();
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
    if (!editor) {
      editor = document.createElement("div");
      editor.className = "weather-editor";
      editorForm = document.createElement("form");
      editorForm.className = "utility-entry-form weather-search-form";
      editorInput = document.createElement("input");
      editorInput.className = "utility-entry-input";
      editorInput.type = "search";
      editorInput.maxLength = 80;
      editorInput.autocomplete = "off";
      editorInput.spellcheck = false;
      editorSubmit = document.createElement("button");
      editorSubmit.className = "efficiency-action utility-entry-submit";
      editorSubmit.type = "submit";
      editorInput.addEventListener("input", () => {
        weatherQuery = editorInput.value;
        editorSubmit.disabled = weatherSearchBusy || weatherQuery.trim().length < 2;
      });
      editorForm.addEventListener("submit", searchWeatherLocations);
      editorForm.append(editorInput, editorSubmit);
      editor.append(editorForm);
    }
    const usesLocalLocations = weatherLocations.some((location) => location.source === "geonames");
    editor.classList.toggle("has-location-attribution", usesLocalLocations);
    editorInput.placeholder = t("weather.search.placeholder");
    editorInput.setAttribute("aria-label", t("weather.search.label"));
    if (editorInput.value !== weatherQuery) editorInput.value = weatherQuery;
    editorInput.disabled = weatherSearchBusy;
    editorSubmit.textContent = t(weatherSearchBusy ? "weather.search.searching" : "weather.search.action");
    editorSubmit.disabled = weatherSearchBusy || weatherQuery.trim().length < 2;
    const signature = JSON.stringify([weatherSearchError, weatherLocations, getLocale()]);
    if (signature !== editorSignature) {
      editorSignature = signature;
      Array.from(editor.children).filter((node) => node !== editorForm).forEach((node) => node.remove());
      if (weatherSearchError) {
        const error = spanText(weatherSearchError, "utility-inline-status is-error");
        error.setAttribute("role", "alert");
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
    }
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
    const token = ++searchToken;
    const query = weatherQuery.trim();
    if (query.length < 2) {
      weatherSearchError = t("weather.search.invalid");
      requestRender();
      return;
    }
    weatherSearchBusy = true;
    weatherSearchError = "";
    weatherLocations = [];
    writeValue(WEATHER_OPTED_IN_KEY, "true");
    requestRender();
    try {
      const granted = await requestWeatherPermissions(WEATHER_ORIGINS);
      if (token !== searchToken) return;
      if (granted !== true) {
        weatherSearchError = t("weather.permission.declined");
        return;
      }
      const result = await apiPost("/api/weather/search", { query, locale: getLocale() });
      if (token !== searchToken) return;
      weatherLocations = Array.isArray(result?.locations)
        ? result.locations.map(normalizeWeatherLocation).filter(Boolean).slice(0, 5)
        : [];
      if (!weatherLocations.length) weatherSearchError = t("weather.search.empty");
    } catch (error) {
      if (token === searchToken) weatherSearchError = localizedErrorMessage(error);
    } finally {
      if (token === searchToken) {
        weatherSearchBusy = false;
        if (isActive()) requestRender();
      }
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
    weatherState.invalidate();
    requestRender({ animate: true });
  }

  function editWeatherLocation() {
    weatherEditing = true;
    weatherQuery = state.weatherLocation?.name || "";
    weatherLocations = [];
    weatherSearchError = "";
    requestRender({ animate: true });
    editorInput?.focus({ preventScroll: true });
  }

  async function reauthorizeWeather() {
    writeValue(WEATHER_OPTED_IN_KEY, "true");
    const granted = await requestWeatherPermissions(WEATHER_ORIGINS);
    if (granted !== true) {
      weatherState.setError({ code: "WEATHER_PERMISSION_REQUIRED", message: t("weather.permission.declined") });
      requestRender();
      return;
    }
    retryWeatherForecast();
  }

  function retryWeatherForecast() {
    weatherState.retry();
  }

  function createForecastRows(forecast) {
    const wrapper = document.createElement("div");
    wrapper.className = "weather-forecast";
    const list = document.createElement("div");
    list.className = "efficiency-list utility-scroll-list weather-forecast-list";
    const days = document.createElement("div");
    days.className = "weather-forecast-days";
    days.append(...forecast.daily.map((day, index) => createForecastRow(day, index + 1, forecast.timezone)));
    list.append(createCurrentWeather(forecast), days);
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

  function createCurrentWeather(forecast) {
    const current = forecast.current;
    const condition = weatherConditionKey(current.weatherCode);
    const summary = document.createElement("div");
    summary.className = "weather-current";
    const main = document.createElement("div");
    main.className = "weather-current-main";
    const reading = document.createElement("div");
    reading.className = "weather-current-reading";
    reading.append(
      spanText(formatTemperature(current.temperatureC), "weather-current-temperature"),
      spanText(t(`weather.condition.${condition}`), "weather-current-condition"),
    );
    main.append(reading, createIcon(weatherConditionIconName(condition), "weather-current-icon"));
    const detail = spanText([
      t("weather.feelsLike", { value: formatTemperature(current.apparentTemperatureC) }),
      t("weather.precipitation", { value: current.precipitationProbability }),
      forecast.stale ? t("weather.stale") : "",
    ].filter(Boolean).join(" · "), "weather-current-details");
    summary.append(main, detail);
    return summary;
  }

  function createForecastRow(day, index, timezone) {
    const row = document.createElement("div");
    row.className = "weather-row";
    const key = weatherConditionKey(day.dominantWeatherCode ?? day.weatherCode);
    const peak = weatherConditionKey(day.weatherCode);
    const secondary = peak === "drizzle" ? "rain" : peak;
    const label = key !== peak && ["fog", "drizzle", "rain", "snow", "thunderstorm"].includes(peak)
      ? t("weather.condition.mixed", { primary: t(`weather.condition.${key}`), secondary: t(`weather.condition.${secondary}`) })
      : t(`weather.condition.${key}`);
    const condition = spanText("", "weather-row-condition");
    condition.append(createIcon(weatherConditionIconName(key), "weather-row-icon"), spanText(label));
    const range = spanText("", "weather-temperature-range");
    range.append(spanText(formatTemperature(day.temperatureMaxC), "weather-temperature-high"), spanText(` / ${formatTemperature(day.temperatureMinC)}`));
    row.append(
      spanText(weatherDayLabel(day.date, index, timezone), "weather-row-date"),
      condition,
      spanText(t("weather.precipitation", { value: day.precipitationProbabilityPeak }), "weather-row-precipitation"),
      range,
    );
    return row;
  }

  function weatherDayLabel(date, index, timezone) {
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
  function formatTemperature(value) {
    return `${Math.round(Number(value) || 0)}°`;
  }
}

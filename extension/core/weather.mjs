export const WEATHER_GEOCODING_ORIGIN = "https://geocoding-api.open-meteo.com";
export const WEATHER_FORECAST_ORIGIN = "https://api.open-meteo.com";
export const WEATHER_ORIGINS = Object.freeze([
  WEATHER_GEOCODING_ORIGIN,
  WEATHER_FORECAST_ORIGIN,
]);
export const WEATHER_CACHE_KEY = "weather-forecast-v2";
export const WEATHER_CACHE_FRESH_MS = 30 * 60 * 1000;
export const WEATHER_CACHE_STALE_MS = 6 * 60 * 60 * 1000;
export const WEATHER_QUERY_MAX_LENGTH = 80;
export const WEATHER_RESULT_LIMIT = 5;

export function normalizeWeatherQuery(value) {
  const query = String(value || "").trim().replace(/\s+/g, " ");
  if (query.length < 2 || query.length > WEATHER_QUERY_MAX_LENGTH) return "";
  return query;
}

export function weatherApiLanguage(locale) {
  return String(locale || "").toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function normalizeWeatherSearchResponse(value) {
  const results = Array.isArray(value?.results) ? value.results : [];
  return results.map((item) => {
    const latitude = normalizedCoordinate(item?.latitude, -90, 90);
    const longitude = normalizedCoordinate(item?.longitude, -180, 180);
    const name = cleanText(item?.name, 100);
    if (latitude === null || longitude === null || !name) return null;
    return {
      id: normalizedLocationId(item?.id),
      name,
      admin1: cleanText(item?.admin1, 100),
      admin2: cleanText(item?.admin2, 100),
      country: cleanText(item?.country, 100),
      countryCode: normalizeCountryCode(item?.countryCode ?? item?.country_code),
      featureCode: cleanText(item?.featureCode ?? item?.feature_code, 20),
      population: normalizePopulation(item?.population),
      source: cleanText(item?.source, 40) || "open-meteo",
      confidence: weatherLocationConfidence(item),
      latitude,
      longitude,
    };
  }).filter(Boolean).slice(0, WEATHER_RESULT_LIMIT);
}

export function normalizeWeatherForecastResponse(value) {
  const current = value?.current;
  const daily = value?.daily;
  if (!current || !daily) return null;
  const dates = Array.isArray(daily.time) ? daily.time.slice(0, 3) : [];
  const weatherCodes = Array.isArray(daily.weather_code) ? daily.weather_code.slice(0, 3) : [];
  const maximums = Array.isArray(daily.temperature_2m_max) ? daily.temperature_2m_max.slice(0, 3) : [];
  const minimums = Array.isArray(daily.temperature_2m_min) ? daily.temperature_2m_min.slice(0, 3) : [];
  const precipitation = Array.isArray(daily.precipitation_probability_max)
    ? daily.precipitation_probability_max.slice(0, 3)
    : [];
  if ([dates, weatherCodes, maximums, minimums, precipitation].some((items) => items.length !== 3)) return null;

  const normalizedCurrent = {
    temperatureC: boundedNumber(current.temperature_2m, -150, 100),
    apparentTemperatureC: boundedNumber(current.apparent_temperature, -150, 100),
    weatherCode: boundedInteger(current.weather_code, 0, 99),
    isDay: current.is_day === 1,
  };
  if (Object.values(normalizedCurrent).slice(0, 3).some((item) => item === null)) return null;

  const normalizedDaily = dates.map((date, index) => {
    const day = {
      date: normalizeIsoDate(date),
      weatherCode: dominantDaytimeWeatherCode(value?.hourly, date) ?? boundedInteger(weatherCodes[index], 0, 99),
      temperatureMaxC: boundedNumber(maximums[index], -150, 100),
      temperatureMinC: boundedNumber(minimums[index], -150, 100),
      precipitationProbability: boundedInteger(precipitation[index], 0, 100),
    };
    return Object.values(day).some((item) => item === null || item === "") ? null : day;
  });
  if (normalizedDaily.some((day) => !day)) return null;

  return {
    timezone: cleanText(value.timezone, 100) || "UTC",
    current: normalizedCurrent,
    daily: normalizedDaily,
  };
}

function dominantDaytimeWeatherCode(hourly, date) {
  const times = Array.isArray(hourly?.time) ? hourly.time : [];
  const codes = Array.isArray(hourly?.weather_code) ? hourly.weather_code : [];
  if (!date || times.length !== codes.length) return null;

  const counts = new Map();
  for (let index = 0; index < times.length; index += 1) {
    const match = String(times[index] || "").match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):/);
    if (!match || match[1] !== date) continue;
    const hour = Number(match[2]);
    const code = boundedInteger(codes[index], 0, 99);
    if (hour < 8 || hour > 18 || code === null) continue;
    const condition = weatherConditionKey(code);
    const entry = counts.get(condition) || { count: 0, codes: new Map() };
    entry.count += 1;
    entry.codes.set(code, (entry.codes.get(code) || 0) + 1);
    counts.set(condition, entry);
  }
  if (!counts.size) return null;

  const condition = [...counts.values()].sort((left, right) => right.count - left.count)[0];
  return [...condition.codes.entries()].sort((left, right) => right[1] - left[1])[0][0];
}

export function normalizeWeatherCoordinates(latitudeValue, longitudeValue) {
  const latitude = normalizedCoordinate(latitudeValue, -90, 90);
  const longitude = normalizedCoordinate(longitudeValue, -180, 180);
  return latitude === null || longitude === null ? null : { latitude, longitude };
}

export function normalizeWeatherLocation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const coordinates = normalizeWeatherCoordinates(value.latitude, value.longitude);
  const name = cleanText(value.name, 100);
  if (!coordinates || !name) return null;
  return {
    id: normalizeStoredLocationId(value.id),
    name,
    admin1: cleanText(value.admin1, 100),
    admin2: cleanText(value.admin2, 100),
    country: cleanText(value.country, 100),
    countryCode: normalizeCode(value.countryCode, 2),
    featureCode: normalizeCode(value.featureCode, 20),
    population: normalizePopulation(value.population),
    source: normalizeCode(value.source, 40),
    confidence: ["high", "verify"].includes(value.confidence) ? value.confidence : "verify",
    ...coordinates,
  };
}

export function weatherLocationFingerprint(latitude, longitude) {
  const coordinates = normalizeWeatherCoordinates(latitude, longitude);
  return coordinates ? `${coordinates.latitude.toFixed(4)},${coordinates.longitude.toFixed(4)}` : "";
}

export function weatherConditionKey(codeValue) {
  const code = boundedInteger(codeValue, 0, 99);
  if (code === 0) return "clear";
  if ([1, 2].includes(code)) return "partlyCloudy";
  if (code === 3) return "overcast";
  if ([45, 48].includes(code)) return "fog";
  if ([51, 53, 55, 56, 57].includes(code)) return "drizzle";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "rain";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "snow";
  if ([95, 96, 99].includes(code)) return "thunderstorm";
  return "unknown";
}

function normalizedCoordinate(value, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) return null;
  return Number(number.toFixed(6));
}

function boundedNumber(value, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) return null;
  return Number(number.toFixed(1));
}

function boundedInteger(value, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const integer = Math.round(number);
  return integer >= minimum && integer <= maximum ? integer : null;
}

function normalizedLocationId(value) {
  const number = Number(value);
  if (Number.isSafeInteger(number) && number >= 0) return number;
  return cleanText(value, 80);
}

function normalizeCountryCode(value) {
  const code = String(value || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : "";
}

function normalizeCode(value, maxLength) {
  const code = String(value || "").trim();
  return code.length <= maxLength && /^[A-Za-z0-9._:-]*$/.test(code) ? code : "";
}

function normalizeStoredLocationId(value) {
  const id = String(value ?? "").trim();
  return id && Array.from(id).length <= 100 && /^[\p{L}\p{N}._:-]+$/u.test(id) ? id : "";
}

function normalizePopulation(value) {
  if (value === "" || value === null || value === undefined) return 0;
  const population = Number(value);
  return Number.isSafeInteger(population) && population >= 0 ? population : 0;
}

function weatherLocationConfidence(item) {
  const explicit = String(item?.confidence || "");
  if (["high", "verify"].includes(explicit)) return explicit;
  const featureCode = cleanText(item?.featureCode ?? item?.feature_code, 20).toUpperCase();
  const population = normalizePopulation(item?.population);
  return featureCode === "PPLC" || /^PPLA\d?$/.test(featureCode) || population >= 1000 ? "high" : "verify";
}

function normalizeIsoDate(value) {
  const text = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "";
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? "" : text;
}

function cleanText(value, maxLength) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

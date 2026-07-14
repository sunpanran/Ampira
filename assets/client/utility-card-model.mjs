import { normalizeWeatherCoordinates } from "../../extension/core/weather.mjs";

export const UTILITY_MODES = Object.freeze(["events", "weather", "todo"]);
export const UTILITY_MODE_KEY = "dash.utility.mode";
export const WEATHER_LOCATION_KEY = "dash.utility.weather.location.v1";
export const WEATHER_OPTED_IN_KEY = "dash.utility.weather.optedIn";
export const TODO_ITEMS_KEY = "dash.utility.todos.v1";
export const TODO_ITEM_LIMIT = 50;
export const TODO_TEXT_LIMIT = 120;

const WEATHER_CONDITION_ICONS = Object.freeze({
  clear: "sun",
  partlyCloudy: "cloud-sun",
  overcast: "cloud",
  fog: "cloud-fog",
  drizzle: "cloud-drizzle",
  rain: "cloud-rain",
  snow: "cloud-snow",
  thunderstorm: "cloud-lightning",
  unknown: "cloud",
});

export function normalizeUtilityMode(value) {
  const mode = String(value || "");
  return UTILITY_MODES.includes(mode) ? mode : "events";
}

export function nextUtilityMode(value) {
  const index = UTILITY_MODES.indexOf(normalizeUtilityMode(value));
  return UTILITY_MODES[(index + 1) % UTILITY_MODES.length];
}

export function weatherConditionIconName(value) {
  return WEATHER_CONDITION_ICONS[String(value || "")] || "cloud-sun";
}

export function normalizeWeatherLocation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const coordinates = normalizeWeatherCoordinates(value.latitude, value.longitude);
  const name = cleanText(value.name, 100);
  if (!coordinates || !name) return null;
  return {
    id: normalizeId(value.id),
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

export function normalizeTodoItems(value) {
  const items = Array.isArray(value) ? value : [];
  const seen = new Set();
  const normalized = [];
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const id = normalizeId(item.id);
    const text = strictText(item.text, TODO_TEXT_LIMIT);
    const createdAt = normalizeDate(item.createdAt);
    if (!id || !text || !createdAt || seen.has(id)) continue;
    seen.add(id);
    const completed = item.completed === true;
    const completedAt = completed ? normalizeDate(item.completedAt) : "";
    if (completed && !completedAt) continue;
    normalized.push({
      id,
      text,
      completed,
      createdAt,
      completedAt,
    });
    if (normalized.length >= TODO_ITEM_LIMIT) break;
  }
  return normalized;
}

export function createTodoItem(text, now = new Date()) {
  const normalizedText = cleanText(text, TODO_TEXT_LIMIT);
  if (!normalizedText) return null;
  return {
    id: globalThis.crypto?.randomUUID?.() || `todo-${now.getTime()}-${Math.random().toString(16).slice(2)}`,
    text: normalizedText,
    completed: false,
    createdAt: now.toISOString(),
    completedAt: "",
  };
}

export function sortedTodoItems(items) {
  return normalizeTodoItems(items).sort((left, right) => (
    Number(left.completed) - Number(right.completed)
    || Date.parse(right.createdAt) - Date.parse(left.createdAt)
  ));
}

function normalizeId(value) {
  const id = String(value ?? "").trim();
  if (Array.from(id).length > 100) return "";
  return id && /^[\p{L}\p{N}._:-]+$/u.test(id) ? id : "";
}

function normalizeDate(value) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}

function normalizeCode(value, maxLength) {
  const code = String(value || "").trim();
  return code.length <= maxLength && /^[A-Za-z0-9._:-]*$/.test(code) ? code : "";
}

function normalizePopulation(value) {
  const population = Number(value);
  return Number.isSafeInteger(population) && population >= 0 ? population : 0;
}

function cleanText(value, maxLength) {
  return Array.from(String(value || "").replace(/\s+/g, " ").trim()).slice(0, maxLength).join("");
}

function strictText(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return Array.from(text).length <= maxLength ? text : "";
}

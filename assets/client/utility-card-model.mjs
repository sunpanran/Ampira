import { normalizeTodoItems, normalizeTodoText, TODO_ITEM_LIMIT, TODO_TEXT_LIMIT } from "../../extension/core/todo.mjs";
import { normalizeWeatherLocation } from "../../extension/core/weather.mjs";

export { normalizeTodoItems, normalizeWeatherLocation, TODO_ITEM_LIMIT, TODO_TEXT_LIMIT };

export const UTILITY_MODES = Object.freeze(["events", "weather", "todo"]);
export const UTILITY_MODE_KEY = "dash.utility.mode";
export const WEATHER_LOCATION_KEY = "dash.utility.weather.location.v1";
export const WEATHER_OPTED_IN_KEY = "dash.utility.weather.optedIn";
export const TODO_ITEMS_KEY = "dash.utility.todos.v1";

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

export function createTodoItem(text, now = new Date()) {
  const normalizedText = normalizeTodoText(text, TODO_TEXT_LIMIT);
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

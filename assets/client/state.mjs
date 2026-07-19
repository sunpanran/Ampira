import { readJson, readNumber, readValue } from "./storage.mjs";
import { getTodayKey } from "./time.mjs";
import { createActivityStore } from "./activity-store.mjs";
import {
  TODO_ITEMS_KEY,
  UTILITY_MODE_KEY,
  WEATHER_LOCATION_KEY,
  normalizeTodoItems,
  normalizeUtilityMode,
  normalizeWeatherLocation,
} from "./utility-card-model.mjs";

export function createInitialState() {
  const day = getTodayKey();
  const activity = createActivityStore({ readJson, day });
  return {
    data: null,
    settings: null,
    localHeaderCover: null,
    filter: "all",
    categoryFilter: "all",
    query: "",
    utilityMode: normalizeUtilityMode(readValue(UTILITY_MODE_KEY)),
    weatherLocation: normalizeWeatherLocation(readJson(WEATHER_LOCATION_KEY, null)),
    todos: normalizeTodoItems(readJson(TODO_ITEMS_KEY, [])),
    summaryOrder: readValue("dash.summary.order") || "importance",
    day,
    variants: {
      news: readNumber(`dash.variant.${day}.news`, 0),
      inspiration: readNumber(`dash.variant.${day}.inspiration`, readNumber(`dash.variant.${day}`, 0)),
      summary: readNumber(`dash.variant.${day}.summary`, 0)
    },
    ...activity,
    manualRefreshKeys: new Set(),
    dailyDigestRefreshing: false,
    aiSearchBusy: false,
    aiSearchTypeTimer: null,
    pollTimer: null,
    webFrameUrl: "",
    webFrameItem: null,
    webFrameResult: null,
    webFrameHistory: [],
    webFrameActiveMs: 0,
    webFrameLastActiveAt: 0,
    webFrameReadTimer: 0,
    webFrameProgressTimer: 0,
    contextMenu: null
  }
}

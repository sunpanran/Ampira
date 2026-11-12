import { normalizeUtilityMode } from "./utility-card-model.mjs";
import { DASHBOARD_CARD_IDS } from "../../extension/core/dashboard-layout.mjs";

export const SWITCHABLE_CARD_IDS = DASHBOARD_CARD_IDS;
export const DASHBOARD_CARD_TYPES_KEY = "dash.dashboard.cardTypes.v1";
export const DASHBOARD_CARD_TYPES = Object.freeze(["news", "digest", "inspiration", "queue", "todo", "events", "weather", "stocks", "countdown", "archive"]);
export const CARD_TYPE_TITLES = Object.freeze({
  events: "events.cardTitle", weather: "weather.cardTitle", todo: "todo.cardTitle",
  digest: "digest.cardTitle", archive: "daily.archive", stocks: "stocks.cardTitle", countdown: "countdown.cardTitle",
  queue: "queue.cardTitle", inspiration: "daily.inspiration", news: "daily.news",
});
export const CARD_TYPE_ICONS = Object.freeze({ events: "flag", weather: "cloud-sun", stocks: "stocks", todo: "list-check", countdown: "calendar", digest: "sparkling", archive: "check", queue: "bookmark-ribbon", inspiration: "lightbulb", news: "news" });

export function normalizeDashboardCardTypes(value, legacyMode) {
  const defaults = { utility: normalizeUtilityMode(legacyMode), digest: "digest", archive: "archive", news: "news", inspiration: "inspiration", queue: "queue" };
  return Object.fromEntries(SWITCHABLE_CARD_IDS.map((id) => [id,
    DASHBOARD_CARD_TYPES.includes(value?.[id]) ? value[id] : defaults[id],
  ]));
}

export function todoCardTarget(cardTypes, order, focusedId) {
  const ids = order.filter((id) => SWITCHABLE_CARD_IDS.includes(id));
  if (ids.includes(focusedId) && cardTypes[focusedId] === "todo") return focusedId;
  return ids.find((id) => cardTypes[id] === "todo") || "utility";
}

import { readJson, readNumber, readValue } from "./storage.mjs";
import { getTodayKey } from "./time.mjs";
import { createActivityStore } from "./activity-store.mjs";

export function createInitialState() {
  const day = getTodayKey();
  const activity = createActivityStore({ readJson, day });
  return {
    data: null,
    settings: null,
    filter: "all",
    categoryFilter: "all",
    query: "",
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
    navSyncFrame: 0,
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

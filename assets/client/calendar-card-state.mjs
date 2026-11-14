import { CALENDAR_STATE_KEY, calendarToday, normalizeCalendarState } from "../../extension/core/calendar.mjs";
import { createPersonalCardState } from "./personal-card-state.mjs";

export function createCalendarCardState({ now = () => new Date(), ...options }) {
  let day = calendarToday(now());
  let syncError = null;
  const shared = createPersonalCardState({ ...options, kind: "calendar", key: CALENDAR_STATE_KEY, normalize: normalizeCalendarState,
    request: async message => {
      const result = await options.request(message);
      if (Object.hasOwn(result, "syncError")) syncError = result.syncError;
      return result;
    },
  });
  return {
    ...shared,
    read: () => ({ ...shared.read(), syncError }),
    clearSyncError: () => { syncError = null; },
    retrySync: () => shared.change({ type: "sync" }),
    today: () => calendarToday(now()),
    refreshDay() {
      const next = calendarToday(now());
      if (next === day) return false;
      day = next; options.notify(); return true;
    },
  };
}

export const WORLD_CLOCK_STATE_KEY = "dash.worldClock.state.v1";
export const WORLD_CLOCK_LIMIT = 8;
export const WORLD_CLOCK_CITIES = Object.freeze([
  ["beijing", "Asia/Shanghai"], ["shanghai", "Asia/Shanghai"], ["hongKong", "Asia/Hong_Kong"], ["taipei", "Asia/Taipei"],
  ["tokyo", "Asia/Tokyo"], ["seoul", "Asia/Seoul"], ["singapore", "Asia/Singapore"], ["bangkok", "Asia/Bangkok"],
  ["jakarta", "Asia/Jakarta"], ["newDelhi", "Asia/Kolkata"], ["kathmandu", "Asia/Kathmandu"], ["dubai", "Asia/Dubai"],
  ["sydney", "Australia/Sydney"], ["melbourne", "Australia/Melbourne"], ["adelaide", "Australia/Adelaide"], ["perth", "Australia/Perth"],
  ["auckland", "Pacific/Auckland"], ["london", "Europe/London"], ["paris", "Europe/Paris"], ["berlin", "Europe/Berlin"],
  ["rome", "Europe/Rome"], ["madrid", "Europe/Madrid"], ["moscow", "Europe/Moscow"], ["istanbul", "Europe/Istanbul"],
  ["cairo", "Africa/Cairo"], ["johannesburg", "Africa/Johannesburg"], ["nairobi", "Africa/Nairobi"],
  ["newYork", "America/New_York"], ["toronto", "America/Toronto"], ["chicago", "America/Chicago"],
  ["denver", "America/Denver"], ["losAngeles", "America/Los_Angeles"], ["vancouver", "America/Vancouver"],
  ["mexicoCity", "America/Mexico_City"], ["saoPaulo", "America/Sao_Paulo"], ["honolulu", "Pacific/Honolulu"], ["utc", "UTC"],
].map(([id, timeZone]) => Object.freeze({ id, timeZone })));
const cityIds = new Set(WORLD_CLOCK_CITIES.map(city => city.id));
const revision = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;

export function normalizeWorldClockState(value) {
  const items = [], ids = new Set();
  for (const item of Array.isArray(value?.items) ? value.items : []) {
    if (!cityIds.has(item?.id) || ids.has(item.id)) continue;
    ids.add(item.id); items.push({ id: item.id, revision: revision(item.revision) });
    if (items.length === WORLD_CLOCK_LIMIT) break;
  }
  return { revision: revision(value?.revision), items };
}

export function applyWorldClockAction(value, action) {
  const state = normalizeWorldClockState(value), fail = reason => ({ ok: false, reason, state });
  if (!["add", "replace", "remove"].includes(action?.type) || !cityIds.has(action.id)) return fail("invalid");
  const item = state.items.find(item => item.id === (action.type === "replace" ? action.previousId : action.id));
  if (action.type === "add") {
    if (item) return fail("duplicate");
    if (state.items.length >= WORLD_CLOCK_LIMIT) return fail("limit");
    state.items.push({ id: action.id, revision: 1 });
  } else {
    if (!item) return fail("removed");
    if (item.revision !== action.revision) return fail("changed");
    if (action.type === "replace") {
      if (item.id === action.id) return { ok: true, state };
      if (state.items.some(item => item.id === action.id)) return fail("duplicate");
      item.id = action.id; item.revision++;
    } else state.items = state.items.filter(item => item.id !== action.id);
  }
  state.revision++;
  return { ok: true, state };
}

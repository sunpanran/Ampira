import { createSwitchableCardView } from "../../assets/client/switchable-card-view.mjs";
import { createCalendarCardState } from "../../assets/client/calendar-card-state.mjs";
import { CALENDAR_STATE_KEY, calendarToday } from "../../extension/core/calendar.mjs";
import { createIcon } from "../../assets/client/icons.mjs";
import { createEmptyState } from "../../assets/client/ui-primitives.mjs";
import { createInitialState } from "../../assets/client/state.mjs";
import { hydrateStorage, applyExternalStoragePatch, writeJson, readJson, flushStorage } from "../../assets/client/storage.mjs";
import { sendExtensionRequest as request } from "../../assets/client/api.mjs";
import { getLocale, prepareLocale, setLocale, t, tc } from "../../assets/client/i18n.mjs";

await hydrateStorage(); await prepareLocale("zh-CN"); setLocale("zh-CN", { persist: false });
const views = new Map(), state = createInitialState();
state.cardTypes = { utility: "calendar", digest: "calendar" };
let now = new Date();
const shared = createCalendarCardState({ now: () => now, notify: () => { for (const view of views.values()) view.render(); }, request: message => {
  if (window.fixture?.failNext) { window.fixture.failNext = false; throw new Error("Synthetic calendar storage failure"); }
  if (window.fixture?.pauseNext) {
    window.fixture.pauseNext = false;
    return new Promise(resolve => { window.fixture.resume = () => resolve(request(message)); });
  }
  if (window.fixture?.syncErrorNext) {
    window.fixture.syncErrorNext = false;
    return request(message).then(result => ({ ...result, syncError: {
      code: "SYNC_STORAGE_TOTAL_TOO_LARGE", messageKey: "background.error.syncStorageFull", messageParams: {},
    } }));
  }
  return request(message);
} });
const root = document.getElementById("calendarFixture");
for (const [id, size, height] of [["utility", "compact", 168], ["digest", "tall", 520]]) {
  const slot = document.createElement("div"); slot.className = "dashboard-slot"; slot.dataset.slotSize = size; slot.style.height = height + "px";
  const empty = () => ({ content: document.createElement("div") });
  const view = createSwitchableCardView({
    id, state, t, tc, getLocale, createIcon, createEmptyState, writeJson,
    localizedErrorMessage: error => error.message || String(error), getCalendarState: async () => shared,
    createDailyContent: empty, createDigestContent: empty, createArchiveContent: empty, createQueueContent: empty,
    createEventsContent: () => document.createElement("div"), notifyTodos() {},
  });
  views.set(id, view); slot.append(view.render()); root.append(slot);
  const title = view.card.querySelector(".efficiency-title"); title.tabIndex = 0; title.setAttribute("role", "button");
  view.card.addEventListener("contextmenu", event => { event.preventDefault(); view.contextActions(event.target).at(-1)?.action(); });
}
window.addEventListener("ampira:runtime-message", event => {
  if (!["personal-cards.changed", "content-sync.changed"].includes(event.detail.type)) return;
  applyExternalStoragePatch(event.detail.payload.values); shared.syncFromStorage();
});
window.fixture = {
  views, shared, state, request, readJson, flushStorage,
  async locale(locale) { await prepareLocale(locale); setLocale(locale, { persist: false }); for (const view of views.values()) view.render(); },
  theme(theme) { document.documentElement.dataset.colorMode = theme; },
  async seed(count = 2) {
    const date = calendarToday(now), revision = shared.read().value.revision + 1;
    const items = Array.from({ length: count }, (_, index) => ({ id: "calendar-fixture-" + index, revision: 1,
      title: index === 0 ? "方案复盘" : index === 1 ? "朋友聚餐" : "合成日程 " + (index + 1), date,
      time: index === 0 ? "14:00" : index === 1 ? "18:30" : `${String(index % 24).padStart(2, "0")}:30` }));
    const values = { [CALENDAR_STATE_KEY]: JSON.stringify({ revision, items }) };
    await request({ type: "client-state:set", payload: { values } });
    applyExternalStoragePatch(values); shared.syncFromStorage(); return date;
  },
  swap() {
    const slots = [...root.children], first = slots[0].firstElementChild, second = slots[1].firstElementChild;
    slots[0].append(second); slots[1].append(first);
  },
  clock(value) { now = new Date(value); shared.refreshDay(); },
};
if (new URL(location.href).searchParams.has("seed")) await window.fixture.seed();
await shared.ensure();
window.fixtureReady = true;

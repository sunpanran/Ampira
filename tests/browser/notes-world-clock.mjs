import { createSwitchableCardView } from "../../assets/client/switchable-card-view.mjs";
import { createNotesCardState } from "../../assets/client/notes-card-state.mjs";
import { createWorldClockCardState } from "../../assets/client/world-clock-card-state.mjs";
import { NOTES_STATE_KEY } from "../../extension/core/notes.mjs";
import { WORLD_CLOCK_STATE_KEY } from "../../extension/core/world-clock.mjs";
import { createIcon } from "../../assets/client/icons.mjs";
import { createEmptyState } from "../../assets/client/ui-primitives.mjs";
import { createInitialState } from "../../assets/client/state.mjs";
import { hydrateStorage, applyExternalStoragePatch, writeJson, readJson, flushStorage } from "../../assets/client/storage.mjs";
import { sendExtensionRequest as request } from "../../assets/client/api.mjs";
import { getLocale, prepareLocale, setLocale, t, tc } from "../../assets/client/i18n.mjs";
import { createContextMenuController } from "../../assets/client/context-menu-controller.mjs";
import { createConfirmationDialogController } from "../../assets/client/confirmation-dialog.mjs";

await hydrateStorage(); await prepareLocale("zh-CN"); setLocale("zh-CN", { persist: false });
const views = new Map(), state = createInitialState(), root = document.getElementById("notesClockFixture");
state.cardTypes = { utility: "notes", digest: "worldClock", archive: "notes", news: "worldClock" };
const render = () => { for (const view of views.values()) view.render(); };
const { confirmAction } = createConfirmationDialogController({
  dialog: document.getElementById("confirmationDialog"), kicker: document.getElementById("confirmationKicker"),
  title: document.getElementById("confirmationTitle"), body: document.getElementById("confirmationBody"),
  cancelButton: document.getElementById("confirmationCancel"), confirmButton: document.getElementById("confirmationConfirm"),
});
const contextMenu = createContextMenuController({ menu: document.getElementById("linkContextMenu"), t,
  getCardActions: target => views.get(target.closest("[data-dashboard-card]")?.dataset.dashboardCard)?.contextActions(target) || [],
});
contextMenu.bind();
let initialFailure = new URL(location.href).searchParams.get("failLoad");
const cardRequest = message => {
  if (window.fixture?.failWrites && message.type === "personal-cards:change" && message.payload?.kind === "notes") throw new Error("Synthetic storage failure");
  if (initialFailure === message.payload?.kind) { initialFailure = ""; throw new Error("Synthetic initial load failure"); }
  if (window.fixture?.failNext) { window.fixture.failNext = false; throw new Error("Synthetic storage failure"); }
  if (window.fixture?.pauseNext) { window.fixture.pauseNext = false; return new Promise(resolve => { window.fixture.resume = () => resolve(request(message)); }); }
  return request(message);
};
const notes = createNotesCardState({ request: cardRequest, notify: render });
const worldClock = createWorldClockCardState({ request: cardRequest, notify: render });
for (const [id, size, height] of [["utility", "compact", 168], ["digest", "compact", 168], ["archive", "tall", 460], ["news", "tall", 460]]) {
  const slot = document.createElement("div"); slot.className = "dashboard-slot"; slot.dataset.slotSize = size; slot.style.height = height + "px";
  const empty = () => ({ content: document.createElement("div") });
  const view = createSwitchableCardView({ id, state, t, tc, getLocale, createIcon, createEmptyState, writeJson,
    localizedErrorMessage: error => error.message || String(error), getNotesState: async () => notes, getWorldClockState: async () => worldClock,
    createDailyContent: empty, createDigestContent: empty, createArchiveContent: empty, createQueueContent: empty,
    createEventsContent: () => document.createElement("div"), notifyTodos() {},
    confirmAction: options => { window.fixture.confirmation = options; return confirmAction(options); },
  });
  views.set(id, view); slot.append(view.render()); root.append(slot);
  const title = view.card.querySelector(".efficiency-title"); title.tabIndex = 0; title.setAttribute("role", "button");
}
window.addEventListener("ampira:runtime-message", event => {
  if (!["personal-cards.changed", "content-sync.changed"].includes(event.detail.type)) return;
  applyExternalStoragePatch(event.detail.payload.values); notes.syncFromStorage(); worldClock.syncFromStorage();
});
window.fixture = { state, views, notes, worldClock, request, render, readJson, flushStorage,
  async locale(locale) { await prepareLocale(locale); setLocale(locale, { persist: false }); render(); },
  theme(theme) { document.documentElement.dataset.colorMode = theme; },
  async seed() {
    const values = {
      [NOTES_STATE_KEY]: JSON.stringify({ revision: notes.read().value.revision + 1, items: [
        { id: "fixture-pinned", revision: 1, text: "下周方案\n把开场镜头的节奏再收紧一点，留出角色回头的停顿。", pinned: true, createdAt: Date.now(), updatedAt: Date.now() },
        { id: "fixture-link", revision: 1, text: "参考资料\nhttps://example.com/reference\n周末整理色彩和构图参考。", pinned: false, createdAt: Date.now(), updatedAt: Date.now() - 60_000 },
      ] }),
      [WORLD_CLOCK_STATE_KEY]: JSON.stringify({ revision: worldClock.read().value.revision + 1,
        items: ["london", "newYork", "tokyo"].map(id => ({ id, revision: 1 })) }),
    };
    await request({ type: "client-state:set", payload: { values } }); applyExternalStoragePatch(values); notes.syncFromStorage(); worldClock.syncFromStorage();
  },
};
await notes.ensure(); await worldClock.ensure();
if (new URL(location.href).searchParams.has("seed")) await window.fixture.seed();
window.fixtureReady = true;

import { DASHBOARD_CARD_IDS } from "../../extension/core/dashboard-layout.mjs";
import { createDashboardLayoutState } from "./dashboard-layout-state.mjs";
import { bindDashboardLayoutDrag } from "./dashboard-layout-drag.mjs";
import { createDashboardLayoutMotion } from "./dashboard-layout-motion.mjs";

export function createDashboardLayoutController({ state, els, t, request, localizedErrorMessage }) {
  const root = els.dailyBoard.closest(".daily-shell");
  const cards = new Map();
  root.classList.add("has-dashboard-layout");
  const slots = DASHBOARD_CARD_IDS.map((id, index) => {
    const slot = document.createElement("div");
    slot.className = "dashboard-slot";
    slot.dataset.dashboardSlot = String(index);
    slot.dataset.slotSize = index < 3 ? "compact" : "tall";
    (index < 3 ? els.efficiencyPanel : els.dailyBoard).append(slot);
    return slot;
  });
  const help = document.createElement("span");
  help.id = "dashboardLayoutHelp";
  help.className = "sr-only";
  const feedback = document.createElement("div");
  feedback.className = "dashboard-layout-feedback sr-only";
  feedback.setAttribute("role", "status");
  feedback.setAttribute("aria-live", "polite");
  els.dailySection.append(help, feedback);
  let feedbackTimer = 0;
  const motion = createDashboardLayoutMotion(cards);
  let drag;
  const layout = createDashboardLayoutState({
    initialOrder: state.settings?.dashboardCardOrder,
    save: (dashboardCardOrder) => request({ type: "settings:save", payload: { dashboardCardOrder } }),
    apply: applyOrder,
    setBusy: (busy) => {
      root.classList.toggle("is-layout-saving", busy);
      for (const card of cards.values()) decorate(card);
    },
    feedback: (status, error) => announce(t(`layout.${status}`, { message: error ? localizedErrorMessage(error) : "" }), status === "failed"),
  });
  drag = bindDashboardLayoutDrag({ root, getCard, getOrder: layout.getOrder, isBusy: layout.isBusy, swap: layout.swap, announce, t, motion });

  function announce(message, error = false) {
    clearTimeout(feedbackTimer);
    feedback.textContent = message;
    feedback.classList.toggle("sr-only", !error);
    feedback.classList.toggle("is-error", error);
    feedbackTimer = setTimeout(() => { feedback.textContent = ""; feedback.classList.add("sr-only"); }, error ? 6000 : 3000);
  }

  function getCard(id) { return cards.get(id); }

  function decorate(card) {
    help.textContent = t("layout.help");
    const title = card.querySelector(".efficiency-title, .column-title");
    if (!title) return;
    title.tabIndex = 0;
    title.setAttribute("role", "button");
    title.setAttribute("aria-describedby", help.id);
    title.setAttribute("aria-disabled", String(layout.isBusy()));
    if (!title.hasAttribute("aria-pressed")) title.setAttribute("aria-pressed", "false");
    title.title = t("layout.dragHint");
  }

  function prepare(id, card) {
    card.dataset.dashboardCard = id;
    decorate(card);
    return card;
  }

  function mount(id, card) {
    if (!DASHBOARD_CARD_IDS.includes(id)) return;
    const previous = cards.get(id);
    if (previous !== card) {
      if (drag.isActive()) drag.cancel();
      previous?.replaceWith(card);
      cards.set(id, card);
    }
    prepare(id, card);
    const slot = slots[layout.getOrder().indexOf(id)];
    if (card.parentElement !== slot) slot.append(card);
  }

  function applyOrder(order) {
    state.settings = { ...(state.settings || {}), dashboardCardOrder: [...order] };
    if (order.every((id, index) => !cards.has(id) || cards.get(id).parentElement === slots[index])) return;
    // Read the visible positions before cancelling a drag or an in-flight swap.
    const previous = motion.capture();
    const foreground = root.querySelector(".is-layout-source")?.dataset.dashboardCard;
    drag?.cancel({ animate: false });
    motion.stop();
    const active = document.activeElement;
    const scroll = Array.from(root.querySelectorAll("[data-dashboard-card], [data-dashboard-card] *"))
      .filter((node) => node.scrollTop || node.scrollLeft).map((node) => [node, node.scrollTop, node.scrollLeft]);
    order.forEach((id, index) => {
      const card = cards.get(id);
      if (!card || card.parentElement === slots[index]) return;
      if (typeof slots[index].moveBefore === "function" && card.isConnected) slots[index].moveBefore(card, null);
      else slots[index].append(card);
    });
    if (root.contains(active) && document.activeElement !== active) active.focus({ preventScroll: true });
    for (const [node, top, left] of scroll) { node.scrollTop = top; node.scrollLeft = left; }
    motion.play(previous, foreground);
  }

  function sync() {
    layout.sync(state.settings?.dashboardCardOrder);
    for (const card of cards.values()) decorate(card);
  }

  return {
    root, getCard, mount, prepare, sync,
    receive: (order) => layout.sync(order, { external: true }),
    cancelDrag: () => drag.cancel(),
    isInteracting: () => drag.isActive() || layout.isBusy(),
  };
}

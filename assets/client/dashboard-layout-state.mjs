import { normalizeDashboardCardOrder, swapDashboardCards } from "../../extension/core/dashboard-layout.mjs";

export function createDashboardLayoutState({ initialOrder, save, apply, feedback, setBusy }) {
  let order = normalizeDashboardCardOrder(initialOrder);
  let pending = null;
  const equal = (left, right) => left.every((id, index) => id === right[index]);

  function sync(value, { external = false } = {}) {
    const next = normalizeDashboardCardOrder(value);
    if (pending) {
      if (external) pending.external = next;
      return;
    }
    if (equal(order, next)) return;
    order = next;
    apply(order);
  }

  async function swap(from, to) {
    if (pending) return false;
    const next = swapDashboardCards(order, from, to);
    if (equal(order, next)) return false;
    const operation = { previous: order, external: null };
    pending = operation;
    order = next;
    apply(order);
    setBusy(true);
    feedback("saving");
    try {
      const saved = await save(next);
      order = operation.external || normalizeDashboardCardOrder(saved?.dashboardCardOrder ?? next);
      feedback("saved");
      return true;
    } catch (error) {
      order = operation.external || operation.previous;
      feedback("failed", error);
      return false;
    } finally {
      pending = null;
      // A quick save acknowledgement must not interrupt the optimistic move.
      if (!equal(order, next)) apply(order);
      setBusy(false);
    }
  }

  return { sync, swap, getOrder: () => [...order], isBusy: () => Boolean(pending) };
}

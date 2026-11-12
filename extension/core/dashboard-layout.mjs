export const DASHBOARD_CARD_IDS = Object.freeze(["utility", "digest", "archive", "news", "inspiration", "queue"]);

export function normalizeDashboardCardOrder(value) {
  const order = Array.isArray(value) ? [...new Set(value.filter((id) => DASHBOARD_CARD_IDS.includes(id)))] : [];
  return [...order, ...DASHBOARD_CARD_IDS.filter((id) => !order.includes(id))];
}

export function swapDashboardCards(value, from, to) {
  const order = normalizeDashboardCardOrder(value);
  const left = order.indexOf(from);
  const right = order.indexOf(to);
  if (left >= 0 && right >= 0) [order[left], order[right]] = [order[right], order[left]];
  return order;
}

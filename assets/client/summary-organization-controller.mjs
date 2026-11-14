import { itemUrl, displaySummaryTitle } from "./item-presenter.mjs";
import { restartMotionClass } from "./motion.mjs";
import { aiTaskLabelKey, summaryTaskPhase } from "./ai-task-state.mjs";

export function createSummaryOrganizationController(options) {
  const {
    state, t, confirmManualAiUsage, request, loadDashboard, findNewsItemByReference, renderStatus,
    localizedResponseMessage, localizedErrorMessage, renderOverviewStatus, updateSummaryCard,
  } = options;
  return refreshSummaryItem;
async function refreshSummaryItem(item, event) {
  event.preventDefault();
  event.stopPropagation();
  const button = event.currentTarget;
  if (state.manualRefreshKeys.has(item.key)) return;
  if (state.data?.organization?.provider !== "bot" && !await confirmManualAiUsage()) return;
  if (state.manualRefreshKeys.has(item.key)) return;

  const articleUrl = itemUrl(item);
  let latestItem = item;
  let completed = false;
  state.manualRefreshKeys.add(item.key);
  state.manualSummaryFailures?.delete(item.key);
  const activeCard = button?.closest?.(".summary-card");
  setManualSummaryLoadingState(button, activeCard, summaryTaskPhase(state, item.key));
  updateSummaryCard(item);
  try {
    const result = await request({ type: "summary:refresh", payload: {
      articleId: item.feedItem?.articleId || item.key,
      sourceKey: item.sourceKey,
      url: articleUrl,
    } });
    if (!result.ok) throw new Error(localizedResponseMessage(result, "error.requestFailed"));
    await loadDashboard({ render: false });
    latestItem = findNewsItemByReference({
      articleId: item.feedItem?.articleId || item.key,
      sourceKey: item.sourceKey,
      url: itemUrl(item),
      title: displaySummaryTitle(item),
    }) || item;
    if (state.data?.ai && result.quota) {
      state.data.ai.usedToday = result.quota.usedToday;
      state.data.ai.dailyLimit = result.quota.dailyLimit;
      renderStatus();
    }
    completed = result.status === undefined || result.status === "completed";
  } catch (error) {
    (state.manualSummaryFailures ||= new Set()).add(item.key);
    renderOverviewStatus(t("summary.manualFailed"), localizedErrorMessage(error));
  } finally {
    state.manualRefreshKeys.delete(item.key);
    if (!activeCard?.dataset.key || activeCard.dataset.key === item.key) activeCard?.removeAttribute("aria-busy");
    const card = updateSummaryCard(latestItem);
    if (completed) restartMotionClass(card, "is-ai-resolving");
  }
}

function setManualSummaryLoadingState(button, card, phase) {
  if (card) {
    card.setAttribute("aria-busy", "true");
  }
  if (!button) return;
  const label = t(aiTaskLabelKey(phase));
  button.disabled = true;
  button.title = label;
  button.setAttribute("aria-label", label);
}

}

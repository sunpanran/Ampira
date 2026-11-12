import { usesBotChat } from "../../extension/core/bot-mode.mjs";

export function searchCopyKeys(aiEnabled) {
  const mode = aiEnabled === true ? "ai" : "local";
  return {
    dialogMeta: `aiSearch.${mode}.meta`,
    dialogInput: `aiSearch.${mode}.input`,
  };
}

export function syncSearchCopy({ state, els, t, forceDialog = false }) {
  const keys = searchCopyKeys(state.data?.ai?.enabled === true);
  els.aiSearchNav.setAttribute("aria-label", t("search.unified.open"));
  els.aiSearchNav.title = t("search.unified.open");

  const dialogOpen = els.aiSearchOverlay.classList.contains("open");
  if (dialogOpen && !forceDialog) return keys;
  els.aiSearchTitleText.textContent = t("aiSearch.workspaceTitle");
  els.aiSearchMeta.textContent = t(keys.dialogMeta);
  const input = t(keys.dialogInput);
  els.aiSearchInput.placeholder = input;
  els.aiSearchInput.setAttribute("aria-label", input);
  els.aiSearchSubmit.setAttribute("aria-label", t("aiSearch.send"));
  els.aiSearchSubmit.title = t("aiSearch.send");
  if (usesBotChat(state.data)) {
    els.aiSearchMeta.textContent = t("bot.asyncHint");
    els.aiSearchInput.placeholder = t("bot.messagePlaceholder");
    els.aiSearchInput.setAttribute("aria-label", t("bot.messagePlaceholder"));
    els.aiSearchSubmit.setAttribute("aria-label", t("bot.send"));
    els.aiSearchSubmit.title = t("bot.send");
  }
  return keys;
}

export function searchCopyKeys(aiEnabled, browserSearchEnabled = false) {
  const mode = aiEnabled === true ? "ai" : "local";
  return {
    placeholder: browserSearchEnabled ? "search.browser.placeholder" : `search.${mode}.placeholder`,
    action: browserSearchEnabled ? "search.browser.action" : `search.${mode}.action`,
    dialogMeta: `aiSearch.${mode}.meta`,
    dialogInput: `aiSearch.${mode}.input`,
  };
}

export function syncSearchCopy({ state, els, t, forceDialog = false }) {
  const keys = searchCopyKeys(
    state.data?.ai?.enabled === true,
    state.settings?.browserSearchEnabled === true,
  );
  els.search.placeholder = t(keys.placeholder);
  els.topAiSearch.setAttribute("aria-label", t(keys.action));
  els.topAiSearch.title = t(keys.action);

  const dialogOpen = els.aiSearchOverlay.classList.contains("open");
  if (dialogOpen && !forceDialog) return keys;
  els.aiSearchTitleText.textContent = t("aiSearch.workspaceTitle");
  els.aiSearchMeta.textContent = t(keys.dialogMeta);
  const input = t(keys.dialogInput);
  els.aiSearchInput.placeholder = input;
  els.aiSearchInput.setAttribute("aria-label", input);
  els.aiSearchSubmit.setAttribute("aria-label", t("aiSearch.send"));
  els.aiSearchSubmit.title = t("aiSearch.send");
  return keys;
}

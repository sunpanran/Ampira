export function searchCopyKeys(aiEnabled, browserSearchEnabled = false) {
  const mode = aiEnabled === true ? "ai" : "local";
  return {
    placeholder: browserSearchEnabled ? "search.browser.placeholder" : `search.${mode}.placeholder`,
    action: browserSearchEnabled ? "search.browser.action" : `search.${mode}.action`,
    dialogTitle: `aiSearch.${mode}.title`,
    dialogMeta: `aiSearch.${mode}.meta`,
    dialogInput: `aiSearch.${mode}.input`,
    dialogSubmit: `aiSearch.${mode}.submit`,
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
  const title = t(keys.dialogTitle);
  els.aiSearchOverlay.setAttribute("aria-label", title);
  els.aiSearchTitleText.textContent = title;
  els.aiSearchMeta.textContent = t(keys.dialogMeta);
  const input = t(keys.dialogInput);
  els.aiSearchInput.placeholder = input;
  els.aiSearchInput.setAttribute("aria-label", input);
  els.aiSearchSubmit.textContent = t(keys.dialogSubmit);
  return keys;
}

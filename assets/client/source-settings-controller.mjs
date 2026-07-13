export function createSourceSettingsController(options) {
  const {
    state, els, t, tc, apiPost, setIconLabel, createEmptyState, renderSettingsStatus,
    runSettingsAction, localizedResponseMessage, localizedErrorMessage, localizedSourceLabel,
    localizedSourceReason, localizedExclusionReason, formatDateTime, normalizeUrl,
    allTranslations, newsCardType, newsSectionName, legacyNewsSection, legacyInspirationSection,
  } = options;
  return {
    currentExcludedNewsSources,
    availableNewsFolders,
    renderExcludeFolderOptions,
    addNewsExclusion,
    addNewsFolderExclusion,
    clearSourceSuggestions,
    blockAllSourceSuggestions,
    renderExclusionList,
    renderSourceSuggestionList,
    syncSourceSuggestionActionState,
  };
function currentExcludedNewsSources() {
  return Array.isArray(state.settings?.excludedNewsSources) ? state.settings.excludedNewsSources : [];
}

function availableNewsFolders() {
  const settingsFolders = Array.isArray(state.settings?.availableNewsFolders) ? state.settings.availableNewsFolders : [];
  if (settingsFolders.length) return settingsFolders;
  const folders = [];
  for (const section of state.data?.sections || []) {
    if (section.cardType !== newsCardType) continue;
    for (const category of section.categories || []) {
      const name = String(category.name || "").trim();
      if (!name) continue;
      folders.push({
        type: "folder",
        section: section.name,
        category: name,
        folderPath: name,
        value: `${section.name}/${name}`,
        title: `${section.name} / ${name}`,
        count: Number(category.count || 0),
      });
    }
  }
  return folders;
}

function renderExcludeFolderOptions() {
  const folders = availableNewsFolders();
  const previousValue = els.excludeFolderSelect.value;
  if (!folders.length) {
    const option = new Option(t("exclusion.noFolders"), "");
    els.excludeFolderSelect.replaceChildren(option);
    els.excludeFolderSelect.disabled = true;
    els.addExcludeFolder.disabled = true;
    return;
  }
  const excluded = new Set(currentExcludedNewsSources().map(exclusionClientIdentity).filter(Boolean));
  const options = folders.map((folder) => {
    const value = folder.value || folderExclusionValue(folder);
    const count = Number(folder.count || 0);
    const label = `${folder.title || folderDisplayName(folder)}${count ? ` (${count})` : ""}`;
    const option = new Option(excluded.has(exclusionClientIdentity({ ...folder, type: "folder", value }))
      ? t("exclusion.optionBlocked", { label })
      : label, value);
    option.dataset.section = folder.section || newsSectionName();
    option.dataset.category = folder.category || "";
    option.dataset.folderPath = folder.folderPath || folder.category || "";
    option.dataset.title = folder.title || folderDisplayName(folder);
    option.dataset.count = String(count);
    option.disabled = excluded.has(exclusionClientIdentity({ ...folder, type: "folder", value }));
    return option;
  });
  els.excludeFolderSelect.replaceChildren(...options);
  els.excludeFolderSelect.disabled = false;
  els.addExcludeFolder.disabled = false;
  if (previousValue && [...els.excludeFolderSelect.options].some((option) => option.value === previousValue && !option.disabled)) {
    els.excludeFolderSelect.value = previousValue;
  } else {
    const firstAvailable = [...els.excludeFolderSelect.options].find((option) => !option.disabled);
    els.excludeFolderSelect.value = firstAvailable?.value || "";
  }
  els.addExcludeFolder.disabled = !els.excludeFolderSelect.value || els.excludeFolderSelect.selectedOptions[0]?.disabled;
}

function addNewsExclusion() {
  const value = els.excludeInput.value.trim();
  if (!value) {
    renderSettingsStatus(t("exclusion.enterSource"));
    return;
  }
  const list = currentExcludedNewsSources();
  const identity = exclusionClientIdentity({ value });
  if (identity && list.some((item) => exclusionClientIdentity(item) === identity)) {
    renderSettingsStatus(t("exclusion.alreadyBlocked"));
    return;
  }
  state.settings = {
    ...(state.settings || {}),
    excludedNewsSources: [
      ...list,
      {
        id: `manual-${Date.now()}`,
        value,
        title: value,
        reasonKey: "exclusion.reason.manual",
        addedAt: new Date().toISOString(),
        streak: 0,
      },
    ],
  };
  els.excludeInput.value = "";
  renderExclusionList();
  renderSettingsStatus(t("exclusion.added"));
}

function addNewsFolderExclusion() {
  const option = els.excludeFolderSelect.selectedOptions[0];
  if (!option?.value) {
    renderSettingsStatus(t("exclusion.selectFolder"));
    return;
  }
  const folder = {
    type: "folder",
    value: option.value,
    section: option.dataset.section || newsSectionName(),
    category: option.dataset.category || option.dataset.folderPath || option.textContent,
    folderPath: option.dataset.folderPath || option.dataset.category || "",
    title: option.dataset.title || option.textContent,
  };
  const list = currentExcludedNewsSources();
  const identity = exclusionClientIdentity(folder);
  if (identity && list.some((item) => exclusionClientIdentity(item) === identity)) {
    renderSettingsStatus(t("exclusion.folderAlreadyBlocked"));
    return;
  }
  state.settings = {
    ...(state.settings || {}),
    excludedNewsSources: [
      ...list,
      {
        id: `folder-${Date.now()}`,
        ...folder,
        reasonKey: "exclusion.reason.manualFolder",
        addedAt: new Date().toISOString(),
        streak: 0,
      },
    ],
  };
  renderExclusionList();
  renderSettingsStatus(t("exclusion.folderAdded"));
}

function removeNewsExclusion(id) {
  const list = currentExcludedNewsSources();
  state.settings = {
    ...(state.settings || {}),
    excludedNewsSources: list.filter((item, index) => exclusionClientId(item, index) !== id),
  };
  renderExclusionList();
  renderSettingsStatus(t("exclusion.restored"));
}

function clearSourceSuggestions() {
  const checked = Number(sourceQualitySummary().checked || 0);
  if (!checked) {
    renderSettingsStatus(t("exclusion.suggestionsEmpty"));
    return Promise.resolve();
  }
  if (!window.confirm(t("exclusion.clearSuggestionsConfirm", { count: checked }))) return Promise.resolve();
  return runSettingsAction(async (isCurrent) => {
    try {
      const result = await apiPost("/api/source-quality/reset");
      if (!isCurrent()) return;
      const sourceQuality = result.sourceQuality || { checked: 0, reviewCount: 0, keepCount: 0, suggestions: [] };
      if (state.data) state.data.sourceQuality = sourceQuality;
      if (state.settings) state.settings.sourceQuality = sourceQuality;
      renderExclusionList();
      renderSettingsStatus(localizedResponseMessage(result, "exclusion.suggestionsCleared"));
    } catch (error) {
      if (isCurrent()) renderSettingsStatus(t("exclusion.clearSuggestionsFailed", { message: localizedErrorMessage(error) }));
    }
  });
}

function blockAllSourceSuggestions() {
  const suggestions = actionableSourceSuggestions();
  if (!suggestions.length) return;
  if (!window.confirm(t("exclusion.blockAllConfirm", { count: suggestions.length }))) return;
  const addedAt = new Date().toISOString();
  const timestamp = Date.now();
  const next = [...currentExcludedNewsSources()];
  suggestions.forEach((suggestion, index) => {
    if (sourceSuggestionAlreadyExcluded(suggestion, next)) return;
    next.push({
      id: `suggested-${timestamp}-${index}`,
      ...sourceSuggestionDraft(suggestion),
      addedAt,
    });
  });
  const addedCount = next.length - currentExcludedNewsSources().length;
  state.settings = {
    ...(state.settings || {}),
    excludedNewsSources: next,
  };
  renderExclusionList();
  renderSettingsStatus(t("exclusion.blockAllAdded", { count: addedCount }));
}

function renderExclusionList() {
  const list = currentExcludedNewsSources();
  renderExcludeFolderOptions();
  renderSourceSuggestionList();
  syncSourceSuggestionActionState();
  els.exclusionStatus.textContent = list.length
    ? tc("exclusion.ruleCount", list.length)
    : t("exclusion.keepAll");
  if (!list.length) {
    els.exclusionList.replaceChildren(createEmptyState({
      title: t("exclusion.empty.title"),
      body: t("exclusion.empty.body"),
      variant: "compact",
    }));
    return;
  }
  els.exclusionList.replaceChildren(...list.map(createExclusionRow));
}

function renderSourceSuggestionList() {
  if (!els.sourceSuggestionList || !els.sourceSuggestionStatus) return;
  const summary = sourceQualitySummary();
  const checked = Number(summary.checked || 0);
  const suggestions = actionableSourceSuggestions();
  els.sourceSuggestionStatus.textContent = suggestions.length
    ? tc("exclusion.pendingSuggestions", suggestions.length)
    : t(checked ? "exclusion.nonePending" : "exclusion.waitingStats");
  if (!suggestions.length) {
    els.sourceSuggestionList.replaceChildren(createEmptyState({
      title: t("exclusion.suggestionEmpty.title"),
      body: t(checked ? "exclusion.suggestionEmpty.checked" : "exclusion.suggestionEmpty.waiting"),
      variant: "compact",
    }));
    return;
  }
  els.sourceSuggestionList.replaceChildren(...suggestions.slice(0, 8).map(createSourceSuggestionRow));
}

function actionableSourceSuggestions() {
  const suggestions = Array.isArray(sourceQualitySummary().suggestions) ? sourceQualitySummary().suggestions : [];
  const excluded = currentExcludedNewsSources();
  return suggestions.filter((suggestion) => suggestion?.action
    && suggestion.action !== "keep"
    && sourceSuggestionDraft(suggestion).value
    && !sourceSuggestionAlreadyExcluded(suggestion, excluded));
}

function syncSourceSuggestionActionState(busy = false) {
  els.clearSourceSuggestions.disabled = busy || !Number(sourceQualitySummary().checked || 0);
  els.blockAllSuggestions.disabled = busy || !actionableSourceSuggestions().length;
}

function sourceQualitySummary() {
  return state.data?.sourceQuality || state.settings?.sourceQuality || {};
}

function sourceSuggestionAlreadyExcluded(suggestion, excluded) {
  const suggestionIdentity = exclusionClientIdentity(sourceSuggestionDraft(suggestion));
  return excluded.some((item) => {
    if (item?.sourceKey && suggestion?.sourceKey && item.sourceKey === suggestion.sourceKey) return true;
    return suggestionIdentity && exclusionClientIdentity(item) === suggestionIdentity;
  });
}

function createSourceSuggestionRow(suggestion) {
  const row = document.createElement("div");
  row.className = `source-suggestion-row is-${suggestion.action || "neutral"}`;
  const main = document.createElement("div");
  main.className = "source-suggestion-main";
  const title = document.createElement("div");
  title.className = "source-suggestion-title";
  title.textContent = suggestion.title || suggestion.host || t("exclusion.unnamedSource");
  const meta = document.createElement("div");
  meta.className = "source-suggestion-meta";
  const checks = Number(suggestion.checks || 0);
  meta.textContent = [localizedSourceLabel(suggestion.label, suggestion.labelKey), localizedSourceReason(suggestion.reason, suggestion.reasonKey), checks ? t("exclusion.recentChecks", { count: checks }) : ""].filter(Boolean).join(" · ");
  main.append(title, meta);
  const action = document.createElement("button");
  action.className = "btn";
  action.type = "button";
  setIconLabel(action, "block", t("settings.exclusions.block"));
  action.addEventListener("click", () => addSuggestedNewsExclusion(suggestion));
  row.append(main, action);
  return row;
}

function addSuggestedNewsExclusion(suggestion) {
  const draft = sourceSuggestionDraft(suggestion);
  if (!draft.value) {
    renderSettingsStatus(t("exclusion.missingValue"));
    return;
  }
  const list = currentExcludedNewsSources();
  if (sourceSuggestionAlreadyExcluded(suggestion, list)) {
    renderSettingsStatus(t("exclusion.alreadyBlocked"));
    return;
  }
  state.settings = {
    ...(state.settings || {}),
    excludedNewsSources: [
      ...list,
      {
        id: `suggested-${Date.now()}`,
        ...draft,
        addedAt: new Date().toISOString(),
      },
    ],
  };
  renderExclusionList();
  renderSettingsStatus(t("exclusion.added"));
}

function sourceSuggestionDraft(suggestion = {}) {
  const value = suggestion.host || suggestion.url || "";
  const reasonDetail = [localizedSourceLabel(suggestion.label, suggestion.labelKey), localizedSourceReason(suggestion.reason, suggestion.reasonKey)].filter(Boolean).join(" · ");
  return {
    value,
    host: suggestion.host || "",
    url: suggestion.url || "",
    sourceKey: suggestion.sourceKey || "",
    title: suggestion.title || suggestion.host || value || t("exclusion.unnamedSource"),
    reasonKey: "exclusion.reason.suggestion",
    reasonDetail,
    streak: Number(suggestion.consecutiveFailures || 0),
  };
}

function createExclusionRow(item, index) {
  const row = document.createElement("div");
  row.className = "exclude-row";
  const main = document.createElement("div");
  main.className = "exclude-main";
  const title = document.createElement("div");
  title.className = "exclude-title";
  title.textContent = item.title || folderDisplayName(item) || item.host || item.value || t("exclusion.unnamedSource");
  const meta = document.createElement("div");
  meta.className = "exclude-meta";
  const added = item.addedAt ? formatDateTime(item.addedAt) : t("exclusion.timeUnknown");
  const streak = Number(item.streak || 0);
  const streakText = streak > 0 ? t("exclusion.streak", { count: streak }) : "";
  const targetText = item.type === "folder" ? t("exclusion.folderTarget", { name: folderDisplayName(item) }) : (item.host || item.value || "-");
  meta.textContent = t("exclusion.meta", { target: targetText, streak: streakText, added });
  const reason = document.createElement("div");
  reason.className = "exclude-reason";
  reason.textContent = localizedExclusionReason(item);
  main.append(title, meta, reason);
  const action = document.createElement("button");
  action.className = "btn";
  action.type = "button";
  setIconLabel(action, "refresh-cw-01", t("exclusion.restore"));
  action.addEventListener("click", () => removeNewsExclusion(exclusionClientId(item, index)));
  row.append(main, action);
  return row;
}

function exclusionClientId(item, index) {
  return item.id || exclusionClientIdentity(item) || `exclude-${index}`;
}

function exclusionClientIdentity(item) {
  if (isFolderExclusion(item)) return `folder:${folderExclusionValue(item)}`;
  const value = String(item?.value || item?.url || item?.host || "").trim();
  if (!value) return "";
  try {
    const parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    const path = parsed.pathname.replace(/\/+$/, "");
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) && path && path !== "/") return `url:${normalizeUrl(parsed.toString())}`;
    return `host:${host}`;
  } catch {
    return `host:${value.replace(/^www\./, "").toLowerCase()}`;
  }
}

function isFolderExclusion(item) {
  if (item?.type === "folder") return true;
  const id = String(item?.id || "");
  const reason = String(item?.reason || "");
  const isLegacyFolderReason = allTranslations("exclusion.reason.manualFolder").some((value) => reason.includes(value));
  return (id.startsWith("folder-") || item?.reasonKey === "exclusion.reason.manualFolder" || isLegacyFolderReason)
    && Boolean(folderExclusionValue(item));
}

function folderExclusionValue(item) {
  const rawValue = String(item?.value || "").trim();
  if (rawValue && /[\\/／]/.test(rawValue)) return normalizeFolderValue(rawValue);
  const section = String(item?.section || newsSectionName()).trim() || newsSectionName();
  const folderPath = stripFolderSection(normalizeFolderPath(item?.folderPath || item?.category || item?.title || rawValue), section);
  return normalizeFolderValue(`${section}/${folderPath}`);
}

function folderDisplayName(item) {
  const section = String(item?.section || newsSectionName()).trim() || newsSectionName();
  const folderPath = stripFolderSection(normalizeFolderPath(item?.folderPath || item?.category || item?.title || ""), section);
  if (!folderPath) return "";
  return `${section} / ${folderPath.replace(/\//g, " / ")}`;
}

function stripFolderSection(folderPath, section) {
  const parts = normalizeFolderPath(folderPath).split("/").filter(Boolean);
  if (parts[0] === section) parts.shift();
  return parts.join("/");
}

function normalizeFolderValue(value) {
  const parts = String(value || "")
    .split(/[\\/]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) return "";
  const knownSections = new Set([
    ...(state.data?.sections || []).map((section) => section.name),
    legacyNewsSection,
    legacyInspirationSection,
  ]);
  if (!knownSections.has(parts[0])) parts.unshift(newsSectionName());
  return parts.join("/");
}

function normalizeFolderPath(value) {
  return String(value || "")
    .split(/[\\/]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/");
}
}

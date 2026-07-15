import { headerCoverImageErrorKey, optimizeHeaderCoverFile } from "./header-cover-image.mjs";

export function createHeaderCoverController(options) {
  const { state, els, t, apiGet } = options;
  let savedRecord = null;
  let savedExists = false;
  let savedInvalid = false;
  let draftRecord = null;
  let externalBusy = false;
  let loadGeneration = 0;
  let externalReloadPending = false;

  function bind() {
    els.headerImageLocalChoose.addEventListener("click", () => els.headerImageLocalInput.click());
    els.headerImageLocalInput.addEventListener("change", handleFileSelection);
    els.headerImageLocalRemove.addEventListener("click", remove);
  }

  async function load() {
    const generation = ++loadGeneration;
    try {
      const result = await apiGet("/api/settings/header-cover");
      if (generation !== loadGeneration) return false;
      savedRecord = result?.record || null;
      savedExists = result?.available === true || result?.invalid === true;
      savedInvalid = result?.invalid === true;
      draftRecord = savedRecord;
      state.localHeaderCover = draftRecord;
      externalReloadPending = false;
      syncControls();
      return true;
    } catch {
      if (generation !== loadGeneration) return false;
      syncControls();
      return false;
    }
  }

  function operation() {
    if (draftRecord && (!savedRecord || draftRecord.dataUrl !== savedRecord.dataUrl)) {
      return { action: "replace", record: draftRecord };
    }
    if (!draftRecord && savedExists) return { action: "remove" };
    return null;
  }

  function savePayload() {
    const value = operation();
    return value ? { headerCoverOperation: value } : {};
  }

  function hasChanges() {
    return Boolean(operation());
  }

  function commit() {
    savedRecord = draftRecord;
    savedExists = Boolean(draftRecord);
    savedInvalid = false;
    externalReloadPending = false;
    syncControls();
  }

  function restore() {
    if (externalReloadPending) {
      externalReloadPending = false;
      load().then((loaded) => {
        if (loaded) options.updatePreview();
        else externalReloadPending = true;
      });
      return;
    }
    draftRecord = savedRecord;
    state.localHeaderCover = draftRecord;
    syncControls();
  }

  function markExternalChange() {
    externalReloadPending = true;
  }

  function setBusy(value) {
    externalBusy = value === true;
    syncControls();
  }

  function remove() {
    if (externalBusy || (!draftRecord && !savedInvalid)) return;
    draftRecord = null;
    state.localHeaderCover = null;
    savedInvalid = false;
    syncControls();
    options.updatePreview();
    options.renderSettingsStatus(t("settings.headerImage.localRemovedDraft"));
  }

  async function handleFileSelection() {
    const file = els.headerImageLocalInput.files?.[0];
    els.headerImageLocalInput.value = "";
    if (!file || externalBusy) return;
    options.setSettingsBusy(true);
    options.renderSettingsStatus(t("settings.headerImage.localProcessing"));
    try {
      const record = await optimizeHeaderCoverFile(file);
      draftRecord = record;
      state.localHeaderCover = record;
      savedInvalid = false;
      syncControls();
      options.updatePreview();
      options.renderSettingsStatus(t("settings.headerImage.localReady"));
    } catch (error) {
      options.renderSettingsStatus(t(headerCoverImageErrorKey(error)));
    } finally {
      options.setSettingsBusy(false);
    }
  }

  function syncControls() {
    const record = draftRecord;
    els.headerImageLocalChooseLabel.textContent = t(record
      ? "settings.headerImage.localReplace"
      : "settings.headerImage.localChoose");
    els.headerImageLocalStatus.textContent = record
      ? t("settings.headerImage.localActive")
      : savedInvalid
        ? t("settings.headerImage.localInvalid")
        : t("settings.headerImage.localEmpty");
    els.headerImageLocalMeta.hidden = !record;
    els.headerImageLocalMeta.textContent = record
      ? t("settings.headerImage.localMeta", {
        name: record.name,
        width: record.width,
        height: record.height,
        size: formatBytes(record.byteLength),
      })
      : "";
    els.headerImageLocalRemove.hidden = !record && !savedInvalid;
    els.headerImageLocalInput.disabled = externalBusy;
    els.headerImageLocalChoose.disabled = externalBusy;
    els.headerImageLocalRemove.disabled = externalBusy;
  }

  return { bind, load, operation, savePayload, hasChanges, commit, restore, markExternalChange, setBusy, syncControls };
}

function formatBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

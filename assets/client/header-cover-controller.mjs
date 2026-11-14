export function createHeaderCoverController(options) {
  const { state, els, t, request, hero } = options;
  let savedRecord = null;
  let savedExists = false;
  let savedInvalid = false;
  let draftRecord = null;
  let externalBusy = false;
  let loadGeneration = 0;
  let externalReloadPending = false;
  let selectionGeneration = 0;

  function bind() {
    hero?.addEventListener("headermediastatechange", syncControls);
    els.headerImageLocalChoose.addEventListener("click", () => els.headerImageLocalInput.click());
    els.headerImageLocalInput.addEventListener("change", handleFileSelection);
    els.headerImageLocalRemove.addEventListener("click", remove);
  }

  async function load() {
    const generation = ++loadGeneration;
    selectionGeneration += 1;
    try {
      const result = await request({ type: "header-cover:get" });
      if (generation !== loadGeneration) return false;
      savedRecord = result?.record || null;
      savedExists = result?.available === true || result?.invalid === true;
      savedInvalid = result?.invalid === true;
      setDraft(savedRecord);
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
    if (draftRecord && (!savedRecord || (draftRecord.videoId || draftRecord.dataUrl) !== (savedRecord.videoId || savedRecord.dataUrl))) {
      const { blob, objectUrl, ...record } = draftRecord;
      return { action: "replace", record };
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

  async function saveSettings(payload) {
    if (!draftRecord?.blob || payload.headerCoverOperation?.action !== "replace") return options.request({ type: "settings:save", payload: payload });
    try {
      const { saveHeaderVideoSettings } = await import("./header-cover-local-video.mjs");
      return await saveHeaderVideoSettings(payload, draftRecord.blob);
    } catch (error) {
      if (error.messageKey) error.message = t(error.messageKey, error.messageParams);
      throw error;
    }
  }

  function commit() {
    savedRecord = draftRecord ? operation()?.record || savedRecord : null;
    setDraft(savedRecord);
    savedExists = Boolean(draftRecord);
    savedInvalid = false;
    externalReloadPending = false;
    syncControls();
  }

  function restore() {
    selectionGeneration += 1;
    if (externalReloadPending) {
      externalReloadPending = false;
      load().then((loaded) => {
        if (loaded) options.updatePreview();
        else externalReloadPending = true;
      });
      return;
    }
    setDraft(savedRecord);
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
    selectionGeneration += 1;
    setDraft(null);
    savedInvalid = false;
    syncControls();
    options.updatePreview();
    options.renderSettingsStatus(t("settings.headerImage.localRemovedDraft"));
  }

  async function handleFileSelection() {
    const file = els.headerImageLocalInput.files?.[0];
    els.headerImageLocalInput.value = "";
    if (!file || externalBusy) return;
    const generation = ++selectionGeneration;
    const video = String(file.type || "").startsWith("video/") || /\.(mp4|webm)$/i.test(file.name || "");
    options.setSettingsBusy(true);
    options.renderSettingsStatus(t(video ? "settings.headerImage.localVideoProcessing" : "settings.headerImage.localProcessing"));
    let imageTools;
    try {
      let record;
      if (video) {
        const { prepareHeaderVideoFile } = await import("./header-cover-local-video.mjs");
        record = await prepareHeaderVideoFile(file);
      } else {
        imageTools = await import("./header-cover-image.mjs");
        record = await imageTools.optimizeHeaderCoverFile(file);
      }
      if (generation !== selectionGeneration) { if (record.objectUrl) URL.revokeObjectURL(record.objectUrl); return; }
      setDraft(record);
      savedInvalid = false;
      syncControls();
      options.updatePreview();
      options.renderSettingsStatus(t(video ? "settings.headerImage.localVideoReady" : "settings.headerImage.localReady"));
    } catch (error) {
      if (generation === selectionGeneration) options.renderSettingsStatus(t(error.messageKey || imageTools?.headerCoverImageErrorKey(error) || "settings.headerImage.localErrorDecode"));
    } finally {
      options.setSettingsBusy(false);
    }
  }

  function setDraft(record) {
    if (draftRecord?.objectUrl && draftRecord.objectUrl !== record?.objectUrl) URL.revokeObjectURL(draftRecord.objectUrl);
    draftRecord = record;
    state.localHeaderCover = record;
  }

  function syncControls() {
    const record = draftRecord;
    const videoStatus = { loading: "videoLoading", error: "videoFailed" }[hero?.dataset.headerVideoState];
    els.headerImageLocalChooseLabel.removeAttribute("data-i18n");
    els.headerImageLocalStatus.removeAttribute("data-i18n");
    els.headerImageLocalChooseLabel.textContent = t(record
      ? "settings.headerImage.localReplace"
      : "settings.headerImage.localChoose");
    const statusKey = record ? "" : savedInvalid ? "localInvalid" : videoStatus;
    els.headerImageLocalStatus.textContent = statusKey ? t(`settings.headerImage.${statusKey}`) : "";
    els.headerImageLocalStatus.hidden = !statusKey;
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

  return { bind, load, operation, savePayload, saveSettings, hasChanges, commit, restore, markExternalChange, setBusy, syncControls };
}

function formatBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

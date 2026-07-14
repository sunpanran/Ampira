export function createSettingsTransferController(options) {
  const {
    els, state, t, apiGet, apiPost, localizedErrorMessage,
    runSettingsAction, renderSettingsStatus, loadSettings, captureSettingsSnapshot, resetSecretDrafts,
    applyUiLocale, getLocale, inspirationPreviews, loadDashboard, triggerRefresh,
    parseSettingsTransferText, settingsTransferFilename, maxSettingsTransferBytes,
  } = options;

  return { exportSettings, importSettingsFile };

  function exportSettings() {
    return runSettingsAction(async (isCurrent) => {
      renderSettingsStatus(t("settings.transfer.exporting"));
      try {
        const config = await apiGet("/api/settings/export");
        if (!isCurrent()) return;
        const fileName = settingsTransferFilename(config.exportedAt);
        downloadSettingsDocument(config, fileName);
        renderSettingsStatus(t("settings.transfer.exported", { fileName }));
      } catch (error) {
        if (isCurrent()) renderSettingsStatus(t("settings.transfer.exportFailed", { message: localizedErrorMessage(error) }));
      }
    });
  }

  async function importSettingsFile(event) {
    const input = event?.currentTarget || els.settingsImportFile;
    const file = input.files?.[0];
    input.value = "";
    if (!file || els.importSettings.disabled) return;
    if (file.size > maxSettingsTransferBytes) {
      renderSettingsStatus(t("settings.transfer.importFailed", { message: t("settings.transfer.error.tooLarge") }));
      return;
    }

    let transfer;
    try {
      transfer = parseSettingsTransferText(await file.text(), state.settings);
    } catch (error) {
      renderSettingsStatus(t("settings.transfer.importFailed", { message: settingsTransferErrorMessage(error) }));
      return;
    }

    const confirmKey = transfer.providerOriginChanged
      ? "settings.transfer.confirmProviderChanged"
      : "settings.transfer.confirm";
    if (!window.confirm(t(confirmKey, { fileName: file.name, count: transfer.fieldCount }))) return;

    return runSettingsAction(async (isCurrent) => {
      renderSettingsStatus(t("settings.transfer.importing"));
      try {
        const savedSettings = await apiPost("/api/settings/import", { config: transfer.config });
        if (!isCurrent()) return;
        const bookmarkSourceChanged = savedSettings.bookmarkSourceChanged === true;
        const rankingChanged = savedSettings.rankingChanged === true;
        const automaticAiStarted = savedSettings.automaticAiStarted === true;
        const sourceRefreshScheduled = savedSettings.sourceRefreshScheduled === true;
        if (bookmarkSourceChanged || savedSettings.imageSearchChanged === true) inspirationPreviews.invalidate();
        applyUiLocale(savedSettings.uiLocale || getLocale(), { persist: true });
        resetSecretDrafts();
        if (!await loadSettings() || !isCurrent()) return;
        captureSettingsSnapshot();
        renderSettingsStatus(t("settings.transfer.imported", {
          count: savedSettings.importedFieldCount || transfer.fieldCount,
        }));
        await loadDashboard();
        if ((bookmarkSourceChanged || rankingChanged) && !automaticAiStarted && !sourceRefreshScheduled) await triggerRefresh(true);
      } catch (error) {
        if (isCurrent()) renderSettingsStatus(t("settings.transfer.importFailed", { message: localizedErrorMessage(error) }));
      }
    });
  }

  function settingsTransferErrorMessage(error) {
    const keys = {
      SETTINGS_IMPORT_INVALID_JSON: "settings.transfer.error.invalidJson",
      SETTINGS_IMPORT_INVALID_FORMAT: "settings.transfer.error.invalidFormat",
      SETTINGS_IMPORT_UNSUPPORTED_VERSION: "settings.transfer.error.unsupportedVersion",
      SETTINGS_IMPORT_FILE_TOO_LARGE: "settings.transfer.error.tooLarge",
      SETTINGS_IMPORT_EMPTY: "settings.transfer.error.empty",
      SETTINGS_IMPORT_INVALID_VALUE: "settings.transfer.error.invalidValue",
    };
    return t(keys[error?.code] || "settings.transfer.error.invalidFormat", {
      field: error?.details?.field || "",
      version: error?.details?.version ?? "",
    });
  }
}

function downloadSettingsDocument(config, fileName) {
  const blob = new Blob([`${JSON.stringify(config, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

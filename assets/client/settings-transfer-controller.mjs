export function createSettingsTransferController(options) {
  const {
    els, t, request, confirmAction, localizedErrorMessage, runSettingsAction, renderSettingsStatus,
    loadSettings, loadDashboard, resetExtensionPage,
  } = options;

  let importPending = false;
  return { exportSettings, importSettingsFile, factoryReset };

  function exportSettings() {
    if (options.hasUnsavedChanges?.()) return renderSettingsStatus(t("settings.transfer.saveFirst"));
    return runSettingsAction(async (isCurrent) => {
      renderSettingsStatus(t("settings.transfer.exporting"));
      try {
        const [config, { settingsTransferFilename, serializeSettingsTransferDocument }] = await Promise.all([
          request({ type: "settings:export" }),
          import("../../extension/core/settings-transfer.mjs"),
        ]);
        if (!isCurrent()) return;
        const fileName = settingsTransferFilename(config.exportedAt);
        downloadSettingsDocument(serializeSettingsTransferDocument(config), fileName);
        renderSettingsStatus(t("settings.transfer.exported", { fileName }));
      } catch (error) {
        if (isCurrent()) renderSettingsStatus(t("settings.transfer.exportFailed", { message: error?.name === "SettingsTransferError"
          ? settingsTransferErrorMessage(error) : localizedErrorMessage(error) }));
      }
    });
  }

  async function importSettingsFile(event) {
    const input = event?.currentTarget || els.settingsImportFile;
    const file = input.files?.[0];
    input.value = "";
    if (!file || importPending || els.importSettings.disabled) return { status: "ignored" };
    importPending = true;
    let isActive = () => false;
    try {
      return await runSettingsAction(async (isCurrent) => {
        isActive = isCurrent;
        const { importSettingsDocument } = await import("./settings-import-controller.mjs");
        return importSettingsDocument(file, options, isCurrent);
      });
    } catch (error) {
      if (isActive()) renderSettingsStatus(t("settings.transfer.importFailed", { message: settingsTransferErrorMessage(error) }));
      return { status: "failed", committed: false };
    } finally {
      importPending = false;
      if (isActive() && !els.importSettings.disabled) els.importSettings.focus?.({ preventScroll: true });
    }
  }

  async function factoryReset() {
    if (els.factoryResetSettings.disabled) return;
    if (!await confirmAction({
      kicker: t("confirmation.factoryReset.kicker"),
      title: t("confirmation.factoryReset.title"),
      body: t("confirmation.factoryReset.body"),
      cancelLabel: t("confirmation.factoryReset.cancel"),
      confirmLabel: t("confirmation.factoryReset.confirm"),
      tone: "danger",
    })) return;

    return runSettingsAction(async (isCurrent) => {
      renderSettingsStatus(t("settings.transfer.resetting"));
      try {
        const result = await request({ type: "settings:factory-reset" });
        if (!isCurrent()) return;
        if (result?.ok !== true) throw new Error(t("background.error.factoryResetIncomplete", { count: 1 }));
        renderSettingsStatus(t("settings.transfer.resetComplete"));
        resetExtensionPage();
      } catch (error) {
        if (!isCurrent()) return;
        await Promise.allSettled([loadSettings(), loadDashboard()]);
        if (isCurrent()) {
          renderSettingsStatus(t("settings.transfer.resetFailed", { message: localizedErrorMessage(error) }));
        }
      }
    });
  }

  function settingsTransferErrorMessage(error) {
    return error?.messageKey ? t(error.messageKey, error.messageParams || {}) : localizedErrorMessage(error);
  }

}

function downloadSettingsDocument(text, fileName) {
  const blob = new Blob([text], { type: "application/json" });
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

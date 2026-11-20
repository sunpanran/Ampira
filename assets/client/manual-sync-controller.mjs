export function createManualSyncController({ els, settingsController, t, request, confirmAction, localizedErrorMessage, loadDashboard }) {
  let running = false;
  return { run };

  async function run(direction) {
    if (running || settingsController.isBusy()) return;
    if (settingsController.hasUnsavedChanges()) {
      settingsController.renderSettingsStatus(t("settings.sync.saveFirst"));
      return;
    }
    running = true;
    const trigger = els[{ upload: "uploadSyncData", download: "downloadSyncData", clear: "clearSyncData" }[direction]];
    try {
      await settingsController.runSettingsAction(async isCurrent => {
        settingsController.renderSettingsStatus(t("settings.sync.checking"));
        try {
          const preview = await request({ type: "sync:preview", payload: { direction } });
          if (!isCurrent()) return;
          const skipped = skippedMessage(preview.rows);
          if (!preview.hasChanges) {
            settingsController.renderSettingsStatus(t(direction === "clear" ? "settings.sync.empty" : skipped ? `settings.sync.noData.${direction}` : "settings.sync.unchanged"));
            return;
          }
          const lines = preview.rows.filter(row => !row.skipped && row.added + row.updated + row.removed > 0).map(row => (
            t("settings.sync.previewRow", { name: t(row.label), added: row.added, updated: row.updated, removed: row.removed })
          ));
          const limits = preview.rows.filter(row => row.excluded).map(row => t("settings.sync.limited", { name: t(row.label), count: row.count, excluded: row.excluded }));
          const confirmed = await confirmAction({
            kicker: t("settings.sync.title"), title: t(`settings.sync.confirm.${direction}`),
            body: [t(`settings.sync.effect.${direction}`), lines.join("\n"), ...limits, skipped].filter(Boolean).join("\n\n"),
            multiline: true, tone: "danger", cancelLabel: t("settings.sync.cancel"), confirmLabel: t(`settings.sync.${direction}`),
          });
          if (!isCurrent()) return;
          if (!confirmed) { settingsController.renderSettingsStatus("", "ready"); return; }
          settingsController.renderSettingsStatus(t(`settings.sync.running.${direction}`));
          const result = await request({ type: "sync:apply", payload: { token: preview.token } });
          if (!isCurrent()) return;
          settingsController.resetSecretDrafts();
          if (!await settingsController.loadSettings() || !isCurrent()) return;
          settingsController.captureSettingsSnapshot();
          await loadDashboard();
          if (isCurrent()) settingsController.renderSettingsStatus(t(
            `settings.sync.${skippedMessage(result.rows) ? "donePartial" : "done"}.${direction}`,
          ));
        } catch (error) {
          if (isCurrent()) settingsController.renderSettingsStatus(localizedErrorMessage(error), "error");
        }
      });
    } finally {
      running = false;
      if (trigger?.isConnected && !trigger.disabled) trigger.focus({ preventScroll: true });
    }
  }

  function skippedMessage(rows = []) {
    return rows.some(row => row.skipped) ? t("settings.sync.skipped") : "";
  }
}

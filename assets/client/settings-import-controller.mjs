import { MAX_SETTINGS_TRANSFER_BYTES, parseSettingsTransferText } from "../../extension/core/settings-transfer.mjs";

export async function importSettingsDocument(file, options, isCurrent) {
  const { state, t, request, confirmAction, localizedErrorMessage, renderSettingsStatus, loadSettings, captureSettingsSnapshot,
    resetSecretDrafts, prepareLocale, getLocale, applyUiLocale, inspirationPreviews, loadDashboard, triggerRefresh } = options;
  let imported = false;
  try {
    if (!isCurrent()) return { status: "cancelled" };
    if (file.size > MAX_SETTINGS_TRANSFER_BYTES) {
      renderSettingsStatus(t("settings.transfer.importFailed", { message: t("settings.transfer.error.tooLarge") }));
      return { status: "failed", committed: false };
    }
    const text = await file.text();
    if (!isCurrent()) return { status: "cancelled" };
    const transfer = parseSettingsTransferText(text, state.settings);
    const bodyKey = transfer.providerOriginChanged && !transfer.credentials.openaiApiKey
      ? "confirmation.import.bodyProviderChanged" : "confirmation.import.body";
    const confirmed = await confirmAction({
      kicker: t("confirmation.import.kicker"), title: t("confirmation.import.title"),
      body: [t(bodyKey, { fileName: file.name, count: transfer.fieldCount }),
        typeof transfer.syncAiSettingsEnabled === "boolean"
          ? t(transfer.syncAiSettingsEnabled ? "confirmation.import.syncEnable" : "confirmation.import.syncDisable") : "",
      ].filter(Boolean).join("\n\n"),
      multiline: true, cancelLabel: t("confirmation.import.cancel"), confirmLabel: t("confirmation.import.confirm"),
    });
    if (!isCurrent()) return { status: "cancelled" };
    if (!confirmed) { renderSettingsStatus(); return { status: "cancelled" }; }
    renderSettingsStatus(t("settings.transfer.importing"));
    const saved = await request({ type: "settings:import", payload: {
      config: transfer.config, restoreCredentialSync: typeof transfer.syncAiSettingsEnabled === "boolean",
    } });
    imported = true;
    if (!isCurrent()) return { status: "cancelled", committed: true };
    if (saved.bookmarkSourceChanged || saved.imageSearchChanged) inspirationPreviews.invalidate();
    await prepareLocale(saved.uiLocale || getLocale());
    if (!isCurrent()) return { status: "cancelled", committed: true };
    applyUiLocale(saved.uiLocale || getLocale(), { persist: true });
    resetSecretDrafts();
    if (await loadSettings()) captureSettingsSnapshot();
    if (!isCurrent()) return { status: "cancelled", committed: true };
    renderSettingsStatus(t("settings.transfer.imported", { count: saved.importedFieldCount ?? transfer.fieldCount }));
    let access = { status: "ready", settings: saved, changed: false };
    if (saved.importAuthorization) {
      const { authorizeSettingsImport } = await import("./settings-import-authorization.mjs");
      access = await authorizeSettingsImport(saved.importAuthorization, options, isCurrent);
    }
    if (!isCurrent()) return { status: "cancelled", committed: true };
    let postCommit = [saved.postCommit, access.settings?.postCommit].find(value => value?.status === "pending")
      || access.settings?.postCommit || saved.postCommit;
    if (postCommit?.status === "pending") {
      const completed = await request({ type: "settings:reconcile-import" });
      postCommit = completed.postCommit;
      access.settings = completed;
    }
    if (!isCurrent()) return { status: "cancelled", committed: true };
    const viewLoaded = !access.settings || await loadSettings({ settings: access.settings });
    if (access.settings && viewLoaded) captureSettingsSnapshot();
    if (!isCurrent()) return { status: "cancelled", committed: true };
    if (access.status === "failed") renderSettingsStatus(t("settings.transfer.authorize.failed", { message: localizedErrorMessage(access.error) }));
    else if (access.status !== "ready") renderSettingsStatus(t("settings.transfer.authorize.pending"));
    else if (postCommit?.status === "pending") renderSettingsStatus(t("settings.transfer.postCommitPending"));
    else if (!viewLoaded) renderSettingsStatus(t("settings.transfer.viewPending"));
    else if (access.changed || access.unsupported) renderSettingsStatus(t(access.unsupported
      ? "settings.transfer.authorize.unsupported" : "settings.transfer.authorize.done"));
    else renderSettingsStatus(t("settings.transfer.imported", { count: saved.importedFieldCount ?? transfer.fieldCount }));
    await loadDashboard();
    const automaticAiStarted = saved.automaticAiStarted || access.settings?.automaticAiStarted;
    const sourceRefreshScheduled = saved.sourceRefreshScheduled || access.settings?.sourceRefreshScheduled;
    if ((saved.bookmarkSourceChanged || saved.rankingChanged) && !automaticAiStarted && !sourceRefreshScheduled
      && postCommit?.status !== "pending") await triggerRefresh(true);
    return { status: access.status === "ready" && (!viewLoaded || postCommit?.status === "pending") ? "pending" : access.status,
      committed: true, postCommit };
  } catch (error) {
    if (isCurrent()) renderSettingsStatus(t(imported ? "settings.transfer.followupFailed" : "settings.transfer.importFailed", {
      message: settingsTransferErrorMessage(error),
    }));
    return { status: "failed", committed: imported };
  }

  function settingsTransferErrorMessage(error) {
    return error?.messageKey ? t(error.messageKey, error.messageParams || {}) : localizedErrorMessage(error);
  }
}

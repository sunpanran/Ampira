export const MANUAL_AI_USAGE_NOTICE_KEY = "dash.ai.manual-token-notice.v1";
export const MANUAL_AI_USAGE_ACKNOWLEDGED = "acknowledged";

export function createManualAiUsageNoticeController(options) {
  const {
    confirmAction,
    readValue,
    writeValue,
    t,
  } = options;
  let pendingPromise = null;

  return { confirmManualAiUsage };

  function confirmManualAiUsage({ aiEnabled = true } = {}) {
    if (aiEnabled !== true) return Promise.resolve(true);
    if (readValue(MANUAL_AI_USAGE_NOTICE_KEY) === MANUAL_AI_USAGE_ACKNOWLEDGED) {
      return Promise.resolve(true);
    }
    if (pendingPromise) return pendingPromise;
    pendingPromise = confirmAction({
      kicker: t("manualAiUsage.kicker"),
      title: t("manualAiUsage.title"),
      body: t("manualAiUsage.body"),
      cancelLabel: t("manualAiUsage.cancel"),
      confirmLabel: t("manualAiUsage.continue"),
    }).then((confirmed) => {
      if (confirmed) writeValue(MANUAL_AI_USAGE_NOTICE_KEY, MANUAL_AI_USAGE_ACKNOWLEDGED);
      return confirmed;
    }).finally(() => {
      pendingPromise = null;
    });
    return pendingPromise;
  }
}

import {
  READING_QUEUE_STORAGE_KEY,
  RETAINED_SEEN_STORAGE_KEY,
  addCapturedPage,
  capturedPageRecord,
  normalizeReadingQueueRecords,
  removeSeenPage,
} from "../core/reading-queue.mjs";

const SUCCESS_COLOR = "#9152FF";
const ERROR_COLOR = "#F4C95D";

export function createActionReadingQueueService(options) {
  const {
    chrome, clientStateStore, contentSyncService, getSettings, settingsLocale, translate, localDateKey, broadcast,
    now = () => new Date(),
  } = options;

  return { handleActionClicked, resetActionFeedback };

  async function handleActionClicked(tab = {}) {
    const locale = await actionLocale();
    const record = capturedPageRecord(tab, now());
    if (!record) {
      await showFeedback(tab.id, "!", ERROR_COLOR, translate(locale, "action.captureUnsupported"));
      return { status: "unsupported", records: [], reopenedKeys: [] };
    }

    try {
      if (contentSyncService?.initialize) await contentSyncService.initialize().catch(() => {});
      const result = await clientStateStore.mutate((state) => {
        const addition = addCapturedPage(state[READING_QUEUE_STORAGE_KEY], record);
        const currentSeenKey = `dash.seen.${localDateKey()}`;
        const currentSeen = removeSeenPage(state[currentSeenKey], record);
        const retainedSeen = removeSeenPage(state[RETAINED_SEEN_STORAGE_KEY], record);
        const reopenedKeys = [...new Set([...currentSeen.removedKeys, ...retainedSeen.removedKeys])];
        const serializedQueue = JSON.stringify(addition.records);
        return {
          values: {
            [READING_QUEUE_STORAGE_KEY]: serializedQueue,
            ...(currentSeen.removedKeys.length ? { [currentSeenKey]: JSON.stringify(currentSeen.records) } : {}),
            ...(retainedSeen.removedKeys.length ? { [RETAINED_SEEN_STORAGE_KEY]: JSON.stringify(retainedSeen.records) } : {}),
          },
          result: { ...addition, reopenedKeys, serializedQueue },
        };
      });
      if (contentSyncService?.handleLocalPatch) {
        await contentSyncService.handleLocalPatch({
          [READING_QUEUE_STORAGE_KEY]: result.serializedQueue,
        }).catch(() => {});
      }
      let finalRecords = result.records;
      try {
        const finalState = await clientStateStore.read();
        finalRecords = normalizeReadingQueueRecords(finalState[READING_QUEUE_STORAGE_KEY]);
      } catch {}
      const { serializedQueue, ...publicResult } = { ...result, records: finalRecords };
      broadcast("reading-queue.changed", {
        records: publicResult.records,
        reopenedKeys: publicResult.reopenedKeys,
      });
      const messageKey = publicResult.status === "already" ? "action.captureAlreadyQueued" : "action.captureAdded";
      await showFeedback(tab.id, "✓", SUCCESS_COLOR, translate(locale, messageKey));
      return publicResult;
    } catch {
      await showFeedback(tab.id, "!", ERROR_COLOR, translate(locale, "action.captureFailed"));
      return { status: "failed", records: [], reopenedKeys: [] };
    }
  }

  async function resetActionFeedback(tabId) {
    if (!Number.isInteger(tabId)) return;
    const title = chrome.i18n?.getMessage?.("actionTitle") || "Ampira";
    await Promise.allSettled([
      chrome.action.setBadgeText({ tabId, text: "" }),
      chrome.action.setTitle({ tabId, title }),
    ]);
  }

  async function actionLocale() {
    try {
      return settingsLocale(await getSettings());
    } catch {
      return settingsLocale({});
    }
  }

  async function showFeedback(tabId, text, color, title) {
    if (!Number.isInteger(tabId)) return;
    await Promise.allSettled([
      chrome.action.setBadgeBackgroundColor({ tabId, color }),
      chrome.action.setBadgeText({ tabId, text }),
      chrome.action.setTitle({ tabId, title }),
    ]);
  }
}

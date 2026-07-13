export function createBookmarkRefreshScheduler(options) {
  const {
    cacheMutations, refreshCoordinator, getSettings, pruneStalePreviewCaches,
    broadcast, startRefresh, delayMs = 800,
  } = options;
  let timer = 0;

  return { schedule };

  function schedule() {
    cacheMutations.invalidate();
    refreshCoordinator.invalidate();
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = 0;
      getSettings().then(async (settings) => {
        if (!settings.bookmarkConsentGranted) return;
        await pruneStalePreviewCaches(settings).catch(() => {});
        broadcast("dashboard.updated", { reason: "bookmarks-changed" });
        startRefresh(true).catch(() => {});
      }).catch(() => {});
    }, delayMs);
  }
}

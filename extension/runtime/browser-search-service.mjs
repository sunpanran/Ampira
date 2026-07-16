export function createBrowserSearchService({ chrome, typedError }) {
  return { enabled, search };

  async function enabled() {
    if (!chrome?.permissions?.contains) return false;
    return chrome.permissions.contains({ permissions: ["search"] });
  }

  async function search(payload = {}, sender = {}) {
    const query = String(payload.query || "").trim();
    if (!query) {
      throw typedError("BROWSER_SEARCH_REQUIRED", "background.error.browserSearchRequired", {}, false);
    }
    if (!Number.isInteger(sender?.tab?.id)) {
      throw typedError("BROWSER_SEARCH_UNAVAILABLE", "background.error.browserSearchUnavailable", {}, false);
    }
    if (!await enabled()) {
      throw typedError("BROWSER_SEARCH_PERMISSION_REQUIRED", "background.error.browserSearchPermission", {}, false);
    }
    if (!chrome?.search?.query) {
      throw typedError("BROWSER_SEARCH_UNAVAILABLE", "background.error.browserSearchUnavailable", {}, false);
    }
    try {
      await chrome.search.query({ text: query, tabId: sender.tab.id });
    } catch (error) {
      throw typedError("BROWSER_SEARCH_FAILED", "background.error.browserSearchFailed", {
        message: error?.message || String(error),
      }, true);
    }
    return { submitted: true };
  }
}

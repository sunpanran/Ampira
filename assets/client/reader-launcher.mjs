import { isReaderUrl } from "./urls.mjs";
import { readerContentKind, shouldUseInAppReader } from "./reader-policy.mjs";
import { createLazyController } from "./lazy-controller.mjs";

export function createReaderLauncher(context, loadReader = () => import("./reader-ui.mjs")) {
  const { state, els, actionKey, toggleSeen, defaultSeenSource, markOpenedItem } = context;
  const reader = createLazyController({
    load: async () => {
      const { createReaderController } = await loadReader();
      const controller = createReaderController({ ...context, openExternalWindow });
      return {
        open: (...args) => { controller.openFloatingWeb(...args); },
        close: controller.closeFloatingWeb,
        back: controller.backFloatingWeb,
        reload: controller.reloadFloatingWeb,
      };
    },
    onLoading: loading => {
      if (loading) els.webFrameOverlay.setAttribute("aria-busy", "true");
      else els.webFrameOverlay.removeAttribute("aria-busy");
    },
    onError: error => context.onError?.(error),
  });

  function openExternal(url, title = "", item = null, options = {}) {
    if (item) {
      const key = actionKey(item);
      if (key && !state.seen.has(key)) toggleSeen(item, true, defaultSeenSource(item));
    }
    if (shouldUseInAppReader({
      enabled: state.settings?.floatingWebOpenEnabled,
      readerUrl: isReaderUrl(url),
      contentKind: readerContentKind(item, options.contentKind),
    })) return reader.open(url, title, item);
    if (item) markOpenedItem(item);
    openExternalWindow(url);
  }

  function openExternalWindow(url) {
    // Keep native window creation on the original click's user gesture.
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return {
    openExternal,
    openExternalWindow,
    backFloatingWeb: () => reader.call("back"),
    closeFloatingWeb: () => reader.close(),
    reloadFloatingWeb: () => reader.call("reload"),
  };
}

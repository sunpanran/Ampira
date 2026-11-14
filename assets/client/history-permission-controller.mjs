import { containsPermissions, requestPermissions, removePermissions } from "./permission-client.mjs";

export function createHistoryPermissionController({ t }) {
  const toggle = document.querySelector("#toggleHistorySearchPermission");
  const status = document.querySelector("#historySearchPermissionStatus");
  let granted = false;
  let busy = false;
  let version = 0;

  function showFeedback(key = "") {
    status.textContent = key ? t(key) : "";
    status.hidden = !key;
  }

  async function refresh() {
    const token = ++version;
    const enabled = await containsPermissions(["history"]).catch(() => false);
    if (token !== version) return;
    granted = enabled === true;
    toggle.checked = granted;
    toggle.disabled = busy || !globalThis.chrome?.permissions?.request;
    showFeedback();
  }

  toggle.addEventListener("change", async () => {
    if (busy) return;
    busy = true;
    toggle.disabled = true;
    try {
      // Invoke the permission request directly in the checkbox's user gesture.
      const changed = await (toggle.checked ? requestPermissions(["history"]) : removePermissions(["history"]));
      await refresh();
      if (!changed) showFeedback("search.unified.permissionDeclined");
    } catch {
      await refresh();
      showFeedback("settings.browser.historyError");
    } finally {
      busy = false;
      toggle.disabled = !globalThis.chrome?.permissions?.request;
      toggle.checked = granted;
    }
  });
  const permissionChanged = details => {
    if (details?.permissions?.includes("history")) void refresh();
  };
  globalThis.chrome?.permissions?.onAdded?.addListener(permissionChanged);
  globalThis.chrome?.permissions?.onRemoved?.addListener(permissionChanged);
  document.addEventListener("ampira:locale-changed", () => void refresh());
  document.addEventListener("visibilitychange", () => { if (!document.hidden) void refresh(); });
  void refresh();
}

export function createConfirmationDialogController(options) {
  const {
    dialog,
    kicker,
    title,
    body,
    cancelButton,
    confirmButton,
    activeElement = () => globalThis.document?.activeElement || null,
    scheduleFocus = (callback) => queueMicrotask(callback),
  } = options;
  let pendingPromise = null;
  let resolvePending = null;
  let previousFocus = null;

  cancelButton.addEventListener("click", () => finish(false));
  confirmButton.addEventListener("click", () => finish(true));
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    finish(false);
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) finish(false);
  });

  return { confirmAction };

  function confirmAction(content = {}) {
    if (pendingPromise) return pendingPromise;
    kicker.textContent = String(content.kicker || "CONFIRM");
    title.textContent = String(content.title || "");
    body.textContent = String(content.body || "");
    cancelButton.textContent = String(content.cancelLabel || "Cancel");
    confirmButton.textContent = String(content.confirmLabel || "Continue");
    confirmButton.classList.toggle("danger", content.tone === "danger");
    confirmButton.classList.toggle("primary", content.tone !== "danger");

    previousFocus = activeElement();
    pendingPromise = new Promise((resolve) => {
      resolvePending = resolve;
    });
    dialog.showModal();
    scheduleFocus(() => {
      if (dialog.open) cancelButton.focus({ preventScroll: true });
    });
    return pendingPromise;
  }

  function finish(confirmed) {
    if (!pendingPromise || !resolvePending) return;
    const resolve = resolvePending;
    const focusTarget = previousFocus;
    pendingPromise = null;
    resolvePending = null;
    previousFocus = null;
    if (dialog.open) dialog.close();
    if (focusTarget?.isConnected !== false && typeof focusTarget?.focus === "function") {
      focusTarget.focus({ preventScroll: true });
    }
    resolve(confirmed);
  }
}

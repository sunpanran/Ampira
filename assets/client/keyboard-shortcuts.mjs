import { DEFAULT_KEYBOARD_SHORTCUTS, keyboardShortcutFromEvent, normalizeKeyboardShortcuts } from "../../extension/core/keyboard-shortcuts.mjs";
const EDITABLE = "input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox'], [role='combobox'], [role='searchbox'], [role='spinbutton'], [role='slider']";
const BLOCKING = "[role='dialog'], [role='alertdialog'], dialog[open], [role='menu'], [role='listbox'], #onboardingOverlay";

const KEY_LABELS = { Space: "Space", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Minus: "−", Equal: "=", BracketLeft: "[", BracketRight: "]", Backslash: "\\", Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/", Backquote: "`" };

export function formatKeyboardShortcut(binding, platform = globalThis.navigator?.userAgentData?.platform || globalThis.navigator?.platform || "") {
  if (!binding) return "";
  return binding.split("+").map(part => part === "Alt" && /mac/i.test(platform) ? "Option"
    : part === "Meta" ? (/mac/i.test(platform) ? "Command" : "Meta") : KEY_LABELS[part] || part.replace(/^(Key|Digit)/, "")).join(" + ");
}

export function setKeyboardShortcutHint(element, id, label, settings = {}, available = true) {
  if (!element) return;
  const binding = normalizeKeyboardShortcuts(settings?.keyboardShortcuts)[id];
  const active = binding && available && settings?.keyboardShortcutsEnabled !== false && !element.disabled && element.getAttribute("aria-disabled") !== "true";
  element.title = active ? `${label} (${formatKeyboardShortcut(binding)})` : label;
  if (active) element.setAttribute("aria-keyshortcuts", binding.split("+").map(part => part === "Ctrl" ? "Control" : part === "Minus" ? "-" : part.startsWith("Arrow") ? part : KEY_LABELS[part] || part.replace(/^(Key|Digit)/, "")).join("+"));
  else element.removeAttribute("aria-keyshortcuts");
}

export function keyboardShortcutAction(event, composing = false, bindings = DEFAULT_KEYBOARD_SHORTCUTS) {
  if (event.defaultPrevented || event.repeat || composing || event.isComposing || event.keyCode === 229) return "";
  if (event.composedPath?.().some(isEditable) || isEditable(event.target)) return "";
  const binding = keyboardShortcutFromEvent(event);
  return binding ? Object.entries(normalizeKeyboardShortcuts(bindings)).find(([, value]) => value === binding)?.[0] || "" : "";
}

function isEditable(target) {
  return target?.isContentEditable || Boolean(target?.closest?.(EDITABLE));
}

export function shortcutTargetVisible(element, { inViewport = false, view = globalThis.window } = {}) {
  if (!element?.isConnected || element.closest("[hidden], [inert], [aria-hidden='true']") || !element.getClientRects().length) return false;
  const style = view.getComputedStyle(element);
  if (style.visibility !== "visible" || style.display === "none") return false;
  if (!inViewport) return true;
  const rect = element.getBoundingClientRect();
  return rect.bottom > 0 && rect.right > 0 && rect.top < view.innerHeight && rect.left < view.innerWidth;
}

export function selectShortcutBatchTarget(targets, focused, pointed) {
  // An unavailable focused module still owns the command: never fall through to
  // an unrelated module beneath the mouse simply because its button is enabled.
  return targets.find(({ root }) => root?.contains(focused))
    || targets.find(({ root }) => root?.contains(pointed)) || null;
}

export function createKeyboardShortcutsController({
  isEnabled, isBlocked, getUtilityCard, openTodoComposer, navigateToSection, getBatchTargets,
  getBindings = () => DEFAULT_KEYBOARD_SHORTCUTS,
  doc = globalThis.document, view = globalThis.window,
}) {
  let bound = false;
  let composing = false;
  let pointer = null;
  const visible = (element, inViewport = false) => shortcutTargetVisible(element, { inViewport, view });

  function handleKeydown(event) {
    const action = keyboardShortcutAction(event, composing, getBindings());
    if (!action || !isEnabled() || doc.hidden || !doc.hasFocus() || isBlocked()) return;
    if ([...doc.querySelectorAll(BLOCKING)].some((element) => visible(element))) return;
    if (action === "todo") {
      if (!visible(getUtilityCard())) return;
      event.preventDefault();
      openTodoComposer();
      return;
    }
    if (action !== "batch") {
      if (navigateToSection(action, { focus: true })) event.preventDefault();
      return;
    }
    const targets = getBatchTargets().filter(({ root }) => visible(root, true));
    const pointed = pointer ? doc.elementFromPoint(pointer.x, pointer.y) : null;
    const target = selectShortcutBatchTarget(targets, doc.activeElement, pointed);
    if (!target || !visible(target.button) || target.button.disabled || target.button.getAttribute("aria-disabled") === "true") return;
    event.preventDefault();
    target.button.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "auto" });
    target.button.focus({ preventScroll: true });
    target.run();
  }

  const rememberPointer = (event) => {
    if (event.pointerType !== "touch") pointer = { x: event.clientX, y: event.clientY };
  };
  const clearPointer = () => { pointer = null; };
  const startComposition = () => { composing = true; };
  const endComposition = () => { composing = false; };
  const reset = () => { pointer = null; composing = false; };
  const visibilityChanged = () => { if (doc.hidden) reset(); };

  function bind() {
    if (bound) return;
    bound = true;
    doc.addEventListener("keydown", handleKeydown);
    doc.addEventListener("compositionstart", startComposition);
    doc.addEventListener("compositionend", endComposition);
    doc.addEventListener("pointermove", rememberPointer, { passive: true });
    doc.documentElement.addEventListener("pointerleave", clearPointer);
    doc.addEventListener("visibilitychange", visibilityChanged);
    view.addEventListener("blur", reset);
  }

  function destroy() {
    if (!bound) return;
    bound = false;
    doc.removeEventListener("keydown", handleKeydown);
    doc.removeEventListener("compositionstart", startComposition);
    doc.removeEventListener("compositionend", endComposition);
    doc.removeEventListener("pointermove", rememberPointer);
    doc.documentElement.removeEventListener("pointerleave", clearPointer);
    doc.removeEventListener("visibilitychange", visibilityChanged);
    view.removeEventListener("blur", reset);
    reset();
  }

  return { bind, destroy };
}

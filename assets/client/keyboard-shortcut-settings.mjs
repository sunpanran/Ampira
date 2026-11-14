import {
  DEFAULT_KEYBOARD_SHORTCUTS, KEYBOARD_SHORTCUT_IDS, keyboardShortcutFromEvent,
  keyboardShortcutProblem, normalizeKeyboardShortcuts,
} from "../../extension/core/keyboard-shortcuts.mjs";
import { formatKeyboardShortcut } from "./keyboard-shortcuts.mjs";

const LABELS = { todo: "todo.addLabel", daily: "nav.today", news: "nav.news", library: "nav.bookmarks", batch: "action.reshuffle" };

export function createKeyboardShortcutSettings({ root, resetButton, feedback, enabledInput, t, onChange }) {
  let bindings = normalizeKeyboardShortcuts();
  let recording = "";
  let busy = false;
  const rows = new Map();
  for (const id of KEYBOARD_SHORTCUT_IDS) {
    const row = document.createElement("div");
    const label = document.createElement("dt");
    const controls = document.createElement("dd");
    const record = document.createElement("button");
    record.type = "button";
    record.className = "btn ghost keyboard-shortcut-record";
    record.dataset.shortcutRecord = id;
    record.setAttribute("aria-describedby", feedback.id);
    record.addEventListener("click", () => { recording = id; clearFeedback(); render(); });
    record.addEventListener("blur", () => { if (recording === id) { recording = ""; render(); } });
    record.addEventListener("keydown", event => capture(event, id));
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "btn ghost keyboard-shortcut-clear";
    clear.dataset.shortcutClear = id;
    clear.addEventListener("click", () => {
      bindings[id] = null; recording = ""; clearFeedback(); render(); record.focus(); onChange();
    });
    controls.append(record, clear); row.append(label, controls); root.append(row);
    rows.set(id, { label, record, clear });
  }
  resetButton.addEventListener("click", () => {
    bindings = { ...DEFAULT_KEYBOARD_SHORTCUTS }; recording = ""; clearFeedback(); render(); onChange();
  });
  enabledInput.addEventListener("change", onChange);
  document.addEventListener("ampira:locale-changed", render);
  render();

  function clearFeedback() { feedback.textContent = ""; feedback.hidden = true; }
  function problem(key, params) { feedback.textContent = t(key, params); feedback.hidden = false; }

  function capture(event, id) {
    if (recording !== id || busy) return;
    event.stopPropagation();
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === "Tab") { recording = ""; clearFeedback(); render(); return; }
    event.preventDefault();
    if (event.repeat) return;
    if (event.key === "Escape") { recording = ""; clearFeedback(); render(); return; }
    if (["Alt", "AltGraph", "Control", "Meta", "Shift"].includes(event.key)) return;
    const binding = keyboardShortcutFromEvent(event);
    const reason = keyboardShortcutProblem(binding);
    if (reason) { problem(reason === "reserved" ? "settings.keyboard.reserved" : "settings.keyboard.invalid"); return; }
    const other = KEYBOARD_SHORTCUT_IDS.find(action => action !== id && bindings[action] === binding);
    if (other) { problem("settings.keyboard.conflict", { action: t(LABELS[other]) }); return; }
    bindings[id] = binding; recording = ""; clearFeedback(); render(); onChange();
  }

  function render() {
    for (const [id, { label, record, clear }] of rows) {
      const action = t(LABELS[id]);
      label.textContent = action;
      const value = formatKeyboardShortcut(bindings[id]) || t("settings.keyboard.unassigned");
      record.textContent = recording === id ? t("settings.keyboard.recording") : value;
      record.setAttribute("aria-label", t(recording === id ? "settings.keyboard.recordAction" : "settings.keyboard.edit", { action, key: value }));
      record.setAttribute("aria-pressed", String(recording === id));
      record.disabled = busy;
      clear.textContent = t("settings.keyboard.clear");
      clear.setAttribute("aria-label", t("settings.keyboard.clearAction", { action }));
      clear.disabled = busy || !bindings[id];
    }
    resetButton.disabled = busy;
  }

  return {
    load(settings) { enabledInput.checked = settings?.keyboardShortcutsEnabled === true; bindings = normalizeKeyboardShortcuts(settings?.keyboardShortcuts); recording = ""; clearFeedback(); render(); },
    payload: () => ({ keyboardShortcutsEnabled: enabledInput.checked, keyboardShortcuts: { ...bindings } }),
    setBusy(value) { busy = value; enabledInput.disabled = busy; if (busy) recording = ""; render(); },
  };
}

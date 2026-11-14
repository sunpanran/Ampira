import assert from "node:assert/strict";
import {
  createKeyboardShortcutsController, keyboardShortcutAction, formatKeyboardShortcut,
  setKeyboardShortcutHint, shortcutTargetVisible,
} from "../../assets/client/keyboard-shortcuts.mjs";
import { normalizeSettings } from "../../extension/core/settings.mjs";
import { createSettingsTransferDocument, parseSettingsTransferDocument } from "../../extension/core/settings-transfer.mjs";
import { decodeSettingsFromSync, encodeSettingsForSync } from "../../extension/core/settings-storage.mjs";
import { diffSettingsDraft, snapshotSettingsDraft } from "../../assets/client/settings-draft.mjs";
import { DEFAULT_KEYBOARD_SHORTCUTS, canonicalKeyboardShortcut, keyboardShortcutProblem, normalizeKeyboardShortcuts, validKeyboardShortcutMap } from "../../extension/core/keyboard-shortcuts.mjs";
import { createKeyboardShortcutSettings } from "../../assets/client/keyboard-shortcut-settings.mjs";

assert.equal(formatKeyboardShortcut(DEFAULT_KEYBOARD_SHORTCUTS.todo, "Win32"), "Alt + N");
assert.equal(formatKeyboardShortcut(DEFAULT_KEYBOARD_SHORTCUTS.todo, "MacIntel"), "Option + N");
assert.equal(formatKeyboardShortcut("Meta+Shift+KeyK", "MacIntel"), "Command + Shift + K");
assert.equal(keyboardShortcutAction(key("KeyN", { key: "Dead" })), "todo", "Option-generated characters must not change the binding");
for (const [code, action] of [["KeyN", "todo"], ["Digit1", "daily"], ["Digit2", "news"], ["Digit3", "library"], ["KeyR", "batch"]]) {
  assert.equal(keyboardShortcutAction(key(code)), action);
  for (const blocked of [{ altKey: false }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true },
    { repeat: true }, { isComposing: true }, { keyCode: 229 }, { defaultPrevented: true }, { getModifierState: () => true }]) {
    assert.equal(keyboardShortcutAction(key(code, blocked)), "", JSON.stringify(blocked));
  }
}
assert.equal(keyboardShortcutAction(key("KeyN"), true), "");
assert.equal(keyboardShortcutAction(key("KeyF")), "", "browser shortcuts are not registered");
assert.equal(keyboardShortcutAction(key("KeyN", { target: { isContentEditable: true } })), "");
assert.equal(keyboardShortcutAction(key("KeyN", { target: { closest: () => ({}) } })), "");
assert.equal(keyboardShortcutAction(key("KeyN", { composedPath: () => [{ isContentEditable: true }] })), "", "shadow editors retain their keys");

const doc = events(), view = events(), calls = [];
Object.assign(view, { innerHeight: 800, innerWidth: 1280, getComputedStyle: node => ({ visibility: node.visibility || "visible", display: "block" }) });
Object.assign(doc, {
  hidden: false, focused: true, blockers: [], activeElement: null, pointed: null,
  hasFocus: () => doc.focused,
  documentElement: events(),
  querySelectorAll: selector => selector.startsWith("[data-") ? [] : doc.blockers,
  elementFromPoint: () => doc.pointed,
});
const utility = element(), first = element(), second = element(), last = element();
const button = (root) => Object.assign(element(), { module: root, focus() { doc.activeElement = this; } });
const firstButton = button(first), secondButton = button(second), lastButton = button(last);
const targets = [first, second, last].map((root, index) => ({ root, button: [firstButton, secondButton, lastButton][index], run: () => calls.push(`batch-${index}`) }));
let enabled = normalizeSettings({}).keyboardShortcutsEnabled, blocked = false;
const controller = createKeyboardShortcutsController({
  doc, view, isEnabled: () => enabled, isBlocked: () => blocked,
  getUtilityCard: () => utility,
  openTodoComposer: () => calls.push("todo"),
  navigateToSection: id => { calls.push(id); return true; },
  getBatchTargets: () => targets,
});
controller.bind(); controller.bind();
for (const code of ["KeyN", "Digit1", "Digit2", "Digit3", "KeyR"]) {
  const event = key(code); doc.emit("keydown", event);
  assert(!event.defaultPrevented, "default settings leave shortcut keys untouched");
}
assert.equal(calls.length, 0, "page shortcuts stay inactive until enabled");
enabled = true;
for (const code of ["KeyN", "Digit1", "Digit2", "Digit3"]) {
  const event = key(code); doc.emit("keydown", event); assert(event.defaultPrevented);
}
assert.deepEqual(calls.splice(0), ["todo", "daily", "news", "library"], "bind must be idempotent");
const noTarget = key("KeyR"); doc.emit("keydown", noTarget);
assert(!noTarget.defaultPrevented);
doc.emit("pointermove", { clientX: 100, clientY: 100, pointerType: "mouse" });
doc.pointed = { module: second };
doc.activeElement = { module: first };
doc.emit("keydown", key("KeyR"));
assert.deepEqual(calls.splice(0), ["batch-0"]);
assert.equal(doc.activeElement, firstButton, "focus the surviving action before replacing cards");
firstButton.disabled = true;
doc.emit("keydown", key("KeyR"));
assert.equal(calls.length, 0, "disabled focus must not fall through to the hovered module");
firstButton.disabled = false;
doc.activeElement = null;
doc.emit("keydown", key("KeyR"));
assert.deepEqual(calls.splice(0), ["batch-1"]);
doc.activeElement = null; doc.pointed = { module: last };
doc.emit("keydown", key("KeyR"));
assert.deepEqual(calls.splice(0), ["batch-2"], "hit-test current layout, not a stale hovered element");
last.rect = { top: 900, bottom: 1000, left: 0, right: 100 };
doc.emit("keydown", key("KeyR"));
assert.equal(calls.length, 0, "offscreen modules are not batch targets");
last.rect = null; doc.activeElement = null;
view.emit("blur");
doc.emit("keydown", key("KeyR"));
assert.equal(calls.length, 0, "window blur clears pointer ownership");

for (const toggle of [
  value => { enabled = !value; }, value => { blocked = value; },
  value => { doc.hidden = value; }, value => { doc.focused = !value; },
  value => { utility.hiddenAncestor = value; },
  value => { doc.blockers = value ? [element()] : []; },
]) {
  toggle(true); const event = key("KeyN"); doc.emit("keydown", event);
  assert.equal(calls.length, 0); assert(!event.defaultPrevented);
  toggle(false);
}
doc.emit("compositionstart"); doc.emit("keydown", key("KeyN"));
assert.equal(calls.length, 0);
doc.emit("compositionend"); doc.emit("keydown", key("KeyN"));
assert.deepEqual(calls.splice(0), ["todo"]);
const hiddenDialog = element(); hiddenDialog.hiddenAncestor = true;
doc.blockers = [hiddenDialog]; doc.emit("keydown", key("KeyN"));
assert.deepEqual(calls.splice(0), ["todo"], "closed dialogs must not block page commands");
controller.destroy(); doc.emit("keydown", key("KeyN")); assert.equal(calls.length, 0);

const hint = element();
setKeyboardShortcutHint(hint, "todo", "Add");
assert.equal(hint.title, "Add"); assert.equal(hint.getAttribute("aria-keyshortcuts"), null);
setKeyboardShortcutHint(hint, "todo", "Add", { keyboardShortcutsEnabled: true });
assert.equal(hint.title, "Add (Alt + N)");
assert.equal(hint.getAttribute("aria-keyshortcuts"), "Alt+N");
setKeyboardShortcutHint(hint, "todo", "Add", { keyboardShortcutsEnabled: false });
assert.equal(hint.title, "Add"); assert.equal(hint.getAttribute("aria-keyshortcuts"), null);
hint.visibility = "hidden";
assert.equal(shortcutTargetVisible(hint, { view }), false);

assert.equal(normalizeSettings().keyboardShortcutsEnabled, false, "new settings disable shortcuts by default");
assert.equal(normalizeSettings({ uiLocale: "zh-CN" }).keyboardShortcutsEnabled, false, "legacy settings without a preference leave shortcuts disabled");
for (const value of [true, false]) {
  const settings = normalizeSettings({ keyboardShortcutsEnabled: value });
  assert.equal(settings.keyboardShortcutsEnabled, value, "saved preferences remain unchanged");
  const encoded = encodeSettingsForSync(settings);
  const decoded = decodeSettingsFromSync(encoded);
  assert.equal(decoded.keyboardShortcutsEnabled, value, "browser sync preserves the preference");
  const exported = createSettingsTransferDocument(settings);
  assert.equal(exported.settings.keyboardShortcutsEnabled, value);
  assert.equal(parseSettingsTransferDocument(exported, {}).patch.keyboardShortcutsEnabled, value);
}
const baseline = snapshotSettingsDraft(normalizeSettings({}));
const draft = { ...baseline, keyboardShortcutsEnabled: true };
assert.deepEqual(diffSettingsDraft(draft, baseline), { keyboardShortcutsEnabled: true });
assert.equal(baseline.keyboardShortcutsEnabled, false, "canceling an unsaved draft leaves shortcuts disabled");
assert.deepEqual(diffSettingsDraft({ ...baseline, keyboardShortcuts: { ...baseline.keyboardShortcuts } }, baseline), {}, "an unchanged binding map is not an unsaved edit");
const legacyExport = createSettingsTransferDocument({});
delete legacyExport.settings.keyboardShortcutsEnabled;
assert(!Object.hasOwn(parseSettingsTransferDocument(legacyExport, draft).patch, "keyboardShortcutsEnabled"), "legacy imports do not overwrite the preference");

assert.equal(canonicalKeyboardShortcut("Shift+Alt+KeyZ"), "Alt+Shift+KeyZ");
for (const value of ["KeyN", "Shift+KeyN", "Ctrl+Alt+KeyN", "Alt+Escape", "Alt+Tab", "Alt+Alt+KeyN", "Alt+Bogus", 12]) assert.equal(keyboardShortcutProblem(value), "invalid");
for (const value of ["Ctrl+KeyK", "Ctrl+KeyT", "Ctrl+KeyW", "Ctrl+Shift+KeyS", "Alt+KeyD", "Alt+F4", "Meta+Space", "Meta+KeyF", "Alt+Meta+KeyI"]) assert.equal(keyboardShortcutProblem(value), "reserved", value);
const custom = { ...DEFAULT_KEYBOARD_SHORTCUTS, todo: "Alt+Shift+KeyZ", news: null };
assert.equal(keyboardShortcutAction(key("KeyN"), false, custom), "");
assert.equal(keyboardShortcutAction(key("KeyZ", { shiftKey: true }), false, custom), "todo");
assert.equal(keyboardShortcutAction(key("Digit2"), false, custom), "");
assert.equal(keyboardShortcutAction(key("KeyN", { altKey: false }), false, custom), "", "plain typing remains outside the shortcut system");
assert.equal(validKeyboardShortcutMap(custom), true);
assert.equal(validKeyboardShortcutMap({ todo: "Alt+Digit1" }), false, "partial imports cannot silently steal a default binding");
assert.equal(validKeyboardShortcutMap({ ...custom, search: "Alt+KeyS" }), false, "search is not a shortcut action");
assert.equal(validKeyboardShortcutMap({ ...custom, daily: "Ctrl+KeyW" }), false);
assert.equal(normalizeKeyboardShortcuts({ todo: "Ctrl+KeyW" }).todo, DEFAULT_KEYBOARD_SHORTCUTS.todo);
assert.equal(normalizeKeyboardShortcuts({ todo: "Alt+Digit1" }).daily, null, "malformed duplicate persisted bindings have one deterministic owner");
setKeyboardShortcutHint(hint, "todo", "Add", { keyboardShortcuts: custom });
assert.equal(hint.getAttribute("aria-keyshortcuts"), null, "custom bindings alone do not enable shortcuts");
setKeyboardShortcutHint(hint, "todo", "Add", { keyboardShortcutsEnabled: true, keyboardShortcuts: custom });
assert.equal(hint.getAttribute("aria-keyshortcuts"), "Alt+Shift+Z");
setKeyboardShortcutHint(hint, "news", "News", { keyboardShortcutsEnabled: true, keyboardShortcuts: custom });
assert.equal(hint.getAttribute("aria-keyshortcuts"), null);
const customSettings = normalizeSettings({ keyboardShortcutsEnabled: true, keyboardShortcuts: custom });
assert.deepEqual(decodeSettingsFromSync(encodeSettingsForSync(customSettings)).keyboardShortcuts, custom);
const customExport = createSettingsTransferDocument(customSettings);
assert.deepEqual(parseSettingsTransferDocument(customExport, {}).patch.keyboardShortcuts, custom);
customExport.settings.keyboardShortcuts.todo = "Ctrl+KeyW";
assert.throws(() => parseSettingsTransferDocument(customExport, {}), /SETTINGS_IMPORT_INVALID_VALUE/);

const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
try {
  const editorDoc = events(); editorDoc.createElement = element;
  Object.defineProperty(globalThis, "document", { configurable: true, value: editorDoc });
  const root = element(), resetButton = element(), feedback = element(), enabledInput = element();
  feedback.id = "shortcut-feedback";
  let changed = 0;
  const editor = createKeyboardShortcutSettings({ root, resetButton, feedback, enabledInput,
    t: (key, params) => `${key}${params ? JSON.stringify(params) : ""}`, onChange: () => { changed += 1; } });
  for (const settings of [undefined, {}, normalizeSettings(), { keyboardShortcutsEnabled: false }]) {
    editor.load(settings);
    assert.equal(enabledInput.checked, false, "the shortcut switch loads unchecked unless explicitly enabled");
    assert.equal(editor.payload().keyboardShortcutsEnabled, false);
  }
  editor.load(customSettings);
  assert.equal(enabledInput.checked, true, "the shortcut switch preserves an enabled preference");
  const todoRecord = root.children[0].children[1].children[0];
  const todoClear = root.children[0].children[1].children[1];
  todoRecord.emit("click");
  const escape = key("Escape", { key: "Escape", altKey: false }); todoRecord.emit("keydown", escape);
  assert(escape.defaultPrevented && escape.stopped, "recording Escape cancels capture without closing settings");
  assert.equal(changed, 0);
  todoRecord.emit("click");
  const tab = key("Tab", { key: "Tab", altKey: false }); todoRecord.emit("keydown", tab);
  assert(!tab.defaultPrevented, "Tab leaves capture using normal focus navigation");
  todoRecord.emit("click");
  todoRecord.emit("keydown", key("KeyN", { key: "n", altKey: false }));
  assert(feedback.textContent.includes("settings.keyboard.invalid"));
  todoRecord.emit("keydown", key("Digit1", { key: "1" }));
  assert(feedback.textContent.includes("settings.keyboard.conflict"));
  todoRecord.emit("keydown", key("KeyT", { key: "t", altKey: false, ctrlKey: true }));
  assert(feedback.textContent.includes("settings.keyboard.reserved"));
  todoRecord.emit("keydown", key("KeyX", { key: "X", shiftKey: true }));
  assert.equal(editor.payload().keyboardShortcuts.todo, "Alt+Shift+KeyX");
  assert.equal(changed, 1);
  todoClear.emit("click");
  assert.equal(editor.payload().keyboardShortcuts.todo, null);
  editor.load(customSettings);
  assert.equal(editor.payload().keyboardShortcuts.todo, custom.todo, "loading the saved snapshot discards draft edits");
  enabledInput.checked = false;
  resetButton.emit("click");
  assert.deepEqual(editor.payload().keyboardShortcuts, DEFAULT_KEYBOARD_SHORTCUTS);
  assert.equal(editor.payload().keyboardShortcutsEnabled, false, "restoring bindings does not change the master switch");
  editor.setBusy(true); assert(todoRecord.disabled && resetButton.disabled && enabledInput.disabled);
} finally {
  if (documentDescriptor) Object.defineProperty(globalThis, "document", documentDescriptor); else delete globalThis.document;
}

console.log("keyboard shortcut behavior and settings tests passed");

function key(code, options = {}) {
  return { code, altKey: true, ctrlKey: false, shiftKey: false, metaKey: false, target: null,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...options };
}
function events() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(listener); },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    emit(type, value = {}) { for (const listener of listeners.get(type) || []) listener(value); },
  };
}
function element() {
  const attributes = new Map();
  return {
    ...events(), children: [], dataset: {},
    append(...nodes) { this.children.push(...nodes); },
    focus() {},
    isConnected: true, disabled: false,
    closest() { return this.hiddenAncestor ? {} : null; },
    contains(node) { return node === this || node?.module === this; },
    getClientRects() { return [{}]; },
    getBoundingClientRect() { return this.rect || { top: 10, left: 0, right: 200, bottom: 200 }; },
    getAttribute(name) { return attributes.get(name) ?? null; },
    setAttribute(name, value) { attributes.set(name, value); },
    removeAttribute(name) { attributes.delete(name); },
    scrollIntoView() {},
  };
}

export const DEFAULT_KEYBOARD_SHORTCUTS = Object.freeze({
  todo: "Alt+KeyN", daily: "Alt+Digit1", news: "Alt+Digit2", library: "Alt+Digit3", batch: "Alt+KeyR",
});
export const KEYBOARD_SHORTCUT_IDS = Object.freeze(Object.keys(DEFAULT_KEYBOARD_SHORTCUTS));
const MODIFIERS = ["Ctrl", "Alt", "Meta", "Shift"];
const KEY_CODE = /^(?:Key[A-Z]|Digit[0-9]|F(?:[1-9]|1[0-2])|Arrow(?:Up|Down|Left|Right)|Home|End|PageUp|PageDown|Space|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|Backquote)$/;
// Keep common browser, system and editing commands out of page-level bindings.
const RESERVED = new Set([
  ..."ACDEFGHJKLMNOPQRSTUV WXYZ".replaceAll(" ", "").split("").map(key => `Ctrl+Key${key}`),
  ..."BDEGIJKLMN OPRSTUVWY".replaceAll(" ", "").split("").map(key => `Ctrl+Shift+Key${key}`),
  ..."ACDEFGHLMNOPQRSTVWXYZ".split("").map(key => `Meta+Key${key}`),
  ..."BCDEGHJMNOPRTUVWYZ".split("").map(key => `Meta+Shift+Key${key}`),
  ...["Ctrl", "Meta"].flatMap(modifier => Array.from({ length: 10 }, (_, index) => `${modifier}+Digit${index}`)),
  ...["Ctrl", "Meta", "Ctrl+Shift", "Meta+Shift"].flatMap(modifier => ["Equal", "Minus", "NumpadAdd", "NumpadSubtract"].map(key => `${modifier}+${key}`)),
  ...["Digit3", "Digit4", "Digit5"].map(key => `Meta+Shift+${key}`),
  ...["KeyD", "KeyE", "KeyF", "Home", "ArrowLeft", "ArrowRight", "Space", "F4"].map(key => `Alt+${key}`),
  ...["KeyA", "KeyB", "KeyI", "KeyN", "KeyS", "KeyT"].map(key => `Alt+Shift+${key}`),
  ...["KeyB", "KeyF", "KeyI", "KeyJ", "KeyL", "KeyM", "KeyN", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].map(key => `Alt+Meta+${key}`),
  "Alt+Meta+Shift+KeyI", "Alt+Meta+Shift+KeyA", "Ctrl+Meta+KeyF", "Meta+Space", "Ctrl+Space", "Ctrl+Shift+Space",
  "Ctrl+Shift+KeyQ", "Meta+Shift+KeyQ", "Alt+Meta+KeyQ", "Alt+Meta+Shift+KeyQ", "Ctrl+Meta+KeyQ",
  "Meta+BracketLeft", "Meta+BracketRight", "Meta+ArrowLeft", "Meta+ArrowRight", "Ctrl+F4", "Ctrl+F5", "Ctrl+F6",
  "Ctrl+Shift+F6", "Ctrl+PageUp", "Ctrl+PageDown", "Ctrl+Shift+PageUp", "Ctrl+Shift+PageDown",
]);

export function canonicalKeyboardShortcut(value) {
  if (typeof value !== "string" || value.length > 64) return "";
  const parts = value.split("+"), code = parts.pop();
  if (!KEY_CODE.test(code || "") || !parts.length || new Set(parts).size !== parts.length || parts.some(part => !MODIFIERS.includes(part))) return "";
  if (!parts.some(part => part !== "Shift") || parts.includes("Ctrl") && parts.includes("Alt")) return "";
  return [...MODIFIERS.filter(modifier => parts.includes(modifier)), code].join("+");
}

export function keyboardShortcutProblem(value) {
  const binding = canonicalKeyboardShortcut(value);
  if (!binding) return "invalid";
  return RESERVED.has(binding) ? "reserved" : "";
}

export function keyboardShortcutFromEvent(event) {
  if (event.getModifierState?.("AltGraph")) return "";
  const modifiers = MODIFIERS.filter(modifier => event[{ Ctrl: "ctrlKey", Alt: "altKey", Meta: "metaKey", Shift: "shiftKey" }[modifier]]);
  return canonicalKeyboardShortcut([...modifiers, event.code].join("+"));
}

export function normalizeKeyboardShortcuts(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const used = new Set();
  return Object.fromEntries(KEYBOARD_SHORTCUT_IDS.map(id => {
    let binding = source[id] === null ? null : keyboardShortcutProblem(source[id]) ? DEFAULT_KEYBOARD_SHORTCUTS[id] : canonicalKeyboardShortcut(source[id]);
    if (binding && used.has(binding)) binding = null;
    if (binding) used.add(binding);
    return [id, binding];
  }));
}

export function validKeyboardShortcutMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(id => !KEYBOARD_SHORTCUT_IDS.includes(id))) return false;
  const bindings = [];
  for (const binding of Object.values({ ...DEFAULT_KEYBOARD_SHORTCUTS, ...value })) {
    if (binding === null) continue;
    if (keyboardShortcutProblem(binding)) return false;
    bindings.push(canonicalKeyboardShortcut(binding));
  }
  if (new Set(bindings).size !== bindings.length) return false;
  const normalized = normalizeKeyboardShortcuts(value);
  return Object.entries(value).every(([id, binding]) => normalized[id] === (binding === null ? null : canonicalKeyboardShortcut(binding)));
}

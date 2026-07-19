export const RUNTIME_LOCALE_PREFIXES = Object.freeze([
  "action.capture",
  "background.",
  "bookmarkFolder.default",
  "category.inspiration.",
  "inspirationPreset.",
  "reader.",
  "settings.transfer.error.",
]);

export const RUNTIME_LOCALE_KEYS = Object.freeze([
  "summary.status.noContent",
]);

export function isRuntimeLocaleKey(key) {
  return RUNTIME_LOCALE_KEYS.includes(key)
    || RUNTIME_LOCALE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

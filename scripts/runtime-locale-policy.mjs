export const RUNTIME_LOCALE_PREFIXES = Object.freeze([
  "action.capture",
  "background.",
  "bookmarkFolder.default",
  "category.inspiration.",
  "inspirationPreset.",
  "settings.transfer.error.",
]);

export const RUNTIME_LOCALE_KEYS = Object.freeze([
  "summary.status.noContent",
  "reader.translationEmpty",
  "reader.error.notFoundBody",
  "reader.error.deniedBody",
  "reader.error.timeoutBody",
  "reader.error.tooLargeBody",
  "reader.error.unsupportedBody",
  "reader.error.emptyBody",
  "reader.error.networkBody",
  "reader.error.httpBody",
  "reader.error.genericBody",
]);

export function isRuntimeLocaleKey(key) {
  return RUNTIME_LOCALE_KEYS.includes(key)
    || RUNTIME_LOCALE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

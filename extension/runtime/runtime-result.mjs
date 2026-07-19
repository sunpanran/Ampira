import { DEFAULT_LOCALE, normalizeLocale, translate } from "../core/runtime-i18n.mjs";

export function settingsLocale(settings = {}) {
  if (settings.uiLocale) return normalizeLocale(settings.uiLocale);
  return normalizeLocale(globalThis.chrome?.i18n?.getUILanguage?.() || DEFAULT_LOCALE);
}

export function resultMessage(settings, ok, messageKey, messageParams = {}, extra = {}) {
  return { ok, message: translate(settingsLocale(settings), messageKey, messageParams), messageKey, messageParams, ...extra };
}

export function errorResult(settings, error) {
  const messageKey = error?.messageKey || "";
  const messageParams = error?.messageParams || {};
  return {
    ok: false,
    message: messageKey ? translate(settingsLocale(settings), messageKey, messageParams) : (error?.message || String(error)),
    messageKey,
    messageParams,
  };
}

export function publicErrorDetails(value) {
  if (!value || typeof value !== "object") return {};
  const details = {};
  if (Number.isFinite(Number(value.status))) details.status = Number(value.status);
  if (typeof value.origin === "string") details.origin = value.origin.slice(0, 500);
  if (typeof value.url === "string") details.url = value.url.slice(0, 2000);
  if (Array.isArray(value.failedSteps)) {
    details.failedSteps = [...new Set(value.failedSteps
      .map((step) => String(step || "").trim())
      .filter((step) => /^[a-z][a-z0-9-]{0,63}$/.test(step)))]
      .slice(0, 20);
  }
  return details;
}

export function typedError(code, messageKey, messageParams = {}, retryable = false, details = {}) {
  const error = new Error(translate(DEFAULT_LOCALE, messageKey, messageParams));
  error.code = code;
  error.messageKey = messageKey;
  error.messageParams = messageParams;
  error.retryable = retryable;
  error.details = details;
  return error;
}

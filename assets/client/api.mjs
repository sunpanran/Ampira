import { t } from "./i18n.mjs";
import { hasExtensionRuntime, sendRuntimeRequest, subscribeRuntimeMessages } from "./runtime-client.mjs";

export async function sendExtensionRequest(request) {
  if (!hasExtensionRuntime()) throw new Error(t("api.notExtensionPage"));
  const response = await sendRuntimeRequest(request);
  if (!response?.ok) {
    const messageKey = response?.error?.messageKey || "";
    const messageParams = response?.error?.messageParams || {};
    const error = new Error(messageKey ? t(messageKey, messageParams) : (response?.error?.message || t("api.noResponse")));
    error.code = response?.error?.code || "EXTENSION_ERROR";
    error.retryable = response?.error?.retryable === true;
    error.messageKey = messageKey;
    error.messageParams = messageParams;
    error.details = response?.error?.details && typeof response.error.details === "object" ? response.error.details : {};
    throw error;
  }
  return response.data;
}

subscribeRuntimeMessages((message) => {
  if (!message?.type || !/^(content-sync|dashboard|personal-cards|reading-queue|refresh|search|settings)\./.test(message.type)) return;
  window.dispatchEvent(new CustomEvent("ampira:runtime-message", { detail: message }));
});

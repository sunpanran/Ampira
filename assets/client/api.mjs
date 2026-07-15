import { t } from "./i18n.mjs";
import { messageRequestForHttp } from "./message-contract.mjs";
import { hasExtensionRuntime, sendRuntimeRequest, subscribeRuntimeMessages } from "./runtime-client.mjs";

export async function apiGet(url) {
  if (!hasExtensionRuntime()) return readJsonResponse(await fetch(url, { cache: "no-store" }));
  return sendExtensionRequest(routeFor("GET", url));
}

export async function apiPost(url, body) {
  if (!hasExtensionRuntime()) {
    const options = { method: "POST", cache: "no-store" };
    if (body !== undefined) {
      options.headers = { "content-type": "application/json" };
      options.body = JSON.stringify(body);
    }
    return readJsonResponse(await fetch(url, options));
  }
  return sendExtensionRequest({ ...routeFor("POST", url), payload: body || {} });
}

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
  if (!message?.type || !/^(content-sync|dashboard|reading-queue|refresh|settings)\./.test(message.type)) return;
  window.dispatchEvent(new CustomEvent("ampira:runtime-message", { detail: message }));
});

function routeFor(method, rawUrl) {
  const { key, request } = messageRequestForHttp(method, rawUrl);
  if (!request) throw new Error(t("api.unsupportedRoute", { key }));
  return request;
}

async function readJsonResponse(response) {
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (!response.ok) throw new Error(data?.message || data?.error || `HTTP ${response.status}`);
  return data;
}

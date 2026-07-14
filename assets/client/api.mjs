import { t } from "./i18n.mjs";

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
  const response = await chrome.runtime.sendMessage({ requestId: crypto.randomUUID(), ...request });
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

if (hasExtensionRuntime() && globalThis.chrome?.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message) => {
    if (!message?.type || !/^(content-sync|dashboard|reading-queue|refresh|settings)\./.test(message.type)) return;
    window.dispatchEvent(new CustomEvent("ampira:runtime-message", { detail: message }));
  });
}

function hasExtensionRuntime() {
  return location.protocol === "chrome-extension:"
    && Boolean(globalThis.chrome?.runtime?.id && globalThis.chrome.runtime.sendMessage);
}

function routeFor(method, rawUrl) {
  const url = new URL(rawUrl, "https://ampira.invalid");
  const routes = {
    "GET /api/dashboard": "dashboard:get",
    "GET /api/settings": "settings:get",
    "GET /api/settings/export": "settings:export",
    "GET /api/refresh": "refresh:status",
    "GET /api/site-preview": "preview:get",
    "GET /api/reader": "reader:get",
    "POST /api/settings": "settings:save",
    "POST /api/settings/import": "settings:import",
    "POST /api/settings/test": "settings:test",
    "POST /api/settings/image-search/test": "settings:image-test",
    "POST /api/refresh": "refresh:start",
    "POST /api/feed/source/refresh": "feed:refresh-source",
    "POST /api/daily-summary/refresh": "digest:refresh",
    "POST /api/summary/refresh": "summary:refresh",
    "POST /api/ai/search": "ai:search",
    "POST /api/reader/translate": "reader:translate",
    "POST /api/weather/search": "weather:search",
    "POST /api/weather/forecast": "weather:get",
    "POST /api/cache/clear": "cache:clear",
    "POST /api/quota/reset": "quota:reset",
    "POST /api/preferences/reset": "preferences:reset",
    "POST /api/source-quality/reset": "source-quality:reset",
    "POST /api/feedback": "feedback:record",
  };
  const key = `${method} ${url.pathname}`;
  const type = routes[key];
  if (!type) throw new Error(t("api.unsupportedRoute", { key }));
  const payload = {};
  for (const [name, value] of url.searchParams) payload[name] = value;
  if (type === "refresh:start") payload.force = url.searchParams.get("force") === "1";
  if (type === "preview:get" || type === "reader:get") payload.url = url.searchParams.get("url") || "";
  return { type, payload };
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

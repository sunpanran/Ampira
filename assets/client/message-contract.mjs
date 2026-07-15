const HTTP_MESSAGE_ROUTES = Object.freeze({
  "GET /api/dashboard": "dashboard:get",
  "GET /api/settings": "settings:get",
  "GET /api/settings/header-cover": "header-cover:get",
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
});

export function messageRequestForHttp(method, rawUrl) {
  const url = new URL(rawUrl, "https://ampira.invalid");
  const key = `${method} ${url.pathname}`;
  const type = HTTP_MESSAGE_ROUTES[key];
  if (!type) return { key, request: null };
  const payload = Object.fromEntries(url.searchParams);
  if (type === "refresh:start") payload.force = url.searchParams.get("force") === "1";
  if (type === "preview:get" || type === "reader:get") payload.url = url.searchParams.get("url") || "";
  return { key, request: { type, payload } };
}

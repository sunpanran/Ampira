import { DEFAULT_LOCALE, translate } from "./i18n.mjs";
import { decodeResponseBuffer, fetchBounded } from "./network.mjs";

const AI_TIMEOUT_MS = 30000;
const IMAGE_TIMEOUT_MS = 12000;
const SERVICE_RESPONSE_LIMIT = 1024 * 1024;
const BRAVE_IMAGE_ENDPOINT = "https://api.search.brave.com/res/v1/images/search";
const IMAGE_SEARCH_RESULT_COUNT = 8;
const IMAGE_QUERY_MAX_LENGTH = 400;
const IMAGE_QUERY_MAX_WORDS = 50;
const MIN_IMAGE_WIDTH = 320;
const MIN_IMAGE_HEIGHT = 180;
const LOW_VALUE_IMAGE_PATTERN = /(?:^|[\s._/\\-])(?:app-?icon|avatar|badge|brandmark|favicon|icon|logo|logotype|sprite)(?:$|[\s._/\\-])/i;

export async function requestAiCompletion(settings, options) {
  const apiKey = String(options.apiKey || "").trim();
  if (!apiKey) throw serviceError("AI_KEY_MISSING", "background.error.aiKeyMissing");
  const endpoint = providerEndpoint(settings.openaiBaseUrl, settings.openaiApiStyle);
  const validation = typeof options.validateRequest === "function"
    ? await options.validateRequest({ endpoint })
    : null;
  const requiredOrigins = [endpoint, ...(Array.isArray(validation?.origins) ? validation.origins : [])];
  const permissionGranted = typeof options.hasOriginPermissions === "function"
    ? await options.hasOriginPermissions(requiredOrigins)
    : (await Promise.all(requiredOrigins.map((origin) => options.hasOriginPermission(origin)))).every(Boolean);
  if (!permissionGranted) {
    throw serviceError(
      validation?.code || "ORIGIN_PERMISSION_REQUIRED",
      validation?.messageKey || "background.error.aiOriginPermission",
    );
  }
  const chat = settings.openaiApiStyle === "chat_completions";
  let response;
  let buffer;
  try {
    const bounded = await fetchBounded(endpoint, {
      method: "POST",
      redirect: "error",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(chat ? {
        model: settings.openaiSummaryModel,
        messages: [{ role: "system", content: options.system }, { role: "user", content: options.input }],
        max_tokens: options.maxTokens,
      } : {
        model: settings.openaiSummaryModel,
        instructions: options.system,
        input: options.input,
        max_output_tokens: options.maxTokens,
      }),
    }, { timeoutMs: AI_TIMEOUT_MS, maxBytes: SERVICE_RESPONSE_LIMIT });
    response = bounded.response;
    buffer = bounded.buffer;
  } catch (error) {
    throw boundedServiceError(error, "AI");
  }
  const data = parseJsonBuffer(buffer, response.headers.get("content-type") || "");
  if (!response.ok) {
    throw serviceError(
      "AI_HTTP_ERROR",
      "background.error.aiHttp",
      { status: response.status },
      response.status === 408 || response.status === 429 || response.status >= 500,
      { status: response.status, url: response.url || endpoint },
    );
  }
  const text = aiResponseText(data, chat);
  if (!text) throw serviceError("AI_EMPTY_RESPONSE", "background.error.aiNoText", {}, true);
  return text;
}

function aiResponseText(data, chat) {
  const preferred = chat
    ? [data?.choices?.[0]?.message?.content, data?.choices?.[0]?.text]
    : [data?.output_text, data?.output];
  const fallbacks = chat
    ? [data?.output_text, data?.output]
    : [data?.choices?.[0]?.message?.content, data?.choices?.[0]?.text];
  for (const value of [...preferred, ...fallbacks]) {
    const text = contentText(value);
    if (text) return text;
  }
  return "";
}

function contentText(value) {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (typeof value.text === "string") return value.text.trim();
    if (typeof value.output_text === "string") return value.output_text.trim();
    return contentText(value.content);
  }
  if (!Array.isArray(value)) return "";
  return value
    .flatMap((item) => {
      if (typeof item === "string") return [item];
      if (!item || typeof item !== "object") return [];
      if (typeof item.text === "string") return [item.text];
      if (typeof item.output_text === "string") return [item.output_text];
      const nested = contentText(item.content);
      return nested ? [nested] : [];
    })
    .map((item) => item.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

export async function testImageSearchConnection(apiKey, hasOriginPermission) {
  const data = await requestBraveImages("Ampira", 1, apiKey, hasOriginPermission);
  return { count: Array.isArray(data.results) ? data.results.length : 0 };
}

export async function searchImagePreview(query, apiKey, hasOriginPermission) {
  const normalizedQuery = normalizeImageQuery(query);
  if (!normalizedQuery) return "";
  const data = await requestBraveImages(
    normalizedQuery,
    IMAGE_SEARCH_RESULT_COUNT,
    apiKey,
    hasOriginPermission,
  );
  return selectImageUrl(data.results, normalizedQuery);
}

export function providerEndpoint(baseUrl, style) {
  const raw = String(baseUrl || "").trim();
  const suffix = style === "chat_completions" ? "chat/completions" : "responses";
  const endpointPattern = style === "chat_completions" ? /\/chat\/completions$/i : /\/responses$/i;
  try {
    const url = new URL(raw);
    const pathname = url.pathname.replace(/\/+$/, "");
    if (!endpointPattern.test(pathname)) url.pathname = `${pathname}/${suffix}`.replace(/^\/?/, "/");
    return url.href;
  } catch {
    const base = raw.replace(/\/+$/, "");
    return endpointPattern.test(base) ? base : `${base}/${suffix}`;
  }
}

function parseJsonBuffer(buffer, contentType) {
  try {
    return JSON.parse(decodeResponseBuffer(buffer, contentType));
  } catch {
    return {};
  }
}

async function requestBraveImages(query, count, apiKey, hasOriginPermission) {
  const key = String(apiKey || "").trim();
  if (!key) throw serviceError("IMAGE_KEY_MISSING", "background.error.imageKeyMissing");
  const url = new URL(BRAVE_IMAGE_ENDPOINT);
  url.searchParams.set("q", normalizeImageQuery(query) || "Ampira");
  url.searchParams.set("count", String(Math.max(1, Math.min(IMAGE_SEARCH_RESULT_COUNT, Number(count) || 1))));
  url.searchParams.set("safesearch", "strict");
  if (!await hasOriginPermission(url.href)) {
    throw serviceError("ORIGIN_PERMISSION_REQUIRED", "background.error.bravePermission");
  }
  let response;
  let buffer;
  try {
    const bounded = await fetchBounded(url.href, {
      redirect: "error",
      headers: { accept: "application/json", "x-subscription-token": key },
    }, { timeoutMs: IMAGE_TIMEOUT_MS, maxBytes: SERVICE_RESPONSE_LIMIT });
    response = bounded.response;
    buffer = bounded.buffer;
  } catch (error) {
    throw boundedServiceError(error, "IMAGE");
  }
  if (!response.ok) {
    throw serviceError(
      "IMAGE_HTTP_ERROR",
      "background.error.imageHttp",
      { status: response.status },
      response.status === 408 || response.status === 429 || response.status >= 500,
      { status: response.status, url: url.href },
    );
  }
  return parseJsonBuffer(buffer, response.headers.get("content-type") || "");
}

function normalizeImageQuery(value) {
  const words = String(value || "").trim().split(/\s+/).filter(Boolean).slice(0, IMAGE_QUERY_MAX_WORDS);
  return words.join(" ").slice(0, IMAGE_QUERY_MAX_LENGTH).trim();
}

function selectImageUrl(results, query) {
  const candidates = (Array.isArray(results) ? results : [])
    .map((result, index) => imageCandidate(result, query, index))
    .filter(Boolean)
    .sort((left, right) => right.score - left.score || left.index - right.index);
  return candidates[0]?.url || "";
}

function imageCandidate(result, query, index) {
  if (!result || typeof result !== "object") return null;
  const proxyUrl = httpsUrl(result.thumbnail?.src);
  const thumbnailUrl = httpsUrl(result.thumbnail?.original || result.thumbnail?.url);
  const imageUrl = httpsUrl(result.properties?.url || result.image_url || result.imageUrl);
  const braveProxyUrl = isBraveImageProxy(proxyUrl) ? proxyUrl : "";
  const url = braveProxyUrl || imageUrl || proxyUrl || thumbnailUrl;
  if (!url) return null;

  const width = imageDimension(result.properties?.width ?? result.width);
  const height = imageDimension(result.properties?.height ?? result.height);
  const descriptiveText = [
    result.title,
    result.source,
    result.url,
    result.properties?.url,
    result.thumbnail?.original,
    result.thumbnail?.url,
  ].filter(Boolean).join(" ");
  if (LOW_VALUE_IMAGE_PATTERN.test(descriptiveText) || hasLowValueExtension(imageUrl || url)) return null;
  if (width && height && (width < MIN_IMAGE_WIDTH || height < MIN_IMAGE_HEIGHT)) return null;

  const searchableText = descriptiveText.toLowerCase();
  const queryTerms = query.toLowerCase().split(/\s+/).filter((term) => term.length > 2);
  const relevance = queryTerms.reduce((score, term) => score + (searchableText.includes(term) ? 1 : 0), 0);
  const aspectRatio = width && height ? width / height : 0;
  const areaScore = width && height ? Math.min(4, Math.log2((width * height) / (MIN_IMAGE_WIDTH * MIN_IMAGE_HEIGHT) + 1)) : 0;
  const score = (braveProxyUrl ? 12 : 0)
    + (imageUrl ? 4 : 0)
    + (width && height ? 3 : 0)
    + areaScore
    + (aspectRatio >= 1.1 && aspectRatio <= 2.2 ? 2 : 0)
    + Math.min(4, relevance);
  return { index, score, url };
}

function httpsUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function isBraveImageProxy(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === "imgs.search.brave.com" || hostname.endsWith(".imgs.search.brave.com");
  } catch {
    return false;
  }
}

function hasLowValueExtension(value) {
  try {
    return /\.(?:ico|svg)$/i.test(new URL(value).pathname);
  } catch {
    return true;
  }
}

function imageDimension(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function boundedServiceError(error, service) {
  const prefix = service === "IMAGE" ? "IMAGE" : "AI";
  const keyPrefix = service === "IMAGE" ? "image" : "ai";
  if (error?.code === "NETWORK_TIMEOUT") return serviceError(`${prefix}_TIMEOUT`, `background.error.${keyPrefix}Timeout`, {}, true, error.details);
  if (error?.code === "RESPONSE_TOO_LARGE") return serviceError(`${prefix}_RESPONSE_TOO_LARGE`, `background.error.${keyPrefix}TooLarge`, {}, false, error.details);
  return serviceError(`${prefix}_NETWORK_ERROR`, `background.error.${keyPrefix}Network`, {}, true, error?.details || {});
}

function serviceError(code, messageKey, messageParams = {}, retryable = false, details = {}) {
  const error = new Error(translate(DEFAULT_LOCALE, messageKey, messageParams));
  error.code = code;
  error.messageKey = messageKey;
  error.messageParams = messageParams;
  error.retryable = retryable;
  error.details = details;
  return error;
}

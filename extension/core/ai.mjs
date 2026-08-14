import { DEFAULT_LOCALE, translate } from "./runtime-i18n.mjs";
import { decodeResponseBuffer, fetchBounded } from "./network.mjs";
import { providerRequiresApiKey } from "./provider-policy.mjs";

const AI_TIMEOUT_MS = 120000;
const AI_STREAM_TIMEOUT_MS = 120000;
const IMAGE_TIMEOUT_MS = 12000;
const SERVICE_RESPONSE_LIMIT = 1024 * 1024;
const BRAVE_IMAGE_ENDPOINT = "https://api.search.brave.com/res/v1/images/search";
const IMAGE_SEARCH_RESULT_COUNT = 8;
const IMAGE_QUERY_MAX_LENGTH = 400;
const IMAGE_QUERY_MAX_WORDS = 50;
const MIN_IMAGE_WIDTH = 320;
const MIN_IMAGE_HEIGHT = 180;
const LOW_VALUE_IMAGE_PATTERN = /(?:^|[\s._/\\-])(?:app-?icon|avatar|badge|brandmark|favicon|icon|logo|logotype|sprite)(?:$|[\s._/\\-])/i;
const GEMINI_WEB_SEARCH_MODEL_PATTERN = /^gemini-(?:1\.5|2(?:\.\d+)?|3(?:\.\d+)?)(?:-[a-z0-9._-]+)?$/i;
const OPENAI_RESPONSES_WEB_SEARCH_MODEL_PATTERN = /^(?:gpt-(?:4\.1|4o|5(?:\.\d+)?)(?:-[a-z0-9._-]+)?|o(?:3|4)(?:-[a-z0-9._-]+)?)$/i;
const OPENAI_CHAT_WEB_SEARCH_MODEL_PATTERN = /^(?:gpt-4o(?:-mini)?-search-preview|gpt-5(?:\.\d+)?-search-api)$/i;

export async function requestAiCompletion(settings, options) {
  const result = await requestAiCompletionResult(settings, options);
  if (result.incomplete) {
    throw serviceError(
      result.finishReason === "length" ? "AI_OUTPUT_LIMIT" : "AI_INCOMPLETE_RESPONSE",
      result.finishReason === "length" ? "background.error.aiOutputLimit" : "background.error.aiIncomplete",
      {},
      true,
      { reason: result.finishReason, partialText: result.text },
    );
  }
  return result.text;
}

export async function requestAiCompletionResult(settings, options = {}) {
  const request = await prepareAiRequest(settings, options, false);
  let response;
  let buffer;
  try {
    const bounded = await fetchBounded(request.endpoint, { ...request.init, signal: options.signal }, {
      timeoutMs: AI_TIMEOUT_MS,
      maxBytes: SERVICE_RESPONSE_LIMIT,
    });
    response = bounded.response;
    buffer = bounded.buffer;
  } catch (error) {
    throw boundedServiceError(error, "AI");
  }
  const data = parseJsonBuffer(buffer, response.headers.get("content-type") || "");
  assertAiResponseOk(response, data, request.endpoint);
  const result = aiCompletionResult(data, request.chat, request.responseKind);
  if (!result.text && !result.incomplete) throw serviceError("AI_EMPTY_RESPONSE", "background.error.aiNoText", {}, true);
  return result;
}

export async function requestAiCompletionStream(settings, options = {}) {
  const request = await prepareAiRequest(settings, options, true);
  const fetchImpl = typeof options.fetchImpl === "function" ? options.fetchImpl : fetch;
  const controller = new AbortController();
  const abortFromExternal = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) abortFromExternal();
  else options.signal?.addEventListener("abort", abortFromExternal, { once: true });
  const timeoutId = setTimeout(() => controller.abort(), AI_STREAM_TIMEOUT_MS);
  try {
    const response = await fetchImpl(request.endpoint, { ...request.init, signal: controller.signal });
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok) {
      const buffer = await readResponseBuffer(response, SERVICE_RESPONSE_LIMIT);
      const data = parseJsonBuffer(buffer, contentType);
      if (streamUnsupported(response.status, data)) {
        return requestAiCompletionResult(settings, options);
      }
      assertAiResponseOk(response, data, request.endpoint);
    }
    if (!/text\/event-stream/i.test(contentType) || !response.body?.getReader) {
      const buffer = await readResponseBuffer(response, SERVICE_RESPONSE_LIMIT);
      const data = parseJsonBuffer(buffer, contentType);
      const result = aiCompletionResult(data, request.chat, request.responseKind);
      if (!result.text) throw serviceError("AI_EMPTY_RESPONSE", "background.error.aiNoText", {}, true);
      if (typeof options.onDelta === "function") options.onDelta(result.text);
      return result;
    }

    return await readAiEventStream(response.body, {
      chat: request.chat,
      signal: controller.signal,
      onDelta: options.onDelta,
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    if (controller.signal.aborted) {
      throw boundedServiceError(Object.assign(new Error("AI stream timed out"), { code: "NETWORK_TIMEOUT" }), "AI");
    }
    if (error?.code) throw error;
    throw boundedServiceError(error, "AI");
  } finally {
    clearTimeout(timeoutId);
    options.signal?.removeEventListener("abort", abortFromExternal);
  }
}

function streamUnsupported(status, data) {
  if (![400, 404, 415, 422].includes(status)) return false;
  const details = `${data?.error?.code || ""} ${data?.error?.message || data?.message || ""}`.toLowerCase();
  return /stream(?:ing)?/.test(details) && /(?:unsupported|not support|invalid|unknown|unrecognized)/.test(details);
}

async function prepareAiRequest(settings, options, stream) {
  const apiKey = String(options.apiKey || "").trim();
  if (providerRequiresApiKey(settings.openaiBaseUrl) && !apiKey) {
    throw serviceError("AI_KEY_MISSING", "background.error.aiKeyMissing");
  }
  const webSearchKind = options.webSearch === true ? nativeWebSearchCapability(settings) : "";
  if (options.webSearch === true && !webSearchKind) {
    throw serviceError("AI_WEB_SEARCH_UNSUPPORTED", "background.error.aiNetwork", {}, false);
  }
  const endpoint = webSearchKind === "gemini_interactions"
    ? geminiInteractionsEndpoint(settings.openaiBaseUrl)
    : providerEndpoint(settings.openaiBaseUrl, settings.openaiApiStyle);
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
  const nativeMessages = Array.isArray(options.messages);
  const messages = normalizeAiMessages(options.messages, options.input);
  const requestBody = webSearchKind === "gemini_interactions" ? {
      model: settings.openaiSummaryModel,
      input: geminiInteractionInput(options, messages),
      tools: [{ type: "google_search" }],
    } : chat ? {
      model: settings.openaiSummaryModel,
      messages: [
        ...(options.system ? [{ role: "system", content: String(options.system) }] : []),
        ...messages,
      ],
      max_tokens: options.maxTokens,
      ...(stream ? { stream: true } : {}),
      ...(webSearchKind === "openai_chat_search" ? { web_search_options: {} } : {}),
      ...(options.preferVisibleOutput === true && isOfficialDeepSeekEndpoint(endpoint)
        ? { thinking: { type: "disabled" } }
        : {}),
    } : {
      model: settings.openaiSummaryModel,
      instructions: options.system,
      input: nativeMessages ? messages : options.input,
      max_output_tokens: options.maxTokens,
      ...(stream ? { stream: true } : {}),
      ...(webSearchKind === "openai_responses" ? { tools: [{ type: "web_search" }] } : {}),
      ...(isOfficialOpenAiEndpoint(endpoint) ? { store: false } : {}),
    };
  const headers = { "content-type": "application/json" };
  if (apiKey && webSearchKind === "gemini_interactions") headers["x-goog-api-key"] = apiKey;
  else if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  return {
    endpoint,
    chat,
    responseKind: webSearchKind,
    init: {
      method: "POST",
      redirect: "error",
      headers,
      body: JSON.stringify(requestBody),
    },
  };
}

function normalizeAiMessages(value, fallbackInput) {
  const source = Array.isArray(value) ? value : [{ role: "user", content: fallbackInput }];
  return source
    .filter((message) => message && (message.role === "user" || message.role === "assistant"))
    .map((message) => ({ role: message.role, content: String(message.content || "") }))
    .filter((message) => message.content.trim());
}

function assertAiResponseOk(response, data, endpoint) {
  if (response.ok) return;
  throw serviceError(
    "AI_HTTP_ERROR",
    "background.error.aiHttp",
    { status: response.status },
    response.status === 408 || response.status === 429 || response.status >= 500,
    { status: response.status, url: response.url || endpoint, providerCode: data?.error?.code || "" },
  );
}

function aiCompletionResult(data, chat, responseKind = "") {
  const text = responseKind === "gemini_interactions"
    ? geminiInteractionText(data)
    : aiResponseText(data, chat);
  const rawReason = chat
    ? String(data?.choices?.[0]?.finish_reason || "")
    : String(data?.incomplete_details?.reason || "");
  const incomplete = chat
    ? rawReason === "length"
    : data?.status === "incomplete";
  const finishReason = incomplete && /(?:max_tokens|max_output_tokens|length)/i.test(rawReason)
    ? "length"
    : (incomplete ? (rawReason || "incomplete") : (rawReason || "stop"));
  const result = {
    text,
    incomplete,
    finishReason,
  };
  if (responseKind) result.sources = webSearchCitations(data, responseKind, text);
  return result;
}

async function readAiEventStream(body, options = {}) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = createAiSseParser({ chat: options.chat === true });
  let totalBytes = 0;
  while (true) {
    if (options.signal?.aborted) {
      await reader.cancel(options.signal.reason).catch(() => {});
      throw options.signal.reason || new DOMException("Aborted", "AbortError");
    }
    const { value, done } = await reader.read();
    if (done) break;
    totalBytes += value?.byteLength || 0;
    if (totalBytes > SERVICE_RESPONSE_LIMIT) {
      await reader.cancel().catch(() => {});
      throw serviceError("AI_RESPONSE_TOO_LARGE", "background.error.aiTooLarge", {}, false);
    }
    const events = parser.push(decoder.decode(value, { stream: true }));
    for (const event of events) if (event.delta && typeof options.onDelta === "function") options.onDelta(event.delta);
  }
  const events = parser.push(decoder.decode(), true);
  for (const event of events) if (event.delta && typeof options.onDelta === "function") options.onDelta(event.delta);
  const result = parser.result();
  if (!result.text) throw serviceError("AI_EMPTY_RESPONSE", "background.error.aiNoText", {}, true);
  return result;
}

export function createAiSseParser({ chat = false } = {}) {
  let buffer = "";
  let text = "";
  let incomplete = false;
  let finishReason = "";
  let terminalText = "";
  return { push, result };

  function push(chunk, flush = false) {
    buffer += String(chunk || "").replace(/\r\n/g, "\n");
    const blocks = buffer.split("\n\n");
    if (!flush) buffer = blocks.pop() || "";
    else buffer = "";
    const output = [];
    for (const block of blocks) {
      const dataText = block.split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!dataText || dataText === "[DONE]") continue;
      let data;
      try { data = JSON.parse(dataText); } catch { continue; }
      const event = streamEvent(data, chat);
      if (event.error) throw serviceError("AI_STREAM_ERROR", "background.error.aiNetwork", {}, true, event.error);
      if (event.delta) {
        text += event.delta;
        output.push({ delta: event.delta });
      }
      if (event.terminalText) terminalText = event.terminalText;
      if (event.finishReason) finishReason = event.finishReason;
      if (event.incomplete) incomplete = true;
    }
    return output;
  }

  function result() {
    const value = (text || terminalText).trim();
    const lengthLimited = /(?:length|max_tokens|max_output_tokens)/i.test(finishReason);
    return {
      text: value,
      incomplete: incomplete || lengthLimited,
      finishReason: lengthLimited ? "length" : (finishReason || "stop"),
    };
  }
}

function streamEvent(data, chat) {
  if (chat) {
    const choice = data?.choices?.[0] || {};
    const delta = streamContentText(choice?.delta?.content);
    return {
      delta,
      finishReason: String(choice.finish_reason || ""),
      error: data?.error || null,
    };
  }
  const type = String(data?.type || "");
  const response = data?.response || data;
  const reason = String(response?.incomplete_details?.reason || "");
  return {
    delta: type === "response.output_text.delta" ? String(data?.delta || "") : "",
    terminalText: type === "response.completed" || type === "response.incomplete"
      ? aiResponseText(response, false)
      : "",
    incomplete: type === "response.incomplete" || response?.status === "incomplete",
    finishReason: reason,
    error: type === "error" || type === "response.error" || type === "response.failed"
      ? (data?.error || response?.error || data)
      : null,
  };
}

function streamContentText(value) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return typeof value?.text === "string" ? value.text : "";
  return value.map((item) => typeof item === "string" ? item : String(item?.text || "")).join("");
}

async function readResponseBuffer(response, maxBytes) {
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > maxBytes) throw serviceError("AI_RESPONSE_TOO_LARGE", "background.error.aiTooLarge", {}, false);
  return buffer;
}

function isOfficialDeepSeekEndpoint(value) {
  try {
    return new URL(value).hostname.toLowerCase() === "api.deepseek.com";
  } catch {
    return false;
  }
}

function isOfficialOpenAiEndpoint(value) {
  try {
    return new URL(value).hostname.toLowerCase() === "api.openai.com";
  } catch {
    return false;
  }
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

export function nativeWebSearchCapability(settings = {}) {
  const host = serviceHostname(settings.openaiBaseUrl);
  const style = String(settings.openaiApiStyle || "");
  const model = String(settings.openaiSummaryModel || "").trim().toLowerCase();
  if (host === "generativelanguage.googleapis.com" && GEMINI_WEB_SEARCH_MODEL_PATTERN.test(model)) {
    return "gemini_interactions";
  }
  if (host !== "api.openai.com") return "";
  if (style === "responses" && OPENAI_RESPONSES_WEB_SEARCH_MODEL_PATTERN.test(model)) {
    return "openai_responses";
  }
  if (style === "chat_completions" && OPENAI_CHAT_WEB_SEARCH_MODEL_PATTERN.test(model)) {
    return "openai_chat_search";
  }
  return "";
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

function geminiInteractionsEndpoint(baseUrl) {
  try {
    const url = new URL(String(baseUrl || ""));
    url.pathname = "/v1beta/interactions";
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return "https://generativelanguage.googleapis.com/v1beta/interactions";
  }
}

function geminiInteractionInput(options, messages) {
  const conversation = (Array.isArray(messages) ? messages : [])
    .map((message) => `${message.role === "assistant" ? "Assistant" : "User"}: ${message.content}`)
    .join("\n\n");
  return [
    options.system ? `Instructions:\n${String(options.system)}` : "",
    conversation || String(options.input || ""),
  ].filter(Boolean).join("\n\n");
}

function geminiInteractionText(data) {
  return (Array.isArray(data?.steps) ? data.steps : [])
    .filter((step) => step?.type === "model_output")
    .flatMap((step) => Array.isArray(step.content) ? step.content : [])
    .filter((block) => block?.type === "text")
    .map((block) => String(block.text || "").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function webSearchCitations(data, responseKind, answer) {
  let annotations = [];
  if (responseKind === "gemini_interactions") {
    annotations = (Array.isArray(data?.steps) ? data.steps : [])
      .filter((step) => step?.type === "model_output")
      .flatMap((step) => Array.isArray(step.content) ? step.content : [])
      .flatMap((block) => Array.isArray(block?.annotations) ? block.annotations : []);
  } else if (responseKind === "openai_chat_search") {
    annotations = Array.isArray(data?.choices?.[0]?.message?.annotations)
      ? data.choices[0].message.annotations
      : [];
  } else {
    annotations = (Array.isArray(data?.output) ? data.output : [])
      .flatMap((item) => Array.isArray(item?.content) ? item.content : [])
      .flatMap((block) => Array.isArray(block?.annotations) ? block.annotations : []);
  }
  const byUrl = new Map();
  for (const annotation of annotations) {
    const value = annotation?.url_citation || annotation;
    if (annotation?.type && annotation.type !== "url_citation") continue;
    const url = safeCitationUrl(value?.url);
    if (!url) continue;
    const startIndex = citationIndex(value?.start_index ?? value?.startIndex, 0, answer.length);
    const endIndex = citationIndex(value?.end_index ?? value?.endIndex, startIndex, answer.length);
    const snippet = String(answer || "").slice(startIndex, endIndex).replace(/\s+/g, " ").trim();
    const current = byUrl.get(url);
    const next = {
      url,
      title: String(value?.title || "").trim().slice(0, 300),
      snippet: snippet.slice(0, 1200),
      publishedAt: citationDate(value?.published_at ?? value?.publishedAt ?? value?.date),
      startIndex,
      endIndex,
    };
    if (!current || next.snippet.length > current.snippet.length) byUrl.set(url, next);
  }
  return [...byUrl.values()];
}

function citationDate(value) {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? new Date(time).toISOString() : "";
}

function safeCitationUrl(value) {
  try {
    const url = new URL(String(value || ""));
    const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname.toLowerCase());
    if (url.protocol !== "https:" && !localHttp) return "";
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

function citationIndex(value, minimum, maximum) {
  const index = Number(value);
  if (!Number.isFinite(index)) return minimum;
  return Math.max(minimum, Math.min(maximum, Math.floor(index)));
}

function serviceHostname(value) {
  try {
    return new URL(String(value || "")).hostname.toLowerCase();
  } catch {
    return "";
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

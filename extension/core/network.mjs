const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

export async function fetchBounded(url, options = {}, limits = {}) {
  const timeoutMs = positiveNumber(limits.timeoutMs, DEFAULT_TIMEOUT_MS);
  const maxBytes = positiveNumber(limits.maxBytes, DEFAULT_MAX_BYTES);
  const controller = new AbortController();
  const externalSignal = options.signal;
  const abortFromExternal = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) abortFromExternal();
  else externalSignal?.addEventListener?.("abort", abortFromExternal, { once: true });
  const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);
  try {
    let response;
    try {
      response = await fetch(url, { ...options, signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted && !externalSignal?.aborted) {
        throw networkError("NETWORK_TIMEOUT", true, { url: String(url), timeoutMs });
      }
      throw networkError("NETWORK_ERROR", true, { url: String(url) }, error);
    }
    if (typeof limits.validateResponse === "function") {
      try {
        await limits.validateResponse(response);
      } catch (error) {
        controller.abort("response-rejected");
        throw error;
      }
    }
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > maxBytes) {
      controller.abort("response-too-large");
      throw networkError("RESPONSE_TOO_LARGE", false, {
        url: response.url || String(url),
        status: response.status,
        maxBytes,
      });
    }
    let buffer;
    try {
      buffer = await readBoundedBody(response, maxBytes, controller);
    } catch (error) {
      if (error?.code) throw error;
      if (controller.signal.aborted && !externalSignal?.aborted) {
        throw networkError("NETWORK_TIMEOUT", true, { url: response.url || String(url), timeoutMs });
      }
      throw networkError("NETWORK_ERROR", true, { url: response.url || String(url) }, error);
    }
    return { response, buffer };
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener?.("abort", abortFromExternal);
  }
}

export function decodeResponseBuffer(buffer, contentType = "") {
  const charset = String(contentType).match(/charset=([^;\s]+)/i)?.[1]?.trim() || "utf-8";
  try {
    return new TextDecoder(charset, { fatal: false }).decode(buffer);
  } catch {
    return new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  }
}

async function readBoundedBody(response, maxBytes, controller) {
  if (!response.body?.getReader) {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > maxBytes) throw responseTooLarge(response, maxBytes, controller);
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      size += value.byteLength;
      if (size > maxBytes) throw responseTooLarge(response, maxBytes, controller);
      chunks.push(value);
    }
  } finally {
    reader.releaseLock?.();
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output.buffer;
}

function responseTooLarge(response, maxBytes, controller) {
  controller.abort("response-too-large");
  return networkError("RESPONSE_TOO_LARGE", false, {
    url: response.url,
    status: response.status,
    maxBytes,
  });
}

function networkError(code, retryable, details, cause) {
  const error = new Error(code);
  error.code = code;
  error.retryable = retryable;
  error.details = details;
  if (cause) error.cause = cause;
  return error;
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

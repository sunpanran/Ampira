const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

export async function fetchBounded(url, options = {}, limits = {}) {
  const timeoutMs = positiveNumber(limits.timeoutMs, DEFAULT_TIMEOUT_MS);
  const maxBytes = positiveNumber(limits.maxBytes, DEFAULT_MAX_BYTES);
  const truncate = limits.truncate === true;
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
    if (!truncate && contentLength > maxBytes) {
      controller.abort("response-too-large");
      throw networkError("RESPONSE_TOO_LARGE", false, {
        url: response.url || String(url),
        status: response.status,
        maxBytes,
      });
    }
    let buffer;
    try {
      const body = await readBoundedBody(response, maxBytes, controller, truncate);
      buffer = body.buffer;
      return { response, buffer, truncated: body.truncated };
    } catch (error) {
      if (error?.code) throw error;
      if (controller.signal.aborted && !externalSignal?.aborted) {
        throw networkError("NETWORK_TIMEOUT", true, { url: response.url || String(url), timeoutMs });
      }
      throw networkError("NETWORK_ERROR", true, { url: response.url || String(url) }, error);
    }
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener?.("abort", abortFromExternal);
  }
}

export function decodeResponseBuffer(buffer, contentType = "") {
  const bytes = new Uint8Array(buffer || new ArrayBuffer(0));
  const charset = sniffResponseCharset(bytes, contentType);
  try {
    return new TextDecoder(charset, { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }
}

function sniffResponseCharset(bytes, contentType) {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return "utf-8";
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
  const headerCharset = String(contentType).match(/charset\s*=\s*["']?([^;\s"']+)/i)?.[1]?.trim();
  if (headerCharset) return headerCharset;
  const prefix = new TextDecoder("latin1", { fatal: false }).decode(bytes.slice(0, 1024));
  const xmlCharset = prefix.match(/<\?xml\b[^>]*\bencoding\s*=\s*["']([^"']+)["']/i)?.[1]?.trim();
  if (xmlCharset) return xmlCharset;
  const htmlCharset = prefix.match(/<meta\b[^>]*\bcharset\s*=\s*["']?([^\s"'/>]+)/i)?.[1]?.trim()
    || prefix.match(/<meta\b[^>]*\bcontent\s*=\s*["'][^"']*charset\s*=\s*([^;\s"']+)/i)?.[1]?.trim();
  return htmlCharset || "utf-8";
}

async function readBoundedBody(response, maxBytes, controller, truncate = false) {
  if (!response.body?.getReader) {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > maxBytes) {
      if (!truncate) throw responseTooLarge(response, maxBytes, controller);
      return { buffer: buffer.slice(0, maxBytes), truncated: true };
    }
    return { buffer, truncated: false };
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      if (size + value.byteLength > maxBytes) {
        if (!truncate) throw responseTooLarge(response, maxBytes, controller);
        const remaining = Math.max(0, maxBytes - size);
        if (remaining) chunks.push(value.slice(0, remaining));
        size += remaining;
        truncated = true;
        try {
          await reader.cancel?.("prefix-complete");
        } catch {
          // The requested prefix is already complete even if stream cancellation fails.
        }
        break;
      }
      size += value.byteLength;
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
  return { buffer: output.buffer, truncated };
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

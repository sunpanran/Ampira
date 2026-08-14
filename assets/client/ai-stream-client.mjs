import { hasExtensionRuntime } from "./runtime-client.mjs";

export function createAiStreamClient() {
  if (!hasExtensionRuntime() || typeof chrome.runtime.connect !== "function") return null;
  let port = null;
  const pending = new Map();
  return { start, cancel, disconnect };

  function start(payload, callbacks = {}) {
    const requestId = crypto.randomUUID();
    let connection;
    try {
      connection = ensurePort();
    } catch {
      return { requestId, result: Promise.reject(streamError("AI_STREAM_DISCONNECTED")) };
    }
    const result = new Promise((resolve, reject) => {
      pending.set(requestId, { resolve, reject, callbacks });
      try {
        connection.postMessage({ type: "start", requestId, payload });
      } catch {
        pending.delete(requestId);
        reject(streamError("AI_STREAM_DISCONNECTED"));
      }
    });
    return { requestId, result };
  }

  function cancel(requestId) {
    if (!port || !pending.has(requestId)) return false;
    port.postMessage({ type: "cancel", requestId });
    return true;
  }

  function disconnect() {
    port?.disconnect();
    port = null;
    rejectAll(streamError("AI_STREAM_DISCONNECTED"));
  }

  function ensurePort() {
    if (port) return port;
    port = chrome.runtime.connect({ name: "ampira:ai-stream" });
    port.onMessage.addListener(handleMessage);
    port.onDisconnect.addListener(() => {
      port = null;
      rejectAll(streamError("AI_STREAM_DISCONNECTED"));
    });
    return port;
  }

  function handleMessage(message) {
    const request = pending.get(String(message?.requestId || ""));
    if (!request) return;
    if (message.type === "status") {
      request.callbacks.onStatus?.(message.stage);
      return;
    }
    if (message.type === "delta") {
      request.callbacks.onDelta?.(String(message.text || ""));
      return;
    }
    pending.delete(message.requestId);
    if (message.type === "complete") request.resolve(message.data);
    else if (message.type === "cancelled") request.reject(streamError("AI_CANCELLED"));
    else if (message.type === "error") request.reject(Object.assign(
      streamError(message.error?.code || "AI_STREAM_ERROR", message.error?.message),
      message.error || {},
    ));
  }

  function rejectAll(error) {
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  }
}

function streamError(code, message = code) {
  return Object.assign(new Error(message || code), { code });
}

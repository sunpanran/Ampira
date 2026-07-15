export function hasExtensionRuntime() {
  return location.protocol === "chrome-extension:"
    && Boolean(globalThis.chrome?.runtime?.id && globalThis.chrome.runtime.sendMessage);
}

export function sendRuntimeRequest(request) {
  if (!hasExtensionRuntime()) return Promise.reject(new Error("EXTENSION_RUNTIME_UNAVAILABLE"));
  return chrome.runtime.sendMessage({ requestId: crypto.randomUUID(), ...request });
}

export function subscribeRuntimeMessages(listener) {
  if (!hasExtensionRuntime() || !globalThis.chrome?.runtime?.onMessage || typeof listener !== "function") return () => {};
  const handler = (message) => listener(message);
  chrome.runtime.onMessage.addListener(handler);
  return () => chrome.runtime.onMessage.removeListener(handler);
}

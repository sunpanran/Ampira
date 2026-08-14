const AI_STREAM_PORT_NAME = "ampira:ai-stream";

export function createAiStreamPortHandler(options) {
  return function handleAiStreamPort(port, queuedMessages = []) {
    if (port?.name !== AI_STREAM_PORT_NAME) return;
    const tasks = new Map();
    let connected = true;

    port.onMessage.addListener(handleMessage);
    for (const message of queuedMessages) handleMessage(message);

    function handleMessage(message) {
      if (!connected || !message || typeof message !== "object") return;
      const requestId = normalizeRequestId(message.requestId);
      if (!requestId) return;
      if (message.type === "cancel") {
        tasks.get(requestId)?.abort();
        return;
      }
      if (message.type !== "start" || tasks.has(requestId)) return;
      const controller = new AbortController();
      tasks.set(requestId, controller);
      safePost(port, { type: "status", requestId, stage: "starting" });
      const operation = Promise.resolve().then(() => options.run(message.payload || {}, {
        signal: controller.signal,
        onStatus: (stage) => {
          if (!controller.signal.aborted) safePost(port, { type: "status", requestId, stage: String(stage || "working") });
        },
        onDelta: (text) => {
          if (!controller.signal.aborted && text) safePost(port, { type: "delta", requestId, text: String(text) });
        },
      })).then((data) => {
        if (controller.signal.aborted) {
          safePost(port, { type: "cancelled", requestId });
          return;
        }
        safePost(port, { type: "complete", requestId, data });
      }).catch((error) => {
        if (controller.signal.aborted) {
          safePost(port, { type: "cancelled", requestId });
          return;
        }
        safePost(port, {
          type: "error",
          requestId,
          error: {
            code: error?.code || "AI_STREAM_ERROR",
            message: error?.message || String(error),
            messageKey: error?.messageKey || "",
            messageParams: error?.messageParams || {},
            retryable: error?.retryable === true,
            details: options.publicErrorDetails?.(error?.details) || {},
          },
        });
      }).finally(() => {
        tasks.delete(requestId);
      });
      options.track?.(operation);
    }

    port.onDisconnect.addListener(() => {
      connected = false;
      for (const controller of tasks.values()) controller.abort();
      tasks.clear();
    });
  };
}

function normalizeRequestId(value) {
  return String(value || "").trim().slice(0, 128);
}

function safePost(port, message) {
  try {
    port.postMessage(message);
  } catch {
    // A closed dashboard owns no remaining UI state to update.
  }
}

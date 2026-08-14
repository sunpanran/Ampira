import assert from "node:assert/strict";
import { createAiStreamPortHandler } from "../../extension/runtime/ai-stream-port.mjs";

const port = fakePort();
const handler = createAiStreamPortHandler({
  publicErrorDetails: (value) => value || {},
  run: async (payload, controls) => {
    controls.onStatus("answering");
    controls.onDelta(`delta:${payload.query}`);
    return { ok: true, answer: "done" };
  },
});
handler(port);
port.emitMessage({ type: "start", requestId: "request-1", payload: { query: "hello" } });
await tick();
assert.deepEqual(port.messages.map(({ type }) => type), ["status", "status", "delta", "complete"]);
assert.equal(port.messages.at(-1).data.answer, "done");

const cancelledPort = fakePort();
const cancelHandler = createAiStreamPortHandler({
  run: (_payload, controls) => new Promise((_resolve, reject) => {
    if (controls.signal.aborted) {
      reject(new Error("aborted"));
      return;
    }
    controls.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  }),
});
cancelHandler(cancelledPort);
cancelledPort.emitMessage({ type: "start", requestId: "request-2", payload: {} });
cancelledPort.emitMessage({ type: "cancel", requestId: "request-2" });
await tick();
assert(cancelledPort.messages.some((message) => message.type === "cancelled"), "cancel must abort only its matching task and acknowledge cancellation");

console.log("AI stream port tests passed");

function fakePort() {
  const messageListeners = [];
  const disconnectListeners = [];
  return {
    name: "ampira:ai-stream",
    messages: [],
    onMessage: { addListener(listener) { messageListeners.push(listener); } },
    onDisconnect: { addListener(listener) { disconnectListeners.push(listener); } },
    postMessage(message) { this.messages.push(message); },
    emitMessage(message) { for (const listener of messageListeners) listener(message); },
    disconnect() { for (const listener of disconnectListeners) listener(); },
  };
}

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

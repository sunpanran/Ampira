import assert from "node:assert/strict";

export async function runClientStorageTests(chrome) {
  const previousLocation = globalThis.location;
  const previousRuntime = chrome.runtime;
  globalThis.location = { protocol: "chrome-extension:" };

  try {
    await testBatchedWrites(chrome);
    await testHydrationAndOverlappingWrites(chrome);
    await testRejectedAndOversizedWrites(chrome);
  } finally {
    if (previousLocation === undefined) delete globalThis.location;
    else globalThis.location = previousLocation;
    if (previousRuntime === undefined) delete chrome.runtime;
    else chrome.runtime = previousRuntime;
  }
}

async function testBatchedWrites(chrome) {
  const messages = [];
  chrome.runtime = runtime(async (message) => {
    messages.push(message);
    return success();
  });
  const storage = await freshStorage("batch");
  await storage.hydrateStorage();
  storage.writeValue("dash.batch.one", "1");
  storage.writeValue("dash.batch.two", "2");
  await storage.flushStorage();
  assert.equal(messages.length, 1, "client-state writes must be batched");
  assert.deepEqual(messages[0].payload.values, { "dash.batch.one": "1", "dash.batch.two": "2" });
}

async function testHydrationAndOverlappingWrites(chrome) {
  let resolveHydration;
  chrome.runtime = runtime(() => success(), () => new Promise((resolve) => { resolveHydration = resolve; }));
  const storage = await freshStorage("hydrate-race");
  const hydration = storage.hydrateStorage();
  storage.writeValue("dash.race", "local-newer");
  resolveHydration({ ok: true, data: { "dash.race": "remote-older" } });
  await hydration;
  assert.equal(storage.readValue("dash.race"), "local-newer", "hydration must not overwrite a local write made while it was in flight");
  await storage.flushStorage();
  storage.applyExternalStoragePatch({ "dash.race": "remote-after-confirmation" });
  assert.equal(storage.readValue("dash.race"), "remote-after-confirmation", "confirmed local writes must stop blocking later external updates");
  storage.writeValue("dash.race", "local-latest");
  storage.applyExternalStoragePatch({ "dash.race": "remote-stale" });
  assert.equal(storage.readValue("dash.race"), "local-latest", "an older runtime echo must not overwrite a newer pending local write");
  storage.applyExternalStoragePatch({ "dash.race": "local-latest" });
  await storage.flushStorage();

  let resolveFirstWrite;
  chrome.runtime = runtime(() => {
    if (!resolveFirstWrite) return new Promise((resolve) => { resolveFirstWrite = resolve; });
    return success();
  });
  const overlapping = await freshStorage("overlapping-writes");
  await overlapping.hydrateStorage();
  overlapping.writeValue("dash.overlap", "first");
  const firstFlush = overlapping.flushStorage();
  overlapping.writeValue("dash.overlap", "second");
  await Promise.resolve();
  resolveFirstWrite(success());
  await firstFlush;
  overlapping.applyExternalStoragePatch({ "dash.overlap": "stale-between-writes" });
  assert.equal(overlapping.readValue("dash.overlap"), "second", "confirming an older batch must retain protection for a newer pending write");
  await overlapping.flushStorage();
  overlapping.applyExternalStoragePatch({ "dash.overlap": "remote-after-second-confirmation" });
  assert.equal(overlapping.readValue("dash.overlap"), "remote-after-second-confirmation", "the newest confirmed write must eventually release external-update protection");
}

async function testRejectedAndOversizedWrites(chrome) {
  let writeAttempt = 0;
  const persistedBatches = [];
  chrome.runtime = runtime(async (message) => {
    writeAttempt += 1;
    persistedBatches.push(message.payload.values);
    if (writeAttempt === 1) return { ok: false, error: { message: "invalid batch", retryable: false } };
    return success();
  });
  const storage = await freshStorage("retry");
  await storage.hydrateStorage();
  storage.writeValue("dash.rejected", "bad");
  await storage.flushStorage();
  storage.applyExternalStoragePatch({ "dash.rejected": "remote-after-rejection" });
  assert.equal(storage.readValue("dash.rejected"), "remote-after-rejection", "non-retryable writes must stop blocking external recovery");
  storage.writeValue("dash.accepted", "good");
  await storage.flushStorage();
  assert.equal(writeAttempt, 2, "a non-retryable batch must not block later writes");
  assert.deepEqual(persistedBatches[1], { "dash.accepted": "good" });
  storage.writeValue("dash.too-large", "x".repeat(512 * 1024 + 1));
  await storage.flushStorage();
  assert.equal(writeAttempt, 2, "oversized client state must be isolated before transport");
  storage.applyExternalStoragePatch({ "dash.too-large": "remote-valid" });
  assert.equal(storage.readValue("dash.too-large"), "remote-valid", "isolated oversized writes must not block later valid external state");
}

function runtime(handleWrite, handleRead = async () => ({ ok: true, data: {} })) {
  return {
    id: "test-extension",
    async sendMessage(message) {
      if (message.type === "client-state:get") return handleRead(message);
      return handleWrite(message);
    },
  };
}

function success() {
  return { ok: true, data: { ok: true } };
}

function freshStorage(label) {
  return import(`../../assets/client/storage.mjs?${label}=${Date.now()}-${Math.random()}`);
}

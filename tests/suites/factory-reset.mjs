import assert from "node:assert/strict";
import { createFactoryResetService } from "../../extension/runtime/factory-reset-service.mjs";
import { publicErrorDetails } from "../../extension/runtime/runtime-result.mjs";

export async function runFactoryResetTests() {
  const success = createHarness();
  assert.deepEqual(await success.service.factoryReset(), { ok: true });
  assert.deepEqual(success.removedPermissions, [{
    permissions: ["favicon", "search"],
    origins: ["https://feed.example/*", "https://api.example/*"],
  }], "factory reset must remove only granted optional named permissions and optional origins");
  assert.equal(success.calls.includes("sync.clear"), true);
  assert.equal(success.calls.includes("local.clear"), true);
  assert.equal(success.calls.includes("session.clear"), true);
  assert.equal(success.calls.includes("records.clear"), true);
  assert.deepEqual(success.resetting, [true, false]);
  assert.deepEqual(success.broadcasts, [{ type: "settings.factory-reset", payload: { reason: "factory-reset" } }]);

  const partial = createHarness({ failStep: "local.clear" });
  await assert.rejects(partial.service.factoryReset(), (error) => {
    assert.equal(error.code, "FACTORY_RESET_INCOMPLETE");
    assert.equal(error.retryable, true);
    assert.deepEqual(error.details.failedSteps, ["local-storage"]);
    assert.deepEqual(publicErrorDetails(error.details), { failedSteps: ["local-storage"] });
    return true;
  });
  assert.equal(partial.calls.includes("session.clear"), true, "a failed cleanup step must not stop later cleanup");
  assert.equal(partial.calls.includes("records.clear"), true, "a failed cleanup step must not skip IndexedDB cleanup");
  assert.deepEqual(partial.broadcasts.map((entry) => entry.type), ["settings.changed", "dashboard.updated"]);
  partial.setFailStep("");
  assert.deepEqual(await partial.service.factoryReset(), { ok: true }, "an incomplete reset must remain safely retryable");

  let releaseReset;
  const gate = new Promise((resolve) => { releaseReset = resolve; });
  const concurrent = createHarness({ contentReset: () => gate });
  const first = concurrent.service.factoryReset();
  const second = concurrent.service.factoryReset();
  assert.equal(first, second, "concurrent reset requests must share one operation");
  releaseReset();
  await first;

  let releaseActiveRequests;
  const activeRequestGate = new Promise((resolve) => { releaseActiveRequests = resolve; });
  const draining = createHarness({ waitForActiveRequests: () => activeRequestGate });
  const drainingReset = draining.service.factoryReset();
  await Promise.resolve();
  assert.equal(draining.calls.includes("content.reset"), false, "factory reset must wait for already-running requests before clearing state");
  releaseActiveRequests();
  await drainingReset;

  assert.deepEqual(publicErrorDetails({
    failedSteps: ["sync-storage", "sync-storage", "INVALID", "x".repeat(80)],
  }), { failedSteps: ["sync-storage"] }, "factory-reset error details must expose only bounded step identifiers");
}

function createHarness({ failStep = "", contentReset = async () => {}, waitForActiveRequests = async () => {} } = {}) {
  const calls = [];
  const resetting = [];
  const broadcasts = [];
  const removedPermissions = [];
  let currentFailStep = failStep;
  const storage = (name) => ({
    async clear() {
      const step = `${name}.clear`;
      calls.push(step);
      if (currentFailStep === step) throw new Error(step);
    },
  });
  const chrome = {
    storage: {
      sync: storage("sync"),
      local: storage("local"),
      session: storage("session"),
    },
    permissions: {
      async getAll() {
        calls.push("permissions.getAll");
        return {
          permissions: ["activeTab", "bookmarks", "storage", "alarms", "favicon", "search"],
          origins: ["https://feed.example/*", "https://api.example/*", "https://feed.example/*"],
        };
      },
      async remove(details) {
        calls.push("permissions.remove");
        removedPermissions.push(details);
        return true;
      },
    },
  };
  const service = createFactoryResetService({
    chrome,
    cacheMutations: { invalidate: () => calls.push("cache.invalidate") },
    refreshCoordinator: { invalidate: () => calls.push("refresh.invalidate") },
    permissionEpoch: { next: () => calls.push("permission.next") },
    waitForActiveRequests,
    contentSyncService: {
      async reset() {
        calls.push("content.reset");
        await contentReset();
      },
    },
    clientStateStore: { reset: async () => { calls.push("client.reset"); } },
    clearRecords: async () => { calls.push("records.clear"); },
    setResetting: (value) => resetting.push(value),
    broadcast: (type, payload) => broadcasts.push({ type, payload }),
    schedule: (callback) => callback(),
  });
  return {
    service,
    calls,
    resetting,
    broadcasts,
    removedPermissions,
    setFailStep(value) { currentFailStep = value; },
  };
}

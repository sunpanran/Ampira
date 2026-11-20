import assert from "node:assert/strict";
import { createSettingsTransferController } from "../../assets/client/settings-transfer-controller.mjs";
import { DEFAULT_SETTINGS } from "../../extension/core/constants.mjs";

const oldChrome = globalThis.chrome;
try {
  const read = deferred(), started = deferred();
  const h = harness();
  const first = h.controller.importSettingsFile(fileEvent("A.json", () => { started.resolve(); return read.promise; }));
  await started.promise;
  const second = await h.controller.importSettingsFile(fileEvent("B.json", () => assert.fail("another selection must not be read while busy")));
  assert.equal(second.status, "ignored");
  read.resolve(documentText("light"));
  await first;
  assert.deepEqual(h.imports, ["light"], "one confirmation can commit exactly one selected file");
  assert.equal(h.confirmations, 1);
  assert.equal(h.els.importSettings.disabled, false);

  const closedRead = deferred(), reading = deferred();
  const closeDuringRead = harness();
  const obsolete = closeDuringRead.controller.importSettingsFile(fileEvent("slow.json", () => { reading.resolve(); return closedRead.promise; }));
  await reading.promise;
  closeDuringRead.close(); closedRead.resolve(documentText("dark"));
  assert.equal((await obsolete).status, "cancelled");
  assert.equal(closeDuringRead.confirmations, 0);
  assert.equal(closeDuringRead.imports.length, 0);

  const shown = deferred(), decision = deferred();
  const closeDuringConfirm = harness({ confirm: () => { shown.resolve(); return decision.promise; } });
  const pending = closeDuringConfirm.controller.importSettingsFile(fileEvent("closing.json"));
  await shown.promise;
  closeDuringConfirm.close(); decision.resolve(true);
  assert.equal((await pending).status, "cancelled");
  assert.equal(closeDuringConfirm.imports.length, 0, "expired confirmation cannot mutate settings");

  const cancel = harness({ confirm: async () => false });
  assert.equal((await cancel.controller.importSettingsFile(fileEvent("cancel.json"))).status, "cancelled");
  assert.equal(cancel.els.importSettings.disabled, false);

  for (const refreshFails of [false, true]) {
    const h = harness({ authorize: true, firstLoadFails: true, refreshFails });
    const result = await h.controller.importSettingsFile(fileEvent("recovery.json"));
    assert.equal(h.granted, true, "settings view loading cannot skip required permissions after commit");
    assert.equal(result.committed, true);
    assert.equal(h.feedback.at(-1), refreshFails ? "settings.transfer.followupFailed" : "settings.transfer.authorize.done");
  }
  const postCommit = harness({ postCommitPending: true });
  await postCommit.controller.importSettingsFile(fileEvent("post-commit.json"));
  assert.equal(postCommit.imports.length, 1);
  assert.equal(postCommit.reconciliations, 1, "retry post-commit processing without resubmitting the file");
  assert.equal(postCommit.feedback.at(-1), "settings.transfer.imported");
  const failedView = harness({ allLoadsFail: true });
  const viewResult = await failedView.controller.importSettingsFile(fileEvent("failed-view.json"));
  assert.equal(viewResult.status, "pending");
  assert.equal(viewResult.committed, true);
  assert.equal(failedView.feedback.at(-1), "settings.transfer.viewPending");

  const dirty = harness({ dirty: true });
  dirty.controller.exportSettings();
  assert.equal(dirty.feedback.at(-1), "settings.transfer.saveFirst");
  for (const flags of [{ sourceRefreshScheduled: true }, { automaticAiStarted: true }, {}]) {
    const h = harness({ saveFlags: { bookmarkSourceChanged: true, ...flags } });
    await h.controller.importSettingsFile(fileEvent("source-change.json"));
    assert.equal(h.invalidations, 1, "source imports invalidate page previews before rendering");
    assert.equal(h.refreshes, Object.keys(flags).length ? 0 : 1, "already scheduled refreshes must not be duplicated");
  }
} finally { globalThis.chrome = oldChrome; }
console.log("settings import session and committed-result tests passed");

function harness({ confirm, authorize = false, firstLoadFails = false, allLoadsFail = false, refreshFails = false, postCommitPending = false, dirty = false, saveFlags = {} } = {}) {
  const h = { imports: [], feedback: [], confirmations: 0, reconciliations: 0, granted: !authorize, active: true, generation: 0, loads: 0, invalidations: 0, refreshes: 0 };
  h.settings = { ...DEFAULT_SETTINGS, sourcePermissions: [] };
  h.els = { importSettings: { disabled: false, focus() {} } };
  globalThis.chrome = { permissions: {
    request: async () => { h.granted = true; return true; }, contains: async () => h.granted,
  } };
  h.controller = createSettingsTransferController({
    els: h.els, state: { settings: h.settings }, hasUnsavedChanges: () => dirty,
    t: key => key, localizedErrorMessage: error => error.message,
    renderSettingsStatus: message => h.feedback.push(message),
    confirmAction: async content => { h.confirmations++; if (confirm) return confirm(content); content.onConfirmGesture?.(); return true; },
    runSettingsAction: async action => {
      const generation = ++h.generation;
      h.els.importSettings.disabled = true;
      try { return await action(() => h.active && h.generation === generation); }
      finally { if (h.active && h.generation === generation) h.els.importSettings.disabled = false; }
    },
    request: async message => {
      if (message.type === "settings:get") return { ...h.settings, sourcePermissions: authorize ? [{ origin: "https://new.example/*", granted: h.granted }] : [] };
      if (message.type === "settings:reconcile-import") {
        h.reconciliations++; return { ...h.settings, postCommit: { status: "complete", failedSteps: [] } };
      }
      assert.equal(message.type, "settings:import");
      h.imports.push(message.payload.config.settings.colorMode);
      h.settings = { ...h.settings, ...message.payload.config.settings };
      return { ...h.settings, ...saveFlags, committed: true, importedFieldCount: 1,
        postCommit: { status: postCommitPending ? "pending" : "complete", failedSteps: postCommitPending ? ["effects"] : [] },
        importAuthorization: { origins: authorize ? ["https://new.example/*"] : [], permissions: [], aiProvider: null, bookmarkConsent: false } };
    },
    loadSettings: async () => !allLoadsFail && ++h.loads > (firstLoadFails ? 1 : 0), captureSettingsSnapshot() {}, resetSecretDrafts() {},
    prepareLocale: async () => {}, applyUiLocale() {}, getLocale: () => "en", inspirationPreviews: { invalidate() { h.invalidations++; } },
    loadDashboard: async () => { if (refreshFails) throw new Error("SYNTHETIC_REFRESH_FAILURE"); }, triggerRefresh: async () => { h.refreshes++; },
  });
  h.close = () => { h.active = false; h.generation++; h.els.importSettings.disabled = false; };
  return h;
}

function fileEvent(name, text = async () => documentText("light")) {
  return { currentTarget: { value: "selected", files: [{ name, size: 120, text }] } };
}
function documentText(colorMode) { return JSON.stringify({ format: "ampira-settings", formatVersion: 2, settings: { colorMode } }); }
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

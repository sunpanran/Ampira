import assert from "node:assert/strict";
import { createReaderLauncher } from "../../assets/client/reader-launcher.mjs";
import { createSettingsTransferController } from "../../assets/client/settings-transfer-controller.mjs";
import { MAX_SETTINGS_TRANSFER_BYTES, SETTINGS_TRANSFER_FORMAT, SETTINGS_TRANSFER_VERSION } from "../../extension/core/settings-transfer.mjs";
import { runtimeLocaleMessages } from "../../extension/core/runtime-i18n.mjs";
import { measureStartup } from "../../scripts/measure-startup.mjs";

export async function runStartupLoadingTests(root) {
  const report = await measureStartup(root);
  assert.equal(report.dashboardJs.bytes, report.dashboardJs.modules.reduce((sum, item) => sum + item.bytes, 0));
  assert(report.dashboardJs.modules.some(item => item.file === "assets/client/theme-bootstrap.mjs"), "startup reports must include the synchronous theme bootstrap");
  assert(report.activeLocaleBytes.en > 0 && report.css.files === 9 && report.htmlBytes > 0);
  for (const locale of ["en", "zh-CN", "zh-Hant"]) {
    const messages = runtimeLocaleMessages(locale);
    assert(!Object.hasOwn(messages, "reader.back"), "worker catalogs must omit page-only Reader controls");
    assert(messages["reader.error.genericBody"] && messages["reader.translationEmpty"]);
  }
  await testReaderLoading();
  await testSettingsImport();
}

async function testReaderLoading() {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const opened = [], calls = [], errors = [], attributes = new Map();
  Object.defineProperty(globalThis, "window", { configurable: true, value: { open: (...args) => opened.push(args) } });
  try {
    const state = { settings: { floatingWebOpenEnabled: true }, seen: new Set() };
    const pending = [];
    const controller = createReaderLauncher({
      state,
      els: { webFrameOverlay: { setAttribute: (key, value) => attributes.set(key, value), removeAttribute: key => attributes.delete(key) } },
      actionKey: item => item.key,
      toggleSeen: item => state.seen.add(item.key),
      defaultSeenSource: () => "news",
      markOpenedItem: item => calls.push(["marked", item.key]),
      onError: error => errors.push(error),
    }, () => new Promise((resolve, reject) => pending.push({ resolve, reject })));
    const module = { createReaderController: () => ({
      openFloatingWeb: (...args) => calls.push(["reader", ...args]),
      closeFloatingWeb: () => calls.push(["close"]),
      backFloatingWeb: () => calls.push(["back"]),
      reloadFloatingWeb: () => calls.push(["reload"]),
    }) };
    controller.backFloatingWeb(); controller.reloadFloatingWeb(); controller.closeFloatingWeb();
    const bookmark = { key: "bookmark", cardType: "inspiration" };
    controller.openExternal("https://example.com/", "Bookmark", bookmark);
    assert.equal(opened.length, 1, "ordinary links must open synchronously, preserving their user gesture");
    assert.equal(pending.length, 0, "ordinary navigation must not import the Reader");
    assert(state.seen.has(bookmark.key));
    const item = { key: "article", cardType: "news" };
    const first = controller.openExternal("https://example.com/first", "First", item);
    const latest = controller.openExternal("https://example.com/latest", "Latest", item);
    assert.equal(attributes.get("aria-busy"), "true");
    assert(state.seen.has(item.key), "read state must update immediately while the module loads");
    await Promise.resolve();
    assert.equal(pending.length, 1, "multiple opens must share the pending import");
    controller.closeFloatingWeb();
    pending[0].resolve(module);
    assert.deepEqual(await Promise.all([first, latest]), [false, false]);
    assert(!calls.some(([type]) => type === "reader"), "Escape during loading must prevent a late open");
    assert(!attributes.has("aria-busy"));
    await controller.openExternal("https://example.com/reopen", "Reopen", item);
    assert.equal(pending.length, 1, "reopening must reuse the loaded controller");
    assert.equal(calls.at(-1)[1], "https://example.com/reopen");
    controller.reloadFloatingWeb(); controller.backFloatingWeb(); controller.closeFloatingWeb();
    assert.deepEqual(calls.slice(-3), [["reload"], ["back"], ["close"]]);

    let attempts = 0;
    const retry = createReaderLauncher({
      state, els: { webFrameOverlay: { setAttribute() {}, removeAttribute() {} } },
      actionKey: () => "", onError: error => errors.push(error),
    }, async () => {
      if (++attempts === 1) throw new Error("synthetic import failure");
      return module;
    });
    assert.equal(await retry.openExternal("https://example.com/retry", "", null, { contentKind: "news" }), false);
    assert.equal(errors.length, 1);
    assert.equal(await retry.openExternal("https://example.com/retry", "", null, { contentKind: "news" }), true);
    assert.equal(attempts, 2, "a rejected import must release the slot for retry");
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else delete globalThis.window;
  }
}

async function testSettingsImport() {
  let reads = 0, confirmations = 0;
  const feedback = [];
  const input = { files: [], value: "selected" };
  const controller = createSettingsTransferController({
    state: { settings: {} }, els: { settingsImportFile: input, importSettings: { disabled: false } },
    t: (key, params) => params?.message || key,
    renderSettingsStatus: message => feedback.push(message),
    confirmAction: async () => { confirmations++; return false; },
  });
  input.files = [{ size: MAX_SETTINGS_TRANSFER_BYTES + 1, text: async () => { reads++; return "{}"; } }];
  await controller.importSettingsFile({ currentTarget: input });
  assert.equal(reads, 0, "oversized imports must be rejected before reading the file, even with a lazy parser");
  assert.equal(input.value, "");
  assert.equal(feedback.at(-1), "settings.transfer.error.tooLarge");
  input.files = [{ size: 2, text: async () => "invalid" }];
  await controller.importSettingsFile();
  assert.equal(feedback.at(-1), "settings.transfer.error.invalidJson");
  input.files = [{ size: 200, name: "synthetic.json", text: async () => JSON.stringify({
    format: SETTINGS_TRANSFER_FORMAT, formatVersion: SETTINGS_TRANSFER_VERSION, settings: { colorMode: "light" },
  }) }];
  await controller.importSettingsFile();
  assert.equal(confirmations, 1, "valid imports must still require the existing user confirmation");
}

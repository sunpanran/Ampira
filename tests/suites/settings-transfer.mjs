import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULT_SETTINGS } from "../../extension/core/constants.mjs";
import {
  MAX_SETTINGS_TRANSFER_BYTES,
  PORTABLE_SETTINGS_FIELDS,
  createSettingsTransferDocument,
  parseSettingsTransferDocument,
  parseSettingsTransferText,
  settingsTransferBytes,
  settingsTransferFilename,
  serializeSettingsTransferDocument,
} from "../../extension/core/settings-transfer.mjs";

export function runSettingsTransferTests() {
  const published = JSON.parse(readFileSync(new URL("../fixtures/settings-transfer-v1.json", import.meta.url), "utf8"));
  const saved = JSON.parse(readFileSync(new URL("../fixtures/settings-transfer-v2.json", import.meta.url), "utf8"));
  assert.deepEqual(Object.keys(published.settings), [...PORTABLE_SETTINGS_FIELDS], "the published portable field set remains compatible");
  assert.deepEqual(parseSettingsTransferDocument(published).patch, published.settings);
  assert.deepEqual(parseSettingsTransferDocument(saved).credentials, saved.credentials);
  assert.equal(parseSettingsTransferDocument(saved).syncAiSettingsEnabled, undefined, "saved v2 files before the sync flag remain readable");
  const source = {
    ...DEFAULT_SETTINGS,
    colorMode: "light",
    dashboardGlassBlurEnabled: false,
    bookmarkSectionEnabled: false,
    syncStockWatchlistEnabled: true,
    syncCountdownsEnabled: true,
    syncTrackedTopicsEnabled: true,
    syncCalendarEnabled: true,
    syncNotesEnabled: true,
    syncWorldClockEnabled: true,
    websiteShortcuts: [{ title: "Ampira", url: "https://example.com/" }],
    openaiApiKey: "sk-private",
    braveSearchApiKey: "BSA-private",
    aiDisclosureAccepted: true,
    bookmarkConsentGranted: true,
    onboardingCompleted: true,
    sourcePermissions: [{ origin: "https://private.example/*" }],
  };
  const exported = createSettingsTransferDocument(source, {
    appVersion: "test-version",
    exportedAt: "2026-07-14T08:00:00.000Z",
  });

  assert.equal(exported.format, "ampira-settings");
  assert.equal(exported.formatVersion, 2);
  assert.equal(exported.appVersion, "test-version");
  assert.deepEqual(Object.keys(exported.settings), [...PORTABLE_SETTINGS_FIELDS]);
  for (const excluded of [
    "openaiApiKey", "braveSearchApiKey", "aiDisclosureAccepted", "bookmarkConsentGranted",
    "onboardingCompleted", "credentialGeneration", "sourcePermissions", "hasOpenAIKey", "maskedKey",
  ]) {
    assert.equal(Object.hasOwn(exported.settings, excluded), false, `exports must exclude ${excluded}`);
  }
  assert.equal(settingsTransferFilename(exported.exportedAt), "ampira-settings-2026-07-14.json");
  assert(settingsTransferBytes(exported) < MAX_SETTINGS_TRANSFER_BYTES);
  assert.deepEqual(parseSettingsTransferText(serializeSettingsTransferDocument(exported)).config, exported);
  const largeOrigins = Array.from({ length: 1000 }, (_, index) => `https://${"a".repeat(230)}${index}.example/*`);
  const largeDocument = { ...exported, permissions: { origins: largeOrigins, permissions: [], bookmarkConsent: false } };
  assert(settingsTransferBytes(largeDocument) < MAX_SETTINGS_TRANSFER_BYTES, "fixture minified JSON is within the parser limit");
  throwsCode(() => serializeSettingsTransferDocument(largeDocument), "SETTINGS_IMPORT_FILE_TOO_LARGE");
  throwsCode(() => createSettingsTransferDocument(source, { permissions: { origins: largeOrigins } }), "SETTINGS_IMPORT_FILE_TOO_LARGE");

  const full = parseSettingsTransferDocument(exported, DEFAULT_SETTINGS);
  assert.equal(full.fieldCount, PORTABLE_SETTINGS_FIELDS.length);
  assert.equal(full.patch.colorMode, "light");
  assert.equal(full.patch.dashboardGlassBlurEnabled, false);
  assert.equal(full.patch.bookmarkSectionEnabled, false);
  assert.equal(full.patch.syncStockWatchlistEnabled, true);
  assert.equal(full.patch.syncCountdownsEnabled, true);
  assert.equal(full.patch.syncTrackedTopicsEnabled, true);
  assert.equal(full.patch.syncCalendarEnabled, true);
  assert.equal(full.patch.syncNotesEnabled, true);
  assert.equal(full.patch.syncWorldClockEnabled, true);
  assert.equal(full.providerOriginChanged, false);

  const partial = transferDocument({ colorMode: "light", unknownFutureField: "ignored" });
  const parsedPartial = parseSettingsTransferDocument(partial, {
    ...DEFAULT_SETTINGS,
    accentTheme: "rose",
  });
  assert.deepEqual(parsedPartial.patch, { colorMode: "light" }, "missing fields must remain outside the import patch");
  assert.equal(parsedPartial.fieldCount, 1);

  const providerChange = parseSettingsTransferDocument(transferDocument({
    openaiBaseUrl: "https://api.example.com/v1",
  }), DEFAULT_SETTINGS);
  assert.equal(providerChange.providerOriginChanged, true);
  const providerPathChange = parseSettingsTransferDocument(transferDocument({
    openaiBaseUrl: "https://api.openai.com/compatible/v1",
  }), DEFAULT_SETTINGS);
  assert.equal(providerPathChange.providerOriginChanged, false);

  const parsedText = parseSettingsTransferText(JSON.stringify(partial), DEFAULT_SETTINGS);
  assert.deepEqual(parsedText.config, partial);
  throwsCode(() => parseSettingsTransferText("not json", DEFAULT_SETTINGS), "SETTINGS_IMPORT_INVALID_JSON");
  throwsCode(() => parseSettingsTransferDocument({}, DEFAULT_SETTINGS), "SETTINGS_IMPORT_INVALID_FORMAT");
  throwsCode(() => parseSettingsTransferDocument({ ...partial, formatVersion: 3 }, DEFAULT_SETTINGS), "SETTINGS_IMPORT_UNSUPPORTED_VERSION");
  throwsCode(() => parseSettingsTransferDocument(transferDocument({ futureOnly: true }), DEFAULT_SETTINGS), "SETTINGS_IMPORT_EMPTY");
  throwsCode(() => parseSettingsTransferDocument(transferDocument({ dashboardGlassBlurEnabled: "no" }), DEFAULT_SETTINGS), "SETTINGS_IMPORT_INVALID_VALUE");
  throwsCode(() => parseSettingsTransferDocument(transferDocument({ cardSummaryEnabled: "yes" }), DEFAULT_SETTINGS), "SETTINGS_IMPORT_INVALID_VALUE");
  throwsCode(() => parseSettingsTransferDocument(transferDocument({ bookmarkSectionEnabled: "no" }), DEFAULT_SETTINGS), "SETTINGS_IMPORT_INVALID_VALUE");
  throwsCode(() => parseSettingsTransferDocument(transferDocument({ dailyAiLimit: 0 }), DEFAULT_SETTINGS), "SETTINGS_IMPORT_INVALID_VALUE");
  throwsCode(() => parseSettingsTransferDocument(transferDocument({ openaiBaseUrl: "http://example.com/v1" }), DEFAULT_SETTINGS), "SETTINGS_IMPORT_INVALID_VALUE");
  throwsCode(() => parseSettingsTransferDocument(transferDocument({ websiteShortcuts: [{ title: "Unsafe", url: "javascript:alert(1)" }] }), DEFAULT_SETTINGS), "SETTINGS_IMPORT_INVALID_VALUE");
  throwsCode(() => parseSettingsTransferDocument({
    ...partial,
    padding: "x".repeat(MAX_SETTINGS_TRANSFER_BYTES),
  }, DEFAULT_SETTINGS), "SETTINGS_IMPORT_FILE_TOO_LARGE");

  const credentials = { openaiApiKey: "synthetic-transfer-ai", braveSearchApiKey: "synthetic-transfer-brave" };
  const withKeys = createSettingsTransferDocument(source, { credentials: { ...credentials, mcpApiKey: "ignored" } });
  assert.deepEqual(withKeys.credentials, credentials);
  const imported = parseSettingsTransferDocument(withKeys);
  assert.deepEqual(imported.credentials, credentials);
  assert.equal(Object.hasOwn(imported.patch, "openaiApiKey"), false, "keys must stay outside ordinary settings");
  assert.deepEqual(parseSettingsTransferDocument({ ...withKeys, formatVersion: 1 }).credentials, {}, "legacy files cannot import credential payloads");
  assert.deepEqual(parseSettingsTransferDocument({ ...withKeys, credentials: { openaiApiKey: " " } }).credentials, {}, "empty keys preserve existing credentials");
  for (const credentials of [null, [], { openaiApiKey: 123 }, { braveSearchApiKey: "x".repeat(8193) }, { openaiApiKey: "synthetic\nkey" }]) {
    throwsCode(() => parseSettingsTransferDocument({ ...withKeys, credentials }), "SETTINGS_IMPORT_INVALID_VALUE");
  }
  for (const field of ["openaiBaseUrl", "openaiApiStyle", "openaiSummaryModel"]) {
    const unbound = structuredClone(withKeys);
    delete unbound.settings[field];
    throwsCode(() => parseSettingsTransferDocument(unbound, DEFAULT_SETTINGS), "SETTINGS_IMPORT_INVALID_VALUE");
  }
  const injected = parseSettingsTransferDocument({ ...withKeys, settings: { ...withKeys.settings,
    aiDisclosureAccepted: true, syncAiSettingsEnabled: true, sourcePermissions: ["https://*/*"] } });
  assert.equal(Object.hasOwn(injected.patch, "aiDisclosureAccepted"), false);
  assert.equal(Object.hasOwn(injected.patch, "syncAiSettingsEnabled"), false);
  assert.equal(Object.hasOwn(injected.patch, "sourcePermissions"), false);
  for (const enabled of [true, false]) {
    const syncExport = createSettingsTransferDocument({ ...source, syncAiSettingsEnabled: enabled });
    assert.equal(syncExport.syncAiSettingsEnabled, enabled);
    assert.equal(parseSettingsTransferDocument(syncExport).syncAiSettingsEnabled, enabled);
    assert.equal(Object.hasOwn(parseSettingsTransferDocument(syncExport).patch, "syncAiSettingsEnabled"), false,
      "restoring credential sync requires a separate explicit confirmation");
  }
  assert.equal(parseSettingsTransferDocument(exported).syncAiSettingsEnabled, undefined, "older files preserve the current sync choice");
  assert.equal(parseSettingsTransferDocument({ ...exported, formatVersion: 1, syncAiSettingsEnabled: true }).syncAiSettingsEnabled, undefined);
  throwsCode(() => parseSettingsTransferDocument({ ...exported, syncAiSettingsEnabled: "true" }), "SETTINGS_IMPORT_INVALID_VALUE");
  const withPermissions = createSettingsTransferDocument(source, { permissions: {
    permissions: ["bookmarks", "storage", "favicon", "history", "search"],
    origins: ["https://feed.example/*", "http://localhost/*", "https://*/*"],
  } });
  assert.deepEqual(withPermissions.permissions, {
    permissions: ["favicon", "history", "search"], origins: ["https://feed.example/*", "http://localhost/*"], bookmarkConsent: true,
  }, "exports contain only supported optional permission requests, not grants");
  assert.deepEqual(parseSettingsTransferDocument(withPermissions).permissions, withPermissions.permissions);
  for (const permissions of [null, [], { permissions: ["tabs"] }, { permissions: "favicon" },
    { origins: ["https://*/*"] }, { origins: ["http://unsafe.example/*"] },
    { origins: ["https://user:pass@example.com/*"] }, { origins: ["https://example.com/private"] },
    { origins: Array(1001).fill("https://example.com/*") }, { bookmarkConsent: "true" }]) {
    throwsCode(() => parseSettingsTransferDocument({ ...withKeys, permissions }), "SETTINGS_IMPORT_INVALID_VALUE");
  }
}

function transferDocument(settings) {
  return {
    format: "ampira-settings",
    formatVersion: 1,
    appVersion: "test-version",
    exportedAt: "2026-07-14T08:00:00.000Z",
    settings,
  };
}

function throwsCode(action, code) {
  assert.throws(action, (error) => error?.code === code, `expected ${code}`);
}

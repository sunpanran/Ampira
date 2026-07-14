import assert from "node:assert/strict";
import { DEFAULT_SETTINGS } from "../../extension/core/constants.mjs";
import {
  MAX_SETTINGS_TRANSFER_BYTES,
  PORTABLE_SETTINGS_FIELDS,
  createSettingsTransferDocument,
  parseSettingsTransferDocument,
  parseSettingsTransferText,
  settingsTransferBytes,
  settingsTransferFilename,
} from "../../extension/core/settings-transfer.mjs";

export function runSettingsTransferTests() {
  const source = {
    ...DEFAULT_SETTINGS,
    colorMode: "light",
    websiteShortcuts: [{ title: "Ampira", url: "https://example.com/" }],
    openaiApiKey: "sk-private",
    braveSearchApiKey: "BSA-private",
    aiDisclosureAccepted: true,
    bookmarkConsentGranted: true,
    onboardingCompleted: true,
    sourcePermissions: [{ origin: "https://private.example/*" }],
  };
  const exported = createSettingsTransferDocument(source, {
    appVersion: "26.1.10",
    exportedAt: "2026-07-14T08:00:00.000Z",
  });

  assert.equal(exported.format, "ampira-settings");
  assert.equal(exported.formatVersion, 1);
  assert.equal(exported.appVersion, "26.1.10");
  assert.deepEqual(Object.keys(exported.settings), [...PORTABLE_SETTINGS_FIELDS]);
  for (const excluded of [
    "openaiApiKey", "braveSearchApiKey", "aiDisclosureAccepted", "bookmarkConsentGranted",
    "onboardingCompleted", "credentialGeneration", "sourcePermissions", "hasOpenAIKey", "maskedKey",
  ]) {
    assert.equal(Object.hasOwn(exported.settings, excluded), false, `exports must exclude ${excluded}`);
  }
  assert.equal(settingsTransferFilename(exported.exportedAt), "ampira-settings-2026-07-14.json");
  assert(settingsTransferBytes(exported) < MAX_SETTINGS_TRANSFER_BYTES);

  const full = parseSettingsTransferDocument(exported, DEFAULT_SETTINGS);
  assert.equal(full.fieldCount, PORTABLE_SETTINGS_FIELDS.length);
  assert.equal(full.patch.colorMode, "light");
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
  throwsCode(() => parseSettingsTransferDocument({ ...partial, formatVersion: 2 }, DEFAULT_SETTINGS), "SETTINGS_IMPORT_UNSUPPORTED_VERSION");
  throwsCode(() => parseSettingsTransferDocument(transferDocument({ futureOnly: true }), DEFAULT_SETTINGS), "SETTINGS_IMPORT_EMPTY");
  throwsCode(() => parseSettingsTransferDocument(transferDocument({ cardSummaryEnabled: "yes" }), DEFAULT_SETTINGS), "SETTINGS_IMPORT_INVALID_VALUE");
  throwsCode(() => parseSettingsTransferDocument(transferDocument({ dailyAiLimit: 0 }), DEFAULT_SETTINGS), "SETTINGS_IMPORT_INVALID_VALUE");
  throwsCode(() => parseSettingsTransferDocument(transferDocument({ openaiBaseUrl: "http://example.com/v1" }), DEFAULT_SETTINGS), "SETTINGS_IMPORT_INVALID_VALUE");
  throwsCode(() => parseSettingsTransferDocument(transferDocument({ websiteShortcuts: [{ title: "Unsafe", url: "javascript:alert(1)" }] }), DEFAULT_SETTINGS), "SETTINGS_IMPORT_INVALID_VALUE");
  throwsCode(() => parseSettingsTransferDocument({
    ...partial,
    padding: "x".repeat(MAX_SETTINGS_TRANSFER_BYTES),
  }, DEFAULT_SETTINGS), "SETTINGS_IMPORT_FILE_TOO_LARGE");
}

function transferDocument(settings) {
  return {
    format: "ampira-settings",
    formatVersion: 1,
    appVersion: "26.1.10",
    exportedAt: "2026-07-14T08:00:00.000Z",
    settings,
  };
}

function throwsCode(action, code) {
  assert.throws(action, (error) => error?.code === code, `expected ${code}`);
}

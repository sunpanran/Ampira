const MESSAGES = Object.freeze({
  SETTINGS_IMPORT_INVALID_JSON: "settings.transfer.error.invalidJson",
  SETTINGS_IMPORT_INVALID_FORMAT: "settings.transfer.error.invalidFormat",
  SETTINGS_IMPORT_UNSUPPORTED_VERSION: "settings.transfer.error.unsupportedVersion",
  SETTINGS_IMPORT_FILE_TOO_LARGE: "settings.transfer.error.tooLarge",
  SETTINGS_IMPORT_EMPTY: "settings.transfer.error.empty",
  SETTINGS_IMPORT_INVALID_VALUE: "settings.transfer.error.invalidValue",
});

export function settingsTransferError(code, details = {}) {
  return Object.assign(new Error(code), {
    name: "SettingsTransferError", code, details,
    messageKey: MESSAGES[code] || MESSAGES.SETTINGS_IMPORT_INVALID_FORMAT,
    messageParams: { field: details.field || "", version: details.version ?? "" },
  });
}

export function invalidTransferValue(field) {
  return settingsTransferError("SETTINGS_IMPORT_INVALID_VALUE", { field });
}

const CONTENT_SYNC_CONTROLS = Object.freeze([
  ["syncReadingQueueEnabledInput", "syncReadingQueueEnabled"],
  ["syncTodosEnabledInput", "syncTodosEnabled"],
  ["syncWeatherLocationEnabledInput", "syncWeatherLocationEnabled"],
]);

export function applyContentSyncSettings(els, settings = {}) {
  for (const [control, field] of CONTENT_SYNC_CONTROLS) els[control].checked = settings[field] === true;
}

export function contentSyncSettingsPayload(els) {
  return Object.fromEntries(CONTENT_SYNC_CONTROLS.map(([control, field]) => [field, els[control].checked]));
}

export function setContentSyncControlsBusy(els, busy) {
  for (const [control] of CONTENT_SYNC_CONTROLS) els[control].disabled = busy;
}

const CONTENT_SYNC_CONTROLS = Object.freeze([
  ["syncReadingQueueEnabledInput", "syncReadingQueueEnabled"],
  ["syncTodosEnabledInput", "syncTodosEnabled"],
  ["syncWeatherLocationEnabledInput", "syncWeatherLocationEnabled"],
]);

export function applyContentSyncSettings(els, settings = {}) {
  for (const [control, field] of CONTENT_SYNC_CONTROLS) els[control].checked = settings[field] === true;
  syncContentSyncMaster(els);
}

export function setAllContentSyncControls(els, enabled) {
  for (const [control] of CONTENT_SYNC_CONTROLS) els[control].checked = enabled === true;
  syncContentSyncMaster(els);
}

export function syncContentSyncMaster(els) {
  const enabledCount = CONTENT_SYNC_CONTROLS.filter(([control]) => els[control].checked).length;
  els.contentSyncEnabledInput.checked = enabledCount > 0;
  els.contentSyncEnabledInput.indeterminate = false;
  els.contentSyncEnabledInput.setAttribute("aria-checked", String(els.contentSyncEnabledInput.checked));
  if (els.contentSyncDetails) els.contentSyncDetails.hidden = !els.contentSyncEnabledInput.checked;
  syncContentSyncControlAvailability(els, els.contentSyncEnabledInput.disabled);
}

export function contentSyncSettingsPayload(els) {
  return Object.fromEntries(CONTENT_SYNC_CONTROLS.map(([control, field]) => [field, els[control].checked]));
}

export function setContentSyncControlsBusy(els, busy) {
  setSwitchUnavailable(els.contentSyncEnabledInput, busy);
  syncContentSyncControlAvailability(els, busy);
}

function syncContentSyncControlAvailability(els, busy = false) {
  const unavailable = busy || !els.contentSyncEnabledInput.checked;
  for (const [control] of CONTENT_SYNC_CONTROLS) setSwitchUnavailable(els[control], unavailable);
}

function setSwitchUnavailable(input, unavailable) {
  input.disabled = unavailable;
  input.closest(".switch-field")?.setAttribute("aria-disabled", String(unavailable));
}

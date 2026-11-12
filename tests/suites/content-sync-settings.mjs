import assert from "node:assert/strict";
import {
  applyContentSyncSettings,
  contentSyncSettingsPayload,
  setAllContentSyncControls,
  setContentSyncControlsBusy,
  syncContentSyncMaster,
} from "../../assets/client/content-sync-settings.mjs";

const els = createControls();
applyContentSyncSettings(els, {
  syncReadingQueueEnabled: true,
  syncTodosEnabled: false,
  syncWeatherLocationEnabled: false,
});
assert.equal(els.contentSyncEnabledInput.checked, true, "a partial selection must keep the binary master switch on");
assert.equal(els.contentSyncEnabledInput.indeterminate, false, "the content sync master must never expose a mixed state");
assert.equal(els.contentSyncEnabledInput.attributes.get("aria-checked"), "true");
assert.equal(els.contentSyncDetails.hidden, false, "enabled content sync must reveal its dependent controls");
assertDependentAvailability(els, false);
assert.equal(els.syncAiSettingsEnabledInput.checked, false, "credential sync must default off");

setAllContentSyncControls(els, false);
assert.equal(els.contentSyncEnabledInput.checked, false);
assert.equal(els.contentSyncEnabledInput.indeterminate, false);
assert.equal(els.contentSyncEnabledInput.attributes.get("aria-checked"), "false");
assert.equal(els.contentSyncDetails.hidden, true, "disabled content sync must hide its dependent controls");
assertDependentAvailability(els, true);

setAllContentSyncControls(els, true);
assert.equal(els.syncAiSettingsEnabledInput.checked, false, "the content master must not opt credentials into sync");
assert.equal(els.contentSyncEnabledInput.checked, true);
assert.equal(els.contentSyncDetails.hidden, false);
assertDependentAvailability(els, false);

assert.equal(contentSyncSettingsPayload(els).syncStockWatchlistEnabled, true);
assert.equal(contentSyncSettingsPayload(els).syncCountdownsEnabled, true);

setContentSyncControlsBusy(els, true);
assert.equal(els.syncAiSettingsEnabledInput.disabled, true);
assert.equal(els.contentSyncEnabledInput.disabled, true);
assert.equal(els.contentSyncEnabledInput.label.attributes.get("aria-disabled"), "true");
assertDependentAvailability(els, true);

setContentSyncControlsBusy(els, false);
assert.equal(els.syncAiSettingsEnabledInput.disabled, false);
assert.equal(els.contentSyncEnabledInput.disabled, false);
assert.equal(els.contentSyncEnabledInput.label.attributes.get("aria-disabled"), "false");
assertDependentAvailability(els, false);

for (const input of dependentControls(els)) input.checked = false;
syncContentSyncMaster(els);
assert.equal(els.contentSyncEnabledInput.checked, false);
assert.equal(els.contentSyncDetails.hidden, true);
assertDependentAvailability(els, true);
els.syncAiSettingsEnabledInput.checked = true;
setAllContentSyncControls(els, false);
assert.equal(els.syncAiSettingsEnabledInput.checked, true, "credential sync must stay independent of the content master");
assert.equal(els.syncAiSettingsEnabledInput.disabled, false, "credential sync remains usable when content sync is off");
assert.equal(contentSyncSettingsPayload(els).syncAiSettingsEnabled, true);
applyContentSyncSettings(els, { syncAiSettingsEnabled: true });
assert.equal(els.syncAiSettingsEnabledInput.checked, true);
assert.equal(els.contentSyncEnabledInput.checked, false);

for (const field of ["syncStockWatchlistEnabled", "syncCountdownsEnabled"]) {
  applyContentSyncSettings(els, { [field]: true });
  assert.equal(els.contentSyncEnabledInput.checked, true, `${field} alone keeps the master enabled`);
  assert.equal(els.contentSyncDetails.hidden, false);
  assert.equal(contentSyncSettingsPayload(els)[field], true);
  assertDependentAvailability(els, false);
}

console.log("content sync settings tests passed");

function createControls() {
  return {
    contentSyncEnabledInput: createInput(),
    contentSyncDetails: { hidden: true },
    syncReadingQueueEnabledInput: createInput(),
    syncTodosEnabledInput: createInput(),
    syncWeatherLocationEnabledInput: createInput(),
    syncStockWatchlistEnabledInput: createInput(),
    syncCountdownsEnabledInput: createInput(),
    syncAiSettingsEnabledInput: createInput(),
  };
}

function createInput() {
  const label = {
    attributes: new Map(),
    setAttribute(name, value) { this.attributes.set(name, value); },
  };
  return {
    attributes: new Map(),
    checked: false,
    disabled: false,
    indeterminate: false,
    label,
    closest(selector) { return selector === ".switch-field" ? label : null; },
    setAttribute(name, value) { this.attributes.set(name, value); },
  };
}

function dependentControls(els) {
  return [
    els.syncReadingQueueEnabledInput,
    els.syncTodosEnabledInput,
    els.syncWeatherLocationEnabledInput,
    els.syncStockWatchlistEnabledInput,
    els.syncCountdownsEnabledInput,
  ];
}

function assertDependentAvailability(els, unavailable) {
  for (const input of dependentControls(els)) {
    assert.equal(input.disabled, unavailable);
    assert.equal(input.label.attributes.get("aria-disabled"), String(unavailable));
  }
}

import assert from "node:assert/strict";
import {
  applyContentSyncSettings,
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
assertDependentAvailability(els, false);

setAllContentSyncControls(els, false);
assert.equal(els.contentSyncEnabledInput.checked, false);
assert.equal(els.contentSyncEnabledInput.indeterminate, false);
assert.equal(els.contentSyncEnabledInput.attributes.get("aria-checked"), "false");
assertDependentAvailability(els, true);

setAllContentSyncControls(els, true);
assert.equal(els.contentSyncEnabledInput.checked, true);
assertDependentAvailability(els, false);

setContentSyncControlsBusy(els, true);
assert.equal(els.contentSyncEnabledInput.disabled, true);
assert.equal(els.contentSyncEnabledInput.label.attributes.get("aria-disabled"), "true");
assertDependentAvailability(els, true);

setContentSyncControlsBusy(els, false);
assert.equal(els.contentSyncEnabledInput.disabled, false);
assert.equal(els.contentSyncEnabledInput.label.attributes.get("aria-disabled"), "false");
assertDependentAvailability(els, false);

for (const input of dependentControls(els)) input.checked = false;
syncContentSyncMaster(els);
assert.equal(els.contentSyncEnabledInput.checked, false);
assertDependentAvailability(els, true);

console.log("content sync settings tests passed");

function createControls() {
  return {
    contentSyncEnabledInput: createInput(),
    syncReadingQueueEnabledInput: createInput(),
    syncTodosEnabledInput: createInput(),
    syncWeatherLocationEnabledInput: createInput(),
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
  ];
}

function assertDependentAvailability(els, unavailable) {
  for (const input of dependentControls(els)) {
    assert.equal(input.disabled, unavailable);
    assert.equal(input.label.attributes.get("aria-disabled"), String(unavailable));
  }
}

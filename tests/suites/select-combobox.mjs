import assert from "node:assert/strict";
import {
  edgeEnabledOptionIndex,
  nextEnabledOptionIndex,
  typeaheadOptionIndex,
} from "../../assets/client/select-combobox.mjs";

const enabled = (label) => ({ label, disabled: false, hidden: false, parentElement: null });
const disabled = (label) => ({ label, disabled: true, hidden: false, parentElement: null });
const groupedDisabled = (label) => ({ label, disabled: false, hidden: false, parentElement: { disabled: true } });
const hidden = (label) => ({ label, disabled: false, hidden: true, parentElement: null });

const options = [enabled("Alpha"), disabled("Beta"), enabled("Gamma"), groupedDisabled("Delta"), hidden("Echo")];
assert.equal(nextEnabledOptionIndex(options, 0, 1), 2, "forward navigation must skip disabled options");
assert.equal(nextEnabledOptionIndex(options, 2, 1), 0, "forward navigation must wrap");
assert.equal(nextEnabledOptionIndex(options, 0, -1), 2, "backward navigation must wrap and skip unavailable options");
assert.equal(nextEnabledOptionIndex(options, -1, 1), 0, "navigation without an active option must start at the first available option");
assert.equal(nextEnabledOptionIndex(options, -1, -1), 2, "reverse navigation without an active option must start at the last available option");
assert.equal(edgeEnabledOptionIndex(options), 0);
assert.equal(edgeEnabledOptionIndex(options, true), 2);

const searchable = [enabled("English"), enabled("简体中文"), disabled("繁體中文（停用）"), enabled("繁體中文")];
assert.equal(typeaheadOptionIndex(searchable, "简", -1), 1, "typeahead must support CJK labels");
assert.equal(typeaheadOptionIndex(searchable, "繁", 1), 3, "typeahead must skip disabled matches");
assert.equal(typeaheadOptionIndex(searchable, "en", 3), 0, "typeahead must match case-insensitively and wrap");
assert.equal(typeaheadOptionIndex(searchable, "missing", 0), -1);

console.log("select combobox tests passed");

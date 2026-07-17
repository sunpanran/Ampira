import assert from "node:assert/strict";
import { hexToHsv, hsvToHex } from "../../assets/client/accent-color-picker.mjs";

assert.deepEqual(hexToHsv("#FF0000"), { h: 0, s: 100, v: 100 });
assert.deepEqual(hexToHsv("#00FF00"), { h: 120, s: 100, v: 100 });
assert.deepEqual(hexToHsv("#0000FF"), { h: 240, s: 100, v: 100 });
assert.deepEqual(hexToHsv("#FFFFFF"), { h: 0, s: 0, v: 100 });
assert.deepEqual(hexToHsv("#000000"), { h: 0, s: 0, v: 0 });
assert.equal(hexToHsv("invalid"), null);

for (const color of ["#9152FF", "#06B6D4", "#10B981", "#D99A18", "#E0526E", "#123456", "#F0F0F0"]) {
  const hsv = hexToHsv(color);
  assert.equal(hsvToHex(hsv.h, hsv.s, hsv.v), color, `${color} must survive a HEX to HSV round trip`);
}

assert.equal(hsvToHex(0, 100, 100), "#FF0000");
assert.equal(hsvToHex(360, 100, 100), "#FF0000");
assert.equal(hsvToHex(-120, 100, 100), "#0000FF");
assert.equal(hsvToHex(60, 0, 50), "#808080");

console.log("accent color picker tests passed");

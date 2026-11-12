import assert from "node:assert/strict";
import { calendarDate, calendarDays, normalizePickerDate, pickerDateParts, pickerKeyDate, shiftPickerDate } from "../../assets/client/date-picker-model.mjs";

export function runDatePickerTests() {
  for (const [value, expected] of Object.entries({ "2026-11-12": "2026-11-12", "2026/1/2": "2026-01-02", " 2026.1.2 ": "2026-01-02", "0001-01-01": "0001-01-01", "2028-2-29": "2028-02-29" })) {
    assert.equal(normalizePickerDate(value), expected);
  }
  for (const value of ["2026-02-29", "2026-2-30", "2026-13-1", "2026-00-00", "0000-01-01", "10000-01-01", "2026-11-12T12:00:00Z", null, {}, "<script>"]) assert.equal(normalizePickerDate(value), "");
  assert.deepEqual(pickerDateParts("2026-11-12"), { year: 2026, month: 10, day: 12, weekday: 4 });
  assert.equal(pickerDateParts("bad"), null);
  assert.equal(calendarDate(99, 11, 31), "0099-12-31");
  assert.equal(calendarDate(2026, 12, 1), "2027-01-01");
  assert.equal(calendarDate(0, 11, 31), "");
  assert.equal(shiftPickerDate("2026-01-31", { months: 1 }), "2026-02-28");
  assert.equal(shiftPickerDate("2028-01-31", { months: 1 }), "2028-02-29");
  assert.equal(shiftPickerDate("2028-02-29", { months: 12 }), "2029-02-28");
  assert.equal(shiftPickerDate("2026-12-31", { days: 1 }), "2027-01-01");
  assert.equal(shiftPickerDate("0001-01-01", { days: -1 }), "");
  assert.equal(shiftPickerDate("9999-12-31", { days: 1 }), "");
  assert.equal(shiftPickerDate("9999-12-01", { months: 1 }), "");
  assert.equal(shiftPickerDate("bad", { months: 1 }), "");
  assert.equal(shiftPickerDate("2026-11-12", { days: 1.5 }), "");
  const monday = calendarDays("2026-11-12", 1), sunday = calendarDays("2026-11-12", 0);
  assert.equal(monday.length, 42); assert.equal(monday[0], "2026-10-26"); assert.equal(monday.at(-1), "2026-12-06");
  assert.equal(sunday[0], "2026-11-01"); assert.equal(sunday.at(-1), "2026-12-12");
  assert(calendarDays("2028-02-01").includes("2028-02-29"));
  assert(!calendarDays("2026-02-01").includes("2026-02-29"));
  assert.equal(calendarDays("0001-01-01", 0)[0], "", "out-of-range adjacent dates are blank cells");
  assert(calendarDays("9999-12-01").includes(""));
  assert.deepEqual(calendarDays("bad"), []);
  for (const [key, expected] of Object.entries({ ArrowLeft: "2026-11-11", ArrowRight: "2026-11-13", ArrowUp: "2026-11-05", ArrowDown: "2026-11-19", Home: "2026-11-09", End: "2026-11-15", PageUp: "2026-10-12", PageDown: "2026-12-12" })) {
    assert.equal(pickerKeyDate("2026-11-12", key), expected, key);
  }
  assert.equal(pickerKeyDate("2026-11-12", "Home", false, 0), "2026-11-08");
  assert.equal(pickerKeyDate("2028-02-29", "PageDown", true), "2029-02-28");
  assert.equal(pickerKeyDate("2026-11-12", "PageUp", true), "2025-11-12");
  assert.equal(pickerKeyDate("2026-11-12", "Tab"), "");
}

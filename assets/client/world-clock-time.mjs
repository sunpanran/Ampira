const formatters = new Map();
function formatter(locale, timeZone, options) {
  const key = JSON.stringify([locale, timeZone, options]);
  if (!formatters.has(key)) formatters.set(key, new Intl.DateTimeFormat(locale, { timeZone, ...options }));
  return formatters.get(key);
}
function dateParts(date, timeZone) {
  const parts = formatter("en-GB-u-nu-latn", timeZone, { year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  return Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, Number(part.value)]));
}
function offset(date, parts) {
  return (Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - Math.floor(date.getTime() / 60_000) * 60_000) / 60_000;
}
export function worldClockTime(date, timeZone, locale, localZone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  const parts = dateParts(date, timeZone), local = dateParts(date, localZone);
  const difference = offset(date, parts) - offset(date, local);
  const differenceText = (difference < 0 ? "−" : "+") + Math.floor(Math.abs(difference) / 60) + ":" + String(Math.abs(difference) % 60).padStart(2, "0");
  const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  return {
    time: formatter(locale, timeZone, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date),
    date: formatter(locale, timeZone, { month: "short", day: "numeric", weekday: "short" }).format(date),
    difference, differenceText, working: weekday > 0 && weekday < 6 && parts.hour >= 9 && parts.hour < 18,
  };
}

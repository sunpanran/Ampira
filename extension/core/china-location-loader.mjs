export const CHINA_LOCATION_DATA_MAX_BYTES = 640 * 1024;
export const CHINA_LOCATION_DATA_MAX_RECORDS = 5000;

const DEFAULT_DATA_URL = new URL("../data/china-locations.json", import.meta.url);
const REQUIRED_STRING_FIELDS = Object.freeze(["zh", "en", "a1zh", "a1en", "a2zh", "a2en", "f"]);

export function createChinaLocationLoader(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const dataUrl = options.dataUrl || DEFAULT_DATA_URL;
  let recordsPromise = null;

  return function loadChinaLocationRecords() {
    if (!recordsPromise) {
      recordsPromise = fetchChinaLocationRecords(fetchImpl, dataUrl).catch((error) => {
        recordsPromise = null;
        throw error;
      });
    }
    return recordsPromise;
  };
}

async function fetchChinaLocationRecords(fetchImpl, dataUrl) {
  if (typeof fetchImpl !== "function") throw new Error("China location data fetch is unavailable.");
  const response = await fetchImpl(String(dataUrl), {
    cache: "force-cache",
    credentials: "same-origin",
    headers: { accept: "application/json" },
  });
  if (!response?.ok) throw new Error(`China location data request failed (${response?.status || 0}).`);
  const contentType = String(response.headers?.get?.("content-type") || "").toLowerCase();
  if (contentType && !contentType.includes("json")) throw new Error("China location data is not JSON.");
  const buffer = await response.arrayBuffer();
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength > CHINA_LOCATION_DATA_MAX_BYTES) {
    throw new Error("China location data exceeds its size limit.");
  }
  let records;
  try {
    records = JSON.parse(new TextDecoder().decode(buffer));
  } catch {
    throw new Error("China location data is invalid JSON.");
  }
  return validateChinaLocationRecords(records);
}

function validateChinaLocationRecords(records) {
  if (!Array.isArray(records) || records.length < 1 || records.length > CHINA_LOCATION_DATA_MAX_RECORDS) {
    throw new Error("China location data has an invalid record count.");
  }
  for (const record of records) {
    if (!record || !Number.isSafeInteger(record.id) || !Number.isFinite(record.lat) || !Number.isFinite(record.lon)) {
      throw new Error("China location data contains an invalid record.");
    }
    if (record.lat < -90 || record.lat > 90 || record.lon < -180 || record.lon > 180) {
      throw new Error("China location data contains invalid coordinates.");
    }
    if (
      REQUIRED_STRING_FIELDS.some((field) => typeof record[field] !== "string")
      || !Array.isArray(record.keys)
      || record.keys.some((key) => typeof key !== "string")
    ) {
      throw new Error("China location data contains invalid text fields.");
    }
  }
  return records;
}

import { LOCAL_HEADER_COVER_KEY } from "./constants.mjs";

export const HEADER_COVER_INPUT_MAX_BYTES = 20 * 1024 * 1024;
export const HEADER_COVER_STORED_MAX_BYTES = Math.floor(2.5 * 1024 * 1024);
export const HEADER_COVER_MAX_DIMENSION = 2560;
export const HEADER_COVER_MIN_LONG_EDGE = 1280;
export const HEADER_COVER_QUALITIES = Object.freeze([0.88, 0.80, 0.72]);
export const HEADER_COVER_RESIZE_FACTOR = 0.85;

const WEBP_DATA_URL_PREFIX = "data:image/webp;base64,";

export function createHeaderCoverStore(storage, { now = () => new Date().toISOString() } = {}) {
  if (!storage?.get || !storage?.set || !storage?.remove) throw new TypeError("Header cover storage is unavailable");

  return { read, apply, restore, validateOperation };

  async function read() {
    const snapshot = await readSnapshot();
    const record = normalizeHeaderCoverRecord(snapshot.value);
    return {
      available: Boolean(record),
      invalid: snapshot.exists && !record,
      record,
    };
  }

  function validateOperation(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw headerCoverError("HEADER_COVER_INVALID");
    if (value.action === "remove") return { action: "remove" };
    if (value.action !== "replace") throw headerCoverError("HEADER_COVER_INVALID");
    const record = normalizeHeaderCoverRecord({ ...value.record, schemaVersion: 1, updatedAt: now() });
    if (!record) throw headerCoverError("HEADER_COVER_INVALID");
    return { action: "replace", record };
  }

  async function apply(value) {
    const operation = validateOperation(value);
    const previous = await readSnapshot();
    try {
      if (operation.action === "remove") await storage.remove(LOCAL_HEADER_COVER_KEY);
      else await storage.set({ [LOCAL_HEADER_COVER_KEY]: operation.record });
    } catch (error) {
      throw headerCoverError("HEADER_COVER_STORAGE_FAILED", error);
    }
    return { previous, operation };
  }

  async function restore(snapshot) {
    try {
      if (snapshot?.exists) await storage.set({ [LOCAL_HEADER_COVER_KEY]: snapshot.value });
      else await storage.remove(LOCAL_HEADER_COVER_KEY);
    } catch (error) {
      throw headerCoverError("HEADER_COVER_STORAGE_FAILED", error);
    }
  }

  async function readSnapshot() {
    const values = await storage.get(LOCAL_HEADER_COVER_KEY);
    return {
      exists: Object.hasOwn(values || {}, LOCAL_HEADER_COVER_KEY),
      value: values?.[LOCAL_HEADER_COVER_KEY],
    };
  }
}

export function normalizeHeaderCoverRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (Number(value.schemaVersion) !== 1) return null;
  const dataUrl = String(value.dataUrl || "");
  const byteLength = webpDataUrlByteLength(dataUrl);
  const width = boundedInteger(value.width, 1, HEADER_COVER_MAX_DIMENSION);
  const height = boundedInteger(value.height, 1, HEADER_COVER_MAX_DIMENSION);
  if (!byteLength || !hasWebpSignature(dataUrl) || byteLength > HEADER_COVER_STORED_MAX_BYTES
    || Number(value.byteLength) !== byteLength || !width || !height) return null;
  const updatedAt = normalizedTimestamp(value.updatedAt);
  return {
    schemaVersion: 1,
    dataUrl,
    name: cleanName(value.name),
    mimeType: "image/webp",
    width,
    height,
    byteLength,
    updatedAt,
  };
}

export function webpDataUrlByteLength(value) {
  const dataUrl = String(value || "");
  if (!dataUrl.startsWith(WEBP_DATA_URL_PREFIX)) return 0;
  const base64 = dataUrl.slice(WEBP_DATA_URL_PREFIX.length);
  if (!base64 || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return 0;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return base64.length * 3 / 4 - padding;
}

export function nextHeaderCoverDimensions(width, height) {
  const currentWidth = Math.max(1, Math.round(Number(width) || 0));
  const currentHeight = Math.max(1, Math.round(Number(height) || 0));
  const longEdge = Math.max(currentWidth, currentHeight);
  if (longEdge <= HEADER_COVER_MIN_LONG_EDGE) return { width: currentWidth, height: currentHeight };
  const nextLongEdge = Math.max(HEADER_COVER_MIN_LONG_EDGE, Math.floor(longEdge * HEADER_COVER_RESIZE_FACTOR));
  const scale = nextLongEdge / longEdge;
  return {
    width: Math.max(1, Math.round(currentWidth * scale)),
    height: Math.max(1, Math.round(currentHeight * scale)),
  };
}

function headerCoverError(code, cause) {
  const messageKeys = {
    HEADER_COVER_INVALID: "background.error.headerCoverInvalid",
    HEADER_COVER_STORAGE_FAILED: "background.error.headerCoverStorage",
  };
  const error = new Error(code);
  error.name = "HeaderCoverError";
  error.code = code;
  error.messageKey = messageKeys[code] || messageKeys.HEADER_COVER_INVALID;
  error.messageParams = {};
  error.retryable = false;
  if (cause) error.cause = cause;
  return error;
}

function hasWebpSignature(dataUrl) {
  try {
    const header = atob(dataUrl.slice(WEBP_DATA_URL_PREFIX.length, WEBP_DATA_URL_PREFIX.length + 16));
    return header.length >= 12 && header.slice(0, 4) === "RIFF" && header.slice(8, 12) === "WEBP";
  } catch {
    return false;
  }
}

function boundedInteger(value, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) return 0;
  return number;
}

function cleanName(value) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160) || "cover.webp";
}

function normalizedTimestamp(value) {
  const date = new Date(String(value || ""));
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date(0).toISOString();
}

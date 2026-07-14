import { normalizeOriginPattern } from "../../extension/core/permission-state.mjs";

const BROAD_ORIGIN_PATTERNS = new Set(["https://*/*", "http://*/*", "*://*/*"]);

export function permissionRowCounts(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  const requiredRows = list.filter(isRequiredPermission);
  const granted = requiredRows.filter((row) => row.granted === true).length;
  return {
    required: requiredRows.length,
    granted,
    pending: requiredRows.length - granted,
    legacy: list.filter((row) => row?.legacy === true).length,
    broadRequired: list.filter((row) => row?.coversRequired === true).length,
  };
}

export function requiredUngrantedOrigins(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => isRequiredPermission(row) && row.granted !== true)
    .map((row) => row.origin)
    .filter(Boolean);
}

export function newlyRequiredUngrantedOrigins(rows = [], previousRows = []) {
  const previousRequired = new Set((Array.isArray(previousRows) ? previousRows : [])
    .filter(isRequiredPermission)
    .map((row) => normalizeOriginPattern(row?.origin))
    .filter(Boolean));
  return requiredUngrantedOrigins(rows)
    .map(normalizeOriginPattern)
    .filter((origin) => origin && !previousRequired.has(origin));
}

export function exactPermissionOrigins(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(normalizeOriginPattern)
    .filter((origin) => origin && !BROAD_ORIGIN_PATTERNS.has(origin)))];
}

export function isRequiredPermission(row) {
  return row?.required !== false && row?.legacy !== true;
}

import { normalizeOriginPattern } from "../../extension/core/permission-state.mjs";

export function permissionRowCounts(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  const granted = list.filter((row) => row?.granted === true).length;
  return {
    required: list.length,
    granted,
    pending: list.length - granted,
  };
}

export function requiredUngrantedOrigins(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row?.granted !== true)
    .map((row) => row.origin)
    .filter(Boolean);
}

export function newlyRequiredUngrantedOrigins(rows = [], previousRows = []) {
  const previousRequired = new Set((Array.isArray(previousRows) ? previousRows : [])
    .map((row) => normalizeOriginPattern(row?.origin))
    .filter(Boolean));
  return requiredUngrantedOrigins(rows)
    .map(normalizeOriginPattern)
    .filter((origin) => origin && !previousRequired.has(origin));
}

export function exactPermissionOrigins(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(normalizeOriginPattern)
    .filter(Boolean))];
}

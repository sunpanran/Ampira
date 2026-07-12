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

export function isRequiredPermission(row) {
  return row?.required !== false && row?.legacy !== true;
}

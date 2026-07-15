export function containsOrigins(origins) {
  const requested = cleanStrings(origins);
  if (!requested.length || !globalThis.chrome?.permissions?.contains) return Promise.resolve(false);
  return chrome.permissions.contains({ origins: requested });
}

export function requestOrigins(origins) {
  const requested = cleanStrings(origins);
  if (!requested.length || !globalThis.chrome?.permissions?.request) return Promise.resolve(false);
  return chrome.permissions.request({ origins: requested });
}

export function removeOrigins(origins) {
  const requested = cleanStrings(origins);
  if (!requested.length || !globalThis.chrome?.permissions?.remove) return Promise.resolve(false);
  return chrome.permissions.remove({ origins: requested });
}

export function containsPermissions(permissions) {
  const requested = cleanStrings(permissions);
  if (!requested.length || !globalThis.chrome?.permissions?.contains) return Promise.resolve(false);
  return chrome.permissions.contains({ permissions: requested });
}

export function requestPermissions(permissions) {
  const requested = cleanStrings(permissions);
  if (!requested.length || !globalThis.chrome?.permissions?.request) return Promise.resolve(false);
  return chrome.permissions.request({ permissions: requested });
}

export function removePermissions(permissions) {
  const requested = cleanStrings(permissions);
  if (!requested.length || !globalThis.chrome?.permissions?.remove) return Promise.resolve(false);
  return chrome.permissions.remove({ permissions: requested });
}

export function requestPermissionDetails({ origins = [], permissions = [] } = {}) {
  const details = {};
  const cleanOrigins = cleanStrings(origins);
  const cleanPermissions = cleanStrings(permissions);
  if (cleanOrigins.length) details.origins = cleanOrigins;
  if (cleanPermissions.length) details.permissions = cleanPermissions;
  if (!Object.keys(details).length || !globalThis.chrome?.permissions?.request) return Promise.resolve(false);
  return chrome.permissions.request(details);
}

function cleanStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))];
}

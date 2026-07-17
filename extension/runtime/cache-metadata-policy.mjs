export function createCacheMetadataPolicy({ safeOrigin, originPattern, buildPermissionRows }) {
  function withFeedCacheMetadata(value, items, capability, providerUrl = "") {
    const identities = new Map();
    for (const item of Array.isArray(items) ? items : []) {
      const sourceKey = String(item?.sourceKey || "");
      const sourceOrigin = safeOrigin(item?.sourceOrigin || "");
      const fetchOrigin = safeOrigin(item?.fetchOrigin || item?.sourceOrigin || "");
      if (!sourceKey || !sourceOrigin) continue;
      identities.set(`${sourceKey}|${sourceOrigin}|${fetchOrigin}`, { sourceKey, sourceOrigin, fetchOrigin });
    }
    const result = { ...value, capability, sourceIdentities: [...identities.values()] };
    if (providerUrl) result.providerOrigin = safeOrigin(providerUrl);
    return result;
  }

  function cacheSourceIdentitiesPermitted(value, permissionState, requireMetadata = false) {
    if (!Array.isArray(value?.sourceIdentities)) return !requireMetadata;
    return value.sourceIdentities.every((identity) => {
      const expected = permissionState.permittedByKey.get(String(identity?.sourceKey || ""));
      if (!expected || expected !== originPattern(identity?.sourceOrigin || "")) return false;
      const fetchPattern = originPattern(identity?.fetchOrigin || identity?.sourceOrigin || "");
      if (!fetchPattern) return false;
      return buildPermissionRows([fetchPattern], permissionState.grantedOrigins)
        .some((row) => row.granted);
    });
  }

  return { withFeedCacheMetadata, cacheSourceIdentitiesPermitted };
}

export function createAiAccessPolicy(options) {
  const {
    readProviderProfile, readDeviceConsent, originPattern, cacheMutations,
    uniqueStrings, normalizeUserUrl, cacheSourceIdentitiesPermitted, hasOriginPermissions,
    providerCredentialAvailable,
  } = options;

  async function currentProviderCapability(settings) {
    const provider = await readProviderProfile(settings);
    const consent = await readDeviceConsent(provider.openaiBaseUrl);
    return {
      provider,
      configured: consent.aiDisclosureAccepted === true
        && providerCredentialAvailable(provider.openaiBaseUrl, provider.openaiApiKey)
        && Boolean(String(provider.openaiSummaryModel || "").trim())
        && provider.openaiBaseUrl === settings.openaiBaseUrl
        && provider.openaiApiStyle === settings.openaiApiStyle
        && provider.openaiSummaryModel === settings.openaiSummaryModel
        && provider.credentialGeneration === settings.credentialGeneration,
    };
  }

  async function aiSearchResultPermitted(
    result,
    asUrl,
    settings,
    feedPermissions = null,
    expectedEpoch = null,
    providerCapability = null,
  ) {
    if (!result?.usedAi || !result.providerOrigin) return false;
    const capability = providerCapability || await currentProviderCapability(settings);
    const { provider } = capability;
    const providerMatches = capability.configured
      && originPattern(result.providerOrigin) === originPattern(provider.openaiBaseUrl);
    if (!providerMatches || expectedEpoch !== null && !cacheMutations.isCurrent(expectedEpoch)) return false;

    const requiredOrigins = [provider.openaiBaseUrl];
    if (asUrl) {
      const rawUrls = uniqueStrings([asUrl, result.requestedUrl, ...(result.links || []).map((link) => link?.url)].filter(Boolean));
      const normalized = rawUrls.map(normalizeUserUrl);
      if (normalized.some((url) => !url)) return false;
      requiredOrigins.push(...normalized);
    } else {
      if (!feedPermissions || !cacheSourceIdentitiesPermitted(result, feedPermissions, true)) return false;
      requiredOrigins.push(...result.sourceIdentities.flatMap((identity) => [identity.sourceOrigin, identity.fetchOrigin]).filter(Boolean));
    }
    const granted = await hasOriginPermissions(requiredOrigins);
    return granted && (expectedEpoch === null || cacheMutations.isCurrent(expectedEpoch));
  }

  return { currentProviderCapability, aiSearchResultPermitted };
}

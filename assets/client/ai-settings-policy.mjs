export const AI_SETUP_STAGE = Object.freeze({
  INVALID_ORIGIN: "invalid-origin",
  NEEDS_CONSENT: "needs-consent",
  NEEDS_PERMISSION: "needs-permission",
  READY: "ready",
});

export function aiProviderOrigin(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (url.href.length > 2048 || url.username || url.password || url.search || url.hash) return "";
    if (url.protocol === "https:") return url.origin;
    if (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)) return url.origin;
  } catch {
    // Invalid provider URLs stay locked until the user corrects them.
  }
  return "";
}

export function aiProviderOriginPattern(value) {
  const origin = aiProviderOrigin(value);
  return origin ? `${origin}/*` : "";
}

export function deriveAiSetupControlState({
  providerUrl = "",
  consentAccepted = false,
  permissionGranted = false,
  busy = false,
  grantPending = false,
} = {}) {
  const origin = aiProviderOrigin(providerUrl);
  const originPattern = origin ? `${origin}/*` : "";
  const stage = !origin
    ? AI_SETUP_STAGE.INVALID_ORIGIN
    : (!consentAccepted
      ? AI_SETUP_STAGE.NEEDS_CONSENT
      : (!permissionGranted ? AI_SETUP_STAGE.NEEDS_PERMISSION : AI_SETUP_STAGE.READY));
  const formUnlocked = stage === AI_SETUP_STAGE.READY;

  return {
    stage,
    origin,
    originPattern,
    formUnlocked,
    providerUrlDisabled: busy || grantPending,
    consentDisabled: busy || grantPending,
    grantDisabled: busy || grantPending || !origin || stage === AI_SETUP_STAGE.READY,
    protectedFieldsDisabled: busy || !formUnlocked,
  };
}

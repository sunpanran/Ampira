import { providerOrigin } from "./settings.mjs";

export function providerTestConsentAllowed({
  payloadHasConsent = false,
  payloadAccepted = false,
  savedAccepted = false,
  draftBaseUrl = "",
  savedBaseUrl = "",
} = {}) {
  const sameOrigin = providerOrigin(draftBaseUrl) === providerOrigin(savedBaseUrl);
  if (payloadHasConsent) return payloadAccepted === true;
  return savedAccepted === true && sameOrigin;
}

export function bindProviderPatchToOrigin(patch = {}, currentProvider = {}) {
  const next = { ...patch };
  if (!Object.hasOwn(next, "openaiBaseUrl")) return next;
  const originChanged = providerOrigin(next.openaiBaseUrl) !== providerOrigin(currentProvider.openaiBaseUrl);
  if (originChanged && !Object.hasOwn(next, "openaiApiKey")) next.openaiApiKey = "";
  return next;
}

export function providerTestApiKey({
  draftKey = "",
  storedKey = "",
  draftBaseUrl = "",
  storedBaseUrl = "",
} = {}) {
  const explicit = String(draftKey || "").trim();
  if (explicit) return explicit;
  if (providerOrigin(draftBaseUrl) !== providerOrigin(storedBaseUrl)) return "";
  return String(storedKey || "").trim();
}

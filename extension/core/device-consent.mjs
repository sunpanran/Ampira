import { CONSENT_VERSION, LOCAL_DEVICE_CONSENT_KEY } from "./constants.mjs";
import { providerOrigin } from "./settings.mjs";

let mutationQueue = Promise.resolve();

export function readDeviceConsent(openaiBaseUrl) {
  return enqueue(async () => {
    const stored = await chrome.storage.local.get(LOCAL_DEVICE_CONSENT_KEY);
    return consentStatus(stored[LOCAL_DEVICE_CONSENT_KEY], openaiBaseUrl);
  });
}

export function grantBookmarkConsent() {
  return updateConsent((current) => ({
    ...current,
    bookmark: { version: CONSENT_VERSION, granted: true },
  }));
}

export function markOnboardingComplete() {
  return updateConsent((current) => ({
    ...current,
    bookmark: { version: CONSENT_VERSION, granted: true },
    onboarding: { version: CONSENT_VERSION, completed: true },
  }));
}

export function setAiDisclosureConsent(accepted, openaiBaseUrl) {
  return updateConsent((current) => ({
    ...current,
    aiDisclosure: accepted === true
      ? { version: CONSENT_VERSION, accepted: true, providerOrigin: providerOrigin(openaiBaseUrl) }
      : { version: 0, accepted: false, providerOrigin: "" },
  }));
}

export function captureDeviceConsentState() {
  return enqueue(async () => {
    const stored = await chrome.storage.local.get(LOCAL_DEVICE_CONSENT_KEY);
    return {
      exists: Object.hasOwn(stored, LOCAL_DEVICE_CONSENT_KEY),
      value: stored[LOCAL_DEVICE_CONSENT_KEY],
    };
  });
}

export function restoreDeviceConsentState(snapshot) {
  return enqueue(async () => {
    if (snapshot?.exists) await chrome.storage.local.set({ [LOCAL_DEVICE_CONSENT_KEY]: snapshot.value });
    else await chrome.storage.local.remove(LOCAL_DEVICE_CONSENT_KEY);
  });
}

function updateConsent(action) {
  return enqueue(async () => {
    const stored = await chrome.storage.local.get(LOCAL_DEVICE_CONSENT_KEY);
    const current = normalizeConsentRecord(stored[LOCAL_DEVICE_CONSENT_KEY]);
    const next = normalizeConsentRecord(action(current));
    await chrome.storage.local.set({ [LOCAL_DEVICE_CONSENT_KEY]: next });
    return next;
  });
}

function consentStatus(value, openaiBaseUrl) {
  const record = normalizeConsentRecord(value);
  const bookmarkConsentGranted = record.bookmark.version === CONSENT_VERSION
    && record.bookmark.granted === true;
  const onboardingCompleted = bookmarkConsentGranted
    && record.onboarding.version === CONSENT_VERSION
    && record.onboarding.completed === true;
  const aiDisclosureAccepted = record.aiDisclosure.version === CONSENT_VERSION
    && record.aiDisclosure.accepted === true
    && record.aiDisclosure.providerOrigin === providerOrigin(openaiBaseUrl);
  return {
    consentVersion: bookmarkConsentGranted || onboardingCompleted || aiDisclosureAccepted ? CONSENT_VERSION : 0,
    bookmarkConsentGranted,
    onboardingCompleted,
    aiDisclosureAccepted,
  };
}

function normalizeConsentRecord(value = {}) {
  return {
    schemaVersion: 1,
    bookmark: {
      version: boundedVersion(value?.bookmark?.version),
      granted: value?.bookmark?.granted === true,
    },
    onboarding: {
      version: boundedVersion(value?.onboarding?.version),
      completed: value?.onboarding?.completed === true,
    },
    aiDisclosure: {
      version: boundedVersion(value?.aiDisclosure?.version),
      accepted: value?.aiDisclosure?.accepted === true,
      providerOrigin: normalizeStoredOrigin(value?.aiDisclosure?.providerOrigin),
    },
  };
}

function normalizeStoredOrigin(value) {
  try {
    return new URL(String(value || "").trim()).origin;
  } catch {
    return "";
  }
}

function boundedVersion(value) {
  const version = Number(value);
  return Number.isInteger(version) && version >= 0 && version <= 100 ? version : 0;
}

function enqueue(action) {
  const operation = mutationQueue.then(action);
  mutationQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

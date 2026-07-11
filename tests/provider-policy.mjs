import assert from "node:assert/strict";
import {
  bindProviderPatchToOrigin,
  providerTestApiKey,
  providerTestConsentAllowed,
} from "../extension/core/provider-policy.mjs";

assert.equal(providerTestConsentAllowed({
  payloadHasConsent: true,
  payloadAccepted: false,
  savedAccepted: true,
  draftBaseUrl: "https://api.example.com/v1",
  savedBaseUrl: "https://api.example.com/v1",
}), false, "an explicit unchecked draft must override saved consent");

assert.equal(providerTestConsentAllowed({
  payloadHasConsent: true,
  payloadAccepted: true,
  savedAccepted: true,
  draftBaseUrl: "https://other.example.com/v1",
  savedBaseUrl: "https://api.example.com/v1",
}), true, "an explicit affirmative payload must represent the user's renewed consent for a draft origin");

assert.equal(providerTestConsentAllowed({
  payloadHasConsent: false,
  savedAccepted: true,
  draftBaseUrl: "https://other.example.com/v1",
  savedBaseUrl: "https://api.example.com/v1",
}), false, "saved consent must not silently carry when the payload omits consent for a different origin");

assert.equal(providerTestConsentAllowed({
  payloadHasConsent: true,
  payloadAccepted: true,
  savedAccepted: false,
  draftBaseUrl: "https://other.example.com/v1",
  savedBaseUrl: "https://api.example.com/v1",
}), true, "a fresh affirmative consent may test an unsaved provider");

assert.equal(providerTestApiKey({
  storedKey: "saved-secret",
  draftBaseUrl: "https://other.example.com/v1",
  storedBaseUrl: "https://api.example.com/v1",
}), "", "a saved key must not be reused on another origin");

assert.equal(providerTestApiKey({
  storedKey: "saved-secret",
  draftBaseUrl: "https://api.example.com/other-path",
  storedBaseUrl: "https://api.example.com/v1",
}), "saved-secret", "the saved key may be reused on the same origin");

assert.equal(providerTestApiKey({
  draftKey: "new-secret",
  storedKey: "saved-secret",
  draftBaseUrl: "https://other.example.com/v1",
  storedBaseUrl: "https://api.example.com/v1",
}), "new-secret", "an explicitly entered draft key may test another origin");

assert.deepEqual(bindProviderPatchToOrigin({
  openaiBaseUrl: "https://other.example.com/v1",
}, {
  openaiBaseUrl: "https://api.example.com/v1",
  openaiApiKey: "saved-secret",
}), {
  openaiBaseUrl: "https://other.example.com/v1",
  openaiApiKey: "",
}, "saving a different origin without a new key must clear the old provider credential");

assert.deepEqual(bindProviderPatchToOrigin({
  openaiBaseUrl: "https://api.example.com/other-path",
}, {
  openaiBaseUrl: "https://api.example.com/v1",
  openaiApiKey: "saved-secret",
}), {
  openaiBaseUrl: "https://api.example.com/other-path",
}, "a same-origin path change may preserve the existing key");

assert.deepEqual(bindProviderPatchToOrigin({
  openaiBaseUrl: "https://other.example.com/v1",
  openaiApiKey: "new-secret",
}, {
  openaiBaseUrl: "https://api.example.com/v1",
  openaiApiKey: "saved-secret",
}), {
  openaiBaseUrl: "https://other.example.com/v1",
  openaiApiKey: "new-secret",
}, "an explicit new credential must remain bound to the new origin");

console.log("provider policy tests passed");

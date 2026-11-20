import assert from "node:assert/strict";
import { authorizeSettingsImport } from "../../assets/client/settings-import-authorization.mjs";

const oldChrome = globalThis.chrome;
try {
  for (const outcome of ["grant", "cancel", "deny", "throw", "reject", "stale", "not-applied"]) {
    const h = harness({ outcome, provider: true, bookmarks: true });
    const result = await h.run();
    const expected = { grant: "ready", cancel: "cancelled", deny: "pending", throw: "failed", reject: "failed", stale: "cancelled", "not-applied": "pending" }[outcome];
    assert.equal(result.status, expected, outcome);
    if (outcome === "grant") {
      assert.equal(result.settings.automaticAiStarted, true);
      assert(h.settings.aiDisclosureAccepted && h.settings.bookmarkConsentGranted);
      assert.equal(h.requests.length, 1);
    } else assert.equal(h.mutations.length, 0, "failed or cancelled browser access cannot grant device consent");
  }

  for (const needsConsent of [true, false]) {
    const domains = Array.from({ length: 127 }, (_, i) => `https://bookmark-${i}.example/*`);
    const h = harness({ bookmarks: needsConsent, origins: [], permissions: [], discover: domains });
    h.settings.bookmarkConsentGranted = !needsConsent;
    const result = await h.run();
    assert.equal(result.status, "ready");
    assert(domains.every(origin => h.origins.has(origin)));
    assert.equal(h.requests.length, 1, "all newly discovered domains are requested in a single batch");
  }

  for (const cancelLast of [false, true]) {
    const h = harness({ bookmarks: true, discover: ["https://discovered.example/*"], permissions: ["favicon"],
      onConfirm(round) {
        if (round === 2) { h.origins.delete("https://exported.example/*"); h.permissions.delete("favicon"); }
        if (round === 3 && cancelLast) return false;
      },
    });
    const result = await h.run();
    assert.equal(h.confirmations, 3, "revoked earlier grants must be detected after the second round");
    assert.equal(result.status, cancelLast ? "cancelled" : "ready");
    assert.equal(h.permissions.has("favicon"), !cancelLast);
    assert.equal(h.origins.has("https://exported.example/*"), !cancelLast);
  }

  const existing = harness({ provider: true, bookmarks: true });
  existing.authorization.origins.forEach(origin => existing.origins.add(origin));
  existing.authorization.permissions.forEach(value => existing.permissions.add(value));
  existing.settings.aiDisclosureAccepted = existing.settings.bookmarkConsentGranted = true;
  assert.equal((await existing.run()).status, "ready");
  assert.equal(existing.confirmations, 0, "existing permissions and consent need no redundant prompt");
  assert.equal(existing.requests.length, 0);

  const staleProvider = harness({ provider: true });
  staleProvider.settings.credentialGeneration++;
  assert.equal((await staleProvider.run()).status, "failed");
  assert.equal(staleProvider.confirmations, 0, "a changed provider cannot receive consent for the imported identity");

  const empty = harness({ origins: [], permissions: [] });
  assert.equal((await empty.run()).status, "ready");
  assert.equal(empty.confirmations, 0);
} finally { globalThis.chrome = oldChrome; }
console.log("settings import authorization lifecycle tests passed");

function harness({ outcome = "grant", provider = false, bookmarks = false,
  origins: requestedOrigins = ["https://exported.example/*"], permissions: requestedPermissions = ["favicon", "history", "search"],
  discover = [], onConfirm } = {}) {
  const h = { origins: new Set(), permissions: new Set(), requests: [], mutations: [], confirmations: 0, active: true };
  h.settings = { openaiBaseUrl: "https://ai.example/v1", openaiApiStyle: "responses", openaiSummaryModel: "synthetic-model",
    credentialGeneration: 3, aiDisclosureAccepted: false, bookmarkConsentGranted: false };
  h.authorization = { origins: [...requestedOrigins], permissions: [...requestedPermissions], bookmarkConsent: bookmarks,
    aiProvider: provider ? Object.fromEntries(["openaiBaseUrl", "openaiApiStyle", "openaiSummaryModel", "credentialGeneration"].map(field => [field, h.settings[field]])) : null };
  let inGesture = false;
  globalThis.chrome = { permissions: {
    request: details => {
      assert(inGesture, "browser permission request must execute inside the confirmation click");
      h.requests.push(structuredClone(details));
      if (outcome === "throw") throw new Error("synthetic synchronous failure");
      if (outcome === "reject") return Promise.reject(new Error("synthetic asynchronous failure"));
      if (!["deny", "not-applied"].includes(outcome)) {
        details.origins?.forEach(value => h.origins.add(value));
        details.permissions?.forEach(value => h.permissions.add(value));
      }
      return Promise.resolve(outcome !== "deny");
    },
    contains: async details => (details.origins || []).every(value => h.origins.has(value))
      && (details.permissions || []).every(value => h.permissions.has(value)),
  } };
  h.run = () => authorizeSettingsImport(h.authorization, {
    t: (key, params) => params?.origins || key, renderSettingsStatus() {},
    request: async message => {
      if (message.type === "settings:get") return { ...h.settings, sourcePermissions: h.settings.bookmarkConsentGranted
        ? discover.map(origin => ({ origin, granted: h.origins.has(origin) })) : [] };
      h.mutations.push(message.type);
      if (message.type === "onboarding:consent") h.settings.bookmarkConsentGranted = true;
      else if (message.type === "settings:authorize-import") h.settings.aiDisclosureAccepted = true;
      else assert.fail(message.type);
      return { ...h.settings, automaticAiStarted: message.type === "settings:authorize-import" };
    },
    confirmAction: async content => {
      h.confirmations++;
      if (outcome === "cancel" || onConfirm?.(h.confirmations) === false) return false;
      inGesture = true;
      content.onConfirmGesture();
      inGesture = false;
      if (outcome === "stale") h.active = false;
      return true;
    },
  }, () => h.active);
  return h;
}

import { exactPermissionOrigins } from "./permission-ui-model.mjs";
import { containsOrigins, containsPermissions, requestPermissionDetails } from "./permission-client.mjs";
import { supportsNativeFavicon } from "./urls.mjs";

const MAX_AUTHORIZATION_ROUNDS = 3;
const PROVIDER_FIELDS = ["openaiBaseUrl", "openaiApiStyle", "openaiSummaryModel", "credentialGeneration"];

export async function authorizeSettingsImport(authorization, options, isCurrent) {
  const { t, request, confirmAction, renderSettingsStatus } = options;
  const requiredOrigins = new Set(exactPermissionOrigins(authorization.origins));
  const requestedPermissions = [...new Set((authorization.permissions || []).filter(value => ["favicon", "search", "history"].includes(value)))];
  const requiredPermissions = requestedPermissions.filter(value => value !== "favicon" || supportsNativeFavicon());
  const unsupported = requiredPermissions.length !== requestedPermissions.length;
  let changed = false, automaticAiStarted = false, postCommit;
  const cancelled = () => ({ status: "cancelled", changed, unsupported });
  try {
    if (!isCurrent()) return cancelled();
    let pending = await inspect();
    for (let round = 0; round < MAX_AUTHORIZATION_ROUNDS; round++) {
      if (!isCurrent()) return cancelled();
      if (!needsAuthorization(pending)) return ready(pending.settings);
      let permissionRequest = Promise.resolve({ granted: false });
      const confirmed = await confirmAction({
        kicker: t("confirmation.import.kicker"), title: t("settings.transfer.authorize.title"),
        body: [
          t("settings.transfer.authorize.body"),
          pending.aiConsent ? t("settings.transfer.authorize.ai", { origin: new URL(authorization.aiProvider.openaiBaseUrl).origin }) : "",
          pending.bookmarkConsent ? t("settings.transfer.authorize.bookmarks") : "",
          ...pending.permissions.map(value => t("settings.transfer.authorize." + value)),
          unsupported ? t("settings.browser.faviconUnsupported") : "",
          pending.origins.length ? t("settings.transfer.authorize.sites", { origins: pending.origins.map(value => value.slice(0, -2)).join("\n") }) : "",
        ].filter(Boolean).join("\n\n"),
        multiline: true, cancelLabel: t("settings.transfer.authorize.later"), confirmLabel: t("settings.transfer.authorize.confirm"),
        onConfirmGesture() {
          // The browser call must stay in this synchronous click handler.
          try {
            const operation = pending.origins.length || pending.permissions.length
              ? requestPermissionDetails({ origins: pending.origins, permissions: pending.permissions }) : Promise.resolve(true);
            permissionRequest = operation.then(granted => ({ granted }), error => ({ error }));
          } catch (error) { permissionRequest = Promise.resolve({ error }); }
        },
      });
      if (!isCurrent() || !confirmed) return cancelled();
      renderSettingsStatus(t("permission.requesting"));
      const result = await permissionRequest;
      if (!isCurrent()) return cancelled();
      if (result.error) throw result.error;
      const granted = result.granted === true && (await Promise.all([
        pending.origins.length ? containsOrigins(pending.origins) : true,
        pending.permissions.length ? containsPermissions(pending.permissions) : true,
      ])).every(Boolean);
      if (!isCurrent()) return cancelled();
      if (!granted) return { status: "pending", changed, unsupported };
      if (pending.bookmarkConsent) await request({ type: "onboarding:consent" });
      if (!isCurrent()) return cancelled();
      if (pending.aiConsent) {
        const saved = await request({ type: "settings:authorize-import", payload: authorization.aiProvider });
        automaticAiStarted ||= saved.automaticAiStarted === true;
        postCommit = saved.postCommit;
      }
      changed = true;
      if (!isCurrent()) return cancelled();
      // Recheck the accumulated requirements, including earlier rounds and
      // exported domains that are absent from the current bookmark selection.
      pending = await inspect();
      if (!isCurrent()) return cancelled();
      if (!needsAuthorization(pending)) return ready(pending.settings);
    }
    return { status: "pending", changed, unsupported };
  } catch (error) {
    return isCurrent() ? { status: "failed", error, changed, unsupported } : cancelled();
  }

  async function inspect() {
    const settings = await request({ type: "settings:get" });
    const provider = authorization.aiProvider;
    if (provider && !PROVIDER_FIELDS.every(field => settings[field] === provider[field])) {
      throw Object.assign(new Error(t("background.error.aiConfigurationChanged")), { messageKey: "background.error.aiConfigurationChanged" });
    }
    const rows = settings.sourcePermissions || [];
    exactPermissionOrigins(rows.map(row => row.origin)).forEach(origin => requiredOrigins.add(origin));
    const allOrigins = [...requiredOrigins];
    const [originsGranted, namesGranted] = await Promise.all([
      allOrigins.length ? containsOrigins(allOrigins) : true,
      requiredPermissions.length ? containsPermissions(requiredPermissions) : true,
    ]);
    const origins = originsGranted ? [] : await missing(allOrigins, containsOrigins);
    const permissions = namesGranted ? [] : await missing(requiredPermissions, containsPermissions);
    const backendMissing = rows.filter(row => row.granted !== true).map(row => row.origin);
    return { settings, origins: exactPermissionOrigins([...origins, ...backendMissing]), permissions,
      bookmarkConsent: authorization.bookmarkConsent && settings.bookmarkConsentGranted !== true,
      aiConsent: Boolean(provider) && settings.aiDisclosureAccepted !== true };
  }

  function ready(settings) {
    return { status: "ready", changed, unsupported, settings: { ...settings, automaticAiStarted, ...(postCommit ? { postCommit } : {}) } };
  }
}

function needsAuthorization(pending) {
  return pending.origins.length || pending.permissions.length || pending.bookmarkConsent || pending.aiConsent;
}

async function missing(values, contains) {
  const granted = await Promise.all(values.map(value => contains([value])));
  return values.filter((_, index) => !granted[index]);
}

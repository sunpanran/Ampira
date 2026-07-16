import { DEFAULT_SETTINGS } from "../core/constants.mjs";
import { normalizeSettings } from "../core/settings.mjs";

export function createRuntimeSettingsService({ store, readProviderProfile, readDeviceConsent }) {
  async function getSettings() {
    const synced = await store.read();
    const provider = await readProviderProfile(synced);
    const consent = await readDeviceConsent(provider.openaiBaseUrl);
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      ...synced,
      openaiBaseUrl: provider.openaiBaseUrl,
      openaiApiStyle: provider.openaiApiStyle,
      openaiSummaryModel: provider.openaiSummaryModel,
      credentialGeneration: provider.credentialGeneration,
      ...consent,
    });
    return settings;
  }

  return {
    getSettings,
    mutate: (action) => store.mutate(action),
    sanitizeLocalOnlyFields: () => store.sanitizeLocalOnlyFields(),
  };
}

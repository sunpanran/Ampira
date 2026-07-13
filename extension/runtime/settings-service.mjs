import { DEFAULT_SETTINGS } from "../core/constants.mjs";
import { defaultBookmarkFoldersForLocale } from "../core/i18n.mjs";
import { normalizeSettings } from "../core/settings.mjs";
import { settingsLocale } from "./runtime-result.mjs";

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
    const defaults = defaultBookmarkFoldersForLocale(settingsLocale(settings));
    if (!settings.newsBookmarkFolder) settings.newsBookmarkFolder = defaults.news;
    if (!settings.inspirationBookmarkFolder) settings.inspirationBookmarkFolder = defaults.inspiration;
    return settings;
  }

  return {
    getSettings,
    mutate: (action) => store.mutate(action),
    sanitizeLegacySyncedCredentials: () => store.sanitizeLocalOnlyFields(),
  };
}

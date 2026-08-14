export function createImageSearchSettingsService(options) {
  const {
    getSettings,
    readSecrets,
    testImageSearchConnection,
    hasOriginPermission,
    resultMessage,
    errorResult,
  } = options;

  return { testImageSearchSettings };

  async function testImageSearchSettings(body = {}) {
    const settings = await getSettings();
    try {
      const secrets = await readSecrets();
      const apiKey = String(body.braveSearchApiKey || secrets.braveSearchApiKey || "").trim();
      const result = await testImageSearchConnection(apiKey, hasOriginPermission);
      return resultMessage(settings, true, "background.imageConnectionAvailable", { count: result.count });
    } catch (error) {
      return errorResult(settings, error);
    }
  }
}

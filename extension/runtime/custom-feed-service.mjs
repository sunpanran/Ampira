import { customFeedSource, normalizeCustomFeedUrl } from "../core/custom-feeds.mjs";
import { fetchFeedSubscription } from "../core/feed.mjs";
import { typedError } from "./runtime-result.mjs";

export function createCustomFeedService({ sourceFetchOptions, hasOriginPermission, permissionEpoch }) {
  return { preview };

  async function preview(payload = {}) {
    const url = normalizeCustomFeedUrl(payload.url);
    if (!url) throw typedError("INVALID_FEED_URL", "settings.feeds.invalidUrl");
    const epoch = permissionEpoch.capture();
    const result = await fetchFeedSubscription(customFeedSource({ url, title: new URL(url).hostname }), {
      ...sourceFetchOptions(3), preview: true,
    });
    if (!permissionEpoch.isCurrent(epoch) || !await hasOriginPermission(url)) {
      throw typedError("SOURCE_PERMISSION_CHANGED", "background.error.sourcePermission");
    }
    return {
      url,
      title: result.feedTitle || new URL(url).hostname,
      items: result.map(item => ({ title: item.title, url: item.url })),
    };
  }
}

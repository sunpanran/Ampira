import { ampiraSearchEntries, bookmarkSearchEntries, HISTORY_CANDIDATE_LIMIT, rankSearchEntries } from "../core/unified-search.mjs";

import { normalizeSearchQuery } from "../core/search.mjs";

export function createLocalSearchService({ chrome, getSettings, currentBookmarkTree, readDashboard, captureEpoch = () => 0 }) {
  let generation = 0;
  const invalidate = () => { generation += 1; };

  async function permission(name) {
    try { return await chrome.permissions.contains({ permissions: [name] }); }
    catch { return false; }
  }

  async function search(payload = {}, attempt = 0) {
    const version = generation;
    const epoch = captureEpoch();
    const query = normalizeSearchQuery(payload.query);
    const settings = await getSettings();
    const settingsFingerprint = JSON.stringify(settings);
    const [historyGranted, browserSearchEnabled] = await Promise.all([permission("history"), permission("search")]);
    const sources = {
      ampira: "ready",
      bookmark: settings.bookmarkConsentGranted ? "ready" : "consent",
      history: !historyGranted ? "permission" : chrome.history?.search ? "ready" : "unavailable",
    };
    if (!query) return { query, results: [], sources, browserSearchEnabled };
    const collect = async (source, read) => {
      if (sources[source] !== "ready") return [];
      try { return await read(); }
      catch { sources[source] = "error"; return []; }
    };
    const groups = await Promise.all([
      collect("ampira", async () => ampiraSearchEntries(await readDashboard())),
      collect("bookmark", async () => bookmarkSearchEntries(await currentBookmarkTree(settings))),
      collect("history", async () => (await chrome.history.search({ text: query, startTime: 0, maxResults: HISTORY_CANDIDATE_LIMIT }))
        .map(item => ({ title: item.title, url: item.url, lastVisitTime: item.lastVisitTime, sources: ["history"] }))),
    ]);
    const latest = await getSettings();
    if (historyGranted && !await permission("history")) {
      groups[2] = [];
      sources.history = "permission";
    }
    if (version !== generation || epoch !== captureEpoch() || settingsFingerprint !== JSON.stringify(latest)) {
      if (attempt === 0) return search(payload, 1);
      return { query, results: [], sources, browserSearchEnabled, stale: true };
    }
    return { query, results: rankSearchEntries(groups.flat(), query), sources, browserSearchEnabled };
  }

  return { search, invalidate };
}

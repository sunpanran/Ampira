import { CACHE_LIMIT_BYTES, CACHE_RETENTION_MS } from "./constants.mjs";

export const HEADER_COVER_CACHE_NAME = "ampira-header-cover-v1";
export const HEADER_COVER_CACHE_KEY = "header-cover:network";
export const HEADER_COVER_CACHE_PATH = "/_header-cover";

export function normalizeNetworkHeaderCoverUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (url.username || url.password) return "";
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) return "";
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

// Response bodies stay opaque when the image host does not allow CORS. Keep
// those bodies in the browser's CacheStorage and account for their actual
// storage usage (including opaque-response padding) in the shared cache budget.
export function createHeaderCoverCache({
  getRecord, setRecord, deleteRecord,
  storage = globalThis.caches,
  estimate = () => globalThis.navigator.storage.estimate(),
  fetchImage = (url) => fetch(url, {
    mode: "no-cors", credentials: "omit", referrerPolicy: "no-referrer",
    signal: AbortSignal.timeout(15000),
  }),
  now = () => Date.now(),
}) {
  let generation = 0;
  let latestUrl = "";
  let mutations = Promise.resolve();
  const pending = new Map();
  return { load, clear, reject, prune };

  function mutate(operation) {
    const task = mutations.then(operation);
    mutations = task.catch(() => {});
    return task;
  }

  function valid(record) {
    return record?.url && Number.isFinite(record.cachedAt)
      && record.cachedAt >= now() - CACHE_RETENTION_MS;
  }

  async function load(value) {
    const url = normalizeNetworkHeaderCoverUrl(value);
    if (!url) throw new TypeError("Invalid header image URL");
    if (latestUrl !== url) { latestUrl = url; generation += 1; }
    if (!pending.has(url)) {
      const expectedGeneration = generation;
      const task = readOrFetch(url, expectedGeneration).finally(() => {
        if (pending.get(url) === task) pending.delete(url);
      });
      pending.set(url, task);
    }
    return (await pending.get(url)).clone();
  }

  async function readOrFetch(url, expectedGeneration) {
    try {
      await mutations;
      const record = await getRecord(HEADER_COVER_CACHE_KEY);
      if (valid(record) && record.url === url) {
        const cached = await (await storage.open(HEADER_COVER_CACHE_NAME)).match(url);
        if (cached) return cached;
      }
    } catch {
      // Unavailable storage must not prevent the image from being displayed.
    }
    const response = await fetchImage(url);
    if (response.type !== "opaque" && !response.ok) return response;
    await mutate(async () => {
      if (generation !== expectedGeneration) return;
      try {
        const cache = await storage.open(HEADER_COVER_CACHE_NAME);
        // A single cover bounds retained opaque bodies, including after a crash.
        for (const request of await cache.keys()) await cache.delete(request);
        await cache.put(url, response.clone());
        const bytes = Number((await estimate())?.usageDetails?.caches);
        if (!Number.isFinite(bytes) || bytes <= 0 || bytes > CACHE_LIMIT_BYTES || generation !== expectedGeneration) {
          await storage.delete(HEADER_COVER_CACHE_NAME);
          await deleteRecord(HEADER_COVER_CACHE_KEY);
          return;
        }
        await setRecord(HEADER_COVER_CACHE_KEY, { url, cachedAt: now() }, "cache", bytes);
        // Other cache entries may have consumed the shared budget during put.
        const record = await getRecord(HEADER_COVER_CACHE_KEY);
        if (record?.url !== url || generation !== expectedGeneration) await storage.delete(HEADER_COVER_CACHE_NAME);
      } catch {
        await storage?.delete?.(HEADER_COVER_CACHE_NAME).catch(() => {});
        await deleteRecord(HEADER_COVER_CACHE_KEY).catch(() => {});
      }
    });
    return response;
  }

  function clear() {
    generation += 1;
    latestUrl = "";
    pending.clear();
    return mutate(async () => {
      await storage.delete(HEADER_COVER_CACHE_NAME);
      await deleteRecord(HEADER_COVER_CACHE_KEY);
    });
  }

  function reject(value) {
    const url = normalizeNetworkHeaderCoverUrl(value);
    if (!url) return Promise.resolve();
    if (latestUrl === url) { generation += 1; pending.delete(url); }
    return mutate(async () => {
      if ((await getRecord(HEADER_COVER_CACHE_KEY))?.url !== url) return;
      await storage.delete(HEADER_COVER_CACHE_NAME);
      await deleteRecord(HEADER_COVER_CACHE_KEY);
    });
  }

  function prune() {
    return mutate(async () => {
      const record = await getRecord(HEADER_COVER_CACHE_KEY);
      if (!valid(record) || !await (await storage.open(HEADER_COVER_CACHE_NAME)).match(record.url)) {
        await storage.delete(HEADER_COVER_CACHE_NAME);
        await deleteRecord(HEADER_COVER_CACHE_KEY);
      }
    });
  }
}

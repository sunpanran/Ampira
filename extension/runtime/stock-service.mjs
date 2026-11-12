import { decodeResponseBuffer, fetchBounded } from "../core/network.mjs";
import { STOCK_CACHE_KEY, STOCK_FRESH_MS, STOCK_ORIGIN, STOCK_STALE_MS, normalizeStockWatchlist, parseStockQuotes } from "../core/stocks.mjs";

export function createStockService({ hasOriginPermissions, getRecord, setRecord, typedError, cacheMutations,
  permissionEpoch, now = Date.now, fetchResponse = fetchBounded }) {
  const pending = new Map();
  return { getQuotes, stockCachePermitted: () => hasOriginPermissions([STOCK_ORIGIN]) };

  async function getQuotes(payload = {}) {
    const symbols = normalizeStockWatchlist(payload.symbols);
    if (!symbols.length) throw typedError("INVALID_STOCK_SYMBOLS", "background.error.stockSymbols", {}, false);
    const permissionToken = permissionEpoch.capture(), cacheToken = cacheMutations.capture();
    await assertCurrent();
    const fingerprint = symbols.join(",");
    const key = `${permissionToken}:${cacheToken}:${fingerprint}`;
    if (pending.has(key)) return pending.get(key);
    if (pending.size >= 8) throw typedError("STOCK_BUSY", "background.error.stockUnavailable", {}, true);
    const operation = load().finally(() => pending.delete(key));
    pending.set(key, operation);
    return operation;

    async function assertCurrent() {
      if (!await hasOriginPermissions([STOCK_ORIGIN]) || !permissionEpoch.isCurrent(permissionToken)) {
        throw typedError("STOCK_PERMISSION_REQUIRED", "background.error.stockPermission", {}, false);
      }
      if (!cacheMutations.isCurrent(cacheToken)) throw typedError("STOCK_INVALIDATED", "background.error.stockUnavailable", {}, true);
    }

    async function load() {
      const cached = await getRecord(STOCK_CACHE_KEY, null);
      const age = cached?.fingerprint === fingerprint ? now() - Date.parse(cached.fetchedAt) : Infinity;
      await assertCurrent();
      if (age >= 0 && age < (payload.force === true ? 10_000 : STOCK_FRESH_MS)) return publicQuotes(cached, false);
      try {
        const url = `${STOCK_ORIGIN}/q=${fingerprint}`;
        const { response, buffer } = await fetchResponse(url, {
          credentials: "omit", redirect: "error", referrerPolicy: "no-referrer", cache: "no-store",
        }, { timeoutMs: 8000, maxBytes: 128 * 1024,
          validateResponse(result) {
            if (!result.ok || new URL(result.url || url).origin !== STOCK_ORIGIN) {
              throw typedError("STOCK_HTTP_ERROR", "background.error.stockUnavailable", {}, true);
            }
          },
        });
        await assertCurrent();
        const text = decodeResponseBuffer(buffer, response.headers.get("content-type") || "text/plain; charset=GBK");
        if (!/^v_[a-zA-Z0-9_.-]+="[^"\r\n]*";?\s*$/m.test(text)) {
          throw typedError("INVALID_STOCK_RESPONSE", "background.error.stockData", {}, true);
        }
        const record = { capability: "stocks", providerOrigins: [STOCK_ORIGIN], fingerprint,
          fetchedAt: new Date(now()).toISOString(), ...parseStockQuotes(text, symbols) };
        await cacheMutations.run(async (isCurrent) => {
          await assertCurrent();
          if (isCurrent()) await setRecord(STOCK_CACHE_KEY, record, "cache");
        }, cacheToken);
        await assertCurrent();
        return publicQuotes(record, false);
      } catch (error) {
        await assertCurrent();
        if (age >= 0 && age <= STOCK_STALE_MS && cached?.quotes?.length) return publicQuotes(cached, true);
        if (error?.messageKey) throw error;
        throw typedError("STOCK_NETWORK_ERROR", "background.error.stockUnavailable", {}, true);
      }
    }
  }
}

function publicQuotes(record, stale) {
  return { quotes: record.quotes, missingSymbols: record.missingSymbols, fetchedAt: record.fetchedAt, stale };
}

import { STOCK_FRESH_MS, STOCK_WATCHLIST_KEY, normalizeStockWatchlist } from "../../extension/core/stocks.mjs";
import { readJson } from "./storage.mjs";

export function createStockCardState({ request, localizedErrorMessage, notify, writeJson, initialSymbols = readJson(STOCK_WATCHLIST_KEY, []) }) {
  let symbols = normalizeStockWatchlist(initialSymbols);
  let generation = 0, result = null, error = null, pending = null, attemptedAt = 0;
  function read() { return { symbols: [...symbols], result, error, busy: Boolean(pending) }; }
  function invalidate() {
    generation += 1; result = null; error = null; pending = null; attemptedAt = 0;
    notify();
  }
  function ensure({ force = false } = {}) {
    if (pending) return pending;
    if (!symbols.length || !force && (error || attemptedAt && Date.now() - attemptedAt < STOCK_FRESH_MS)) return Promise.resolve();
    const token = generation;
    const requested = [...symbols];
    attemptedAt = Date.now(); error = null;
    pending = Promise.resolve().then(() => request({ type: "stocks:get", payload: { symbols: requested, force } })).then(value => {
      if (token === generation) result = value;
    }).catch(cause => {
      if (token !== generation) return;
      if (cause?.code === "STOCK_PERMISSION_REQUIRED") result = null;
      error = { code: cause?.code || "", message: localizedErrorMessage(cause) };
    }).finally(() => {
      if (token !== generation) return;
      pending = null; notify();
    });
    notify();
    return pending;
  }
  return { read, ensure, invalidate,
    syncFromStorage() {
      const next = normalizeStockWatchlist(readJson(STOCK_WATCHLIST_KEY, []));
      if (JSON.stringify(next) === JSON.stringify(symbols)) return;
      symbols = next; invalidate();
    },
    update(next) { symbols = normalizeStockWatchlist(next); writeJson(STOCK_WATCHLIST_KEY, symbols); invalidate(); },
    setError(value) { error = value; notify(); },
  };
}

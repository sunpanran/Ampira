import { STOCK_FRESH_MS, STOCK_WATCHLIST_KEY, normalizeStockWatchlist } from "../../extension/core/stocks.mjs";
import { normalizeLocale } from "../../extension/core/locale.mjs";
import { readJson } from "./storage.mjs";

const DEFAULT_STOCK_SYMBOLS = Object.freeze({
  "zh-CN": Object.freeze(["sh600519", "hk00700", "sz002594"]),
  en: Object.freeze(["usAAPL", "usMSFT", "usNVDA"]),
});

export function createStockCardState({ request, getLocale = () => "zh-CN", localizedErrorMessage, notify, writeJson, initialSymbols = readJson(STOCK_WATCHLIST_KEY, null) }) {
  let selectedSymbols = initialSymbols;
  const currentSymbols = () => normalizeStockWatchlist(selectedSymbols ?? DEFAULT_STOCK_SYMBOLS[normalizeLocale(getLocale()) === "en" ? "en" : "zh-CN"]);
  let symbols = currentSymbols();
  let generation = 0, result = null, error = null, pending = null, attemptedAt = 0;
  function read() { syncSymbols(); return { symbols: [...symbols], result, error, busy: Boolean(pending) }; }
  function reset() {
    generation += 1; result = null; error = null; pending = null; attemptedAt = 0;
  }
  function invalidate() { reset(); notify(); }
  function syncSymbols() {
    const next = currentSymbols();
    if (JSON.stringify(next) === JSON.stringify(symbols)) return false;
    symbols = next; reset(); return true;
  }
  function ensure({ force = false } = {}) {
    syncSymbols();
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
      selectedSymbols = readJson(STOCK_WATCHLIST_KEY, null);
      if (syncSymbols()) notify();
    },
    update(next) { selectedSymbols = normalizeStockWatchlist(next); symbols = [...selectedSymbols]; writeJson(STOCK_WATCHLIST_KEY, symbols); invalidate(); },
    setError(value) { error = value; notify(); },
  };
}

export const STOCK_ORIGIN = "https://qt.gtimg.cn";
export const STOCK_WATCHLIST_KEY = "dash.stocks.watchlist.v1";
export const STOCK_OPTED_IN_KEY = "dash.stocks.optedIn";
export const STOCK_LIMIT = 12;
export const STOCK_CACHE_KEY = "stock-quotes-v1";
export const STOCK_FRESH_MS = 60_000;
export const STOCK_STALE_MS = 24 * 60 * 60_000;

export function normalizeStockSymbol(value) {
  if (typeof value !== "string" || value.length > 32) return "";
  let text = value.trim();
  const suffix = text.match(/^(.+)\.(SH|SZ|BJ|HK|US)$/i);
  if (suffix) text = `${suffix[2].toLowerCase()}:${suffix[1]}`;
  const mainland = text.match(/^(sh|sz|bj):?(\d{6})$/i);
  if (mainland) return mainland[1].toLowerCase() + mainland[2];
  const hk = text.match(/^hk:?(\d{1,5})$/i);
  if (hk) return "hk" + hk[1].padStart(5, "0");
  if (/^\d{4,5}$/.test(text)) return "hk" + text.padStart(5, "0");
  if (/^\d{6}$/.test(text)) {
    const market = /^[56]/.test(text) ? "sh" : /^[0123]/.test(text) ? "sz" : /^[489]/.test(text) ? "bj" : "";
    return market ? market + text : "";
  }
  text = text.replace(/^US:/i, "").replace(/^us(?=[A-Z])/, "").toUpperCase();
  return /^[A-Z]{1,6}(?:[.-][A-Z])?$/.test(text) ? "us" + text : "";
}

export function normalizeStockWatchlist(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.slice(0, 100).map(normalizeStockSymbol).filter(Boolean))].slice(0, STOCK_LIMIT);
}

export function stockIdentity(symbol) {
  const market = symbol.startsWith("us") ? "us" : symbol.startsWith("hk") ? "hk" : "cn";
  return { symbol, code: symbol.slice(2), market, currency: { cn: "CNY", hk: "HKD", us: "USD" }[market],
    url: `https://gu.qq.com/${encodeURIComponent(symbol)}` };
}

// The provider returns text assignments. Parse their bounded string payloads without executing code.
export function parseStockQuotes(text, symbols) {
  const requested = new Set(normalizeStockWatchlist(symbols));
  const found = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    const match = line.trim().match(/^v_([a-zA-Z0-9.-]+)="([^"\r\n]*)";?$/);
    if (!match || !requested.has(match[1])) continue;
    const fields = match[2].split("~");
    const price = number(fields[3]);
    const change = number(fields[31]), changePercent = number(fields[32]);
    const quotedAt = quoteTime(fields[30]);
    const identity = stockIdentity(match[1]);
    const returnedCode = String(fields[2] || "");
    if (!fields[1]?.trim() || price === null || price <= 0 || !quotedAt
      || !(returnedCode === identity.code || identity.market === "us" && returnedCode.startsWith(identity.code + "."))) continue;
    found.set(match[1], { ...identity, name: fields[1].trim().slice(0, 80), price, change, changePercent, quotedAt });
  }
  return { quotes: [...requested].map(symbol => found.get(symbol)).filter(Boolean),
    missingSymbols: [...requested].filter(symbol => !found.has(symbol)) };
}

function number(value) {
  if (typeof value !== "string" || !/^[+-]?\d+(?:\.\d+)?$/.test(value.trim())) return null;
  const result = Number(value);
  return Number.isFinite(result) && Math.abs(result) < 1e12 ? result : null;
}

function quoteTime(value) {
  const digits = String(value || "").replace(/[-/: ]/g, "");
  if (!/^\d{14}$/.test(digits)) return "";
  const iso = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}T${digits.slice(8, 10)}:${digits.slice(10, 12)}:${digits.slice(12, 14)}`;
  const date = new Date(iso + "Z");
  return Number.isFinite(date.getTime()) && date.toISOString().startsWith(iso) ? iso.replace("T", " ") : "";
}

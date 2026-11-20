import assert from "node:assert/strict";
import { STOCK_CACHE_KEY, STOCK_LIMIT, STOCK_ORIGIN, STOCK_STALE_MS, STOCK_WATCHLIST_KEY, normalizeStockSymbol, normalizeStockWatchlist, parseStockQuotes } from "../../extension/core/stocks.mjs";
import { createStockService } from "../../extension/runtime/stock-service.mjs";
import { createPermissionEpoch } from "../../extension/runtime/permission-epoch.mjs";
import { createEpochMutationQueue } from "../../extension/core/mutation-queue.mjs";
import { createStockCardState } from "../../assets/client/stock-card-state.mjs";
import { applyExternalStoragePatch } from "../../assets/client/storage.mjs";
import { createCacheAccessPolicy } from "../../extension/runtime/cache-access-policy.mjs";


export async function runStockTests() {
  for (const [input, expected] of Object.entries({ "600519": "sh600519", "000001": "sz000001", "920001": "bj920001",
    "00700": "hk00700", "0700": "hk00700", "HK:700": "hk00700", "700.HK": "hk00700", "600519.SH": "sh600519",
    "SH000001": "sh000001", " aapl ": "usAAPL", "usAAPL": "usAAPL", "US:AAPL": "usAAPL", "AAPL.US": "usAAPL",
    "USB": "usUSB", "usb": "usUSB", "usac": "usUSAC", "usUSAC": "usUSAC", "BRK.B": "usBRK.B" })) assert.equal(normalizeStockSymbol(input), expected, input);
  for (const input of [null, {}, 600519, "", "700", "https://example.com", "AAPL,MSFT", 'AAPL";alert(1)', "a".repeat(40)]) {
    assert.equal(normalizeStockSymbol(input), "");
  }
  assert.deepEqual(normalizeStockWatchlist(["aapl", "usAAPL", null, "00700"]), ["usAAPL", "hk00700"]);
  assert.equal(normalizeStockWatchlist(Array.from({ length: 20 }, (_, i) => `sh${600000 + i}`)).length, STOCK_LIMIT);
  const payload = [quote("sh600519", "合成 A 股", "600519"), quote("hk00700", "合成港股", "00700", "2026/11/12 15:00:00"),
    quote("usAAPL", "Synthetic US", "AAPL.OQ", "2026-11-11 16:00:01"), quote("usBRK.B", "Class B", "BRK.B.N")].join("\n");
  const parsed = parseStockQuotes(payload, ["usAAPL", "hk00700", "sh600519", "usBRK.B", "usZZZZ"]);
  assert.deepEqual(parsed.quotes.map(item => item.currency), ["USD", "HKD", "CNY", "USD"]);
  assert.deepEqual(parsed.missingSymbols, ["usZZZZ"]);
  assert.equal(parsed.quotes[1].quotedAt, "2026-11-12 15:00:00");
  assert.equal(parsed.quotes[0].price, 100.25);
  assert.equal(parsed.quotes[0].changePercent, -1.25);
  assert.equal(parseStockQuotes(quote("usAAPL", "Missing", "AAPL.OQ", "20261112150000", { 31: "", 32: "" }), ["AAPL"]).quotes[0].changePercent, null);
  for (const text of ['v_usAAPL="x"; globalThis.stockInjected = true;', quote("usAAPL", "Wrong", "MSFT.OQ"),
    quote("usAAPL", "Bad date", "AAPL", "20261312150000"), quote("usAAPL", "Missing price", "AAPL", "20261112150000", { 3: "" }),
    quote("usAAPL", "Zero", "AAPL", "20261112150000", { 3: "0" })]) assert.equal(parseStockQuotes(text, ["AAPL"]).quotes.length, 0);
  assert.equal(globalThis.stockInjected, undefined);
  await testService(payload);
  await testDefaultState();
  await testState();
}

async function testDefaultState() {
  const defaults = ["sh600519", "hk00700", "sz002594"], english = ["usAAPL", "usMSFT", "usNVDA"], saved = [], requests = [];
  let locale = "zh-CN";
  const options = { getLocale: () => locale, notify() {}, localizedErrorMessage: error => error.message,
    writeJson(key, value) { saved.push([key, value]); applyExternalStoragePatch({ [key]: JSON.stringify(value) }); },
    async request(message) { requests.push(message); return { quotes: [] }; },
  };
  const fresh = createStockCardState(options);
  assert.deepEqual(fresh.read().symbols, defaults, "an unconfigured card starts with default stocks");
  assert.equal(saved.length, 0, "defaults do not overwrite storage or trigger content sync");
  assert.equal(requests.length, 0, "creating stock state does not fetch quotes");
  fresh.read().symbols.pop();
  assert.deepEqual(fresh.read().symbols, defaults, "readers cannot mutate the default watchlist");
  fresh.syncFromStorage();
  assert.deepEqual(fresh.read().symbols, defaults, "unrelated storage updates retain unsaved defaults");
  await fresh.ensure();
  assert.deepEqual(requests[0].payload.symbols, defaults);
  locale = "zh-Hant";
  assert.deepEqual(fresh.read().symbols, defaults, "both Chinese locales use Chinese-market defaults");
  assert.notEqual(fresh.read().result, null, "switching Chinese variants retains matching quotes");
  locale = "en";
  assert.deepEqual(fresh.read().symbols, english, "English defaults use US stocks");
  assert.equal(fresh.read().result, null, "switching default markets clears old quotes");
  assert.deepEqual(createStockCardState(options).read().symbols, english, "first use in English selects US defaults");
  await fresh.ensure();
  assert.deepEqual(requests[1].payload.symbols, english);
  locale = "zh-CN";
  const held = deferred();
  const switching = createStockCardState({ ...options, request: () => held.promise });
  const previous = switching.ensure(); await flush();
  locale = "en";
  switching.read();
  held.resolve({ quotes: [{ symbol: "sh600519" }] }); await previous;
  assert.equal(switching.read().result, null, "late quotes from the previous language cannot replace current defaults");

  fresh.update(["MSFT", "00700"]);
  locale = "zh-CN";
  assert.deepEqual(fresh.read().symbols, ["usMSFT", "hk00700"], "language changes preserve custom stocks");
  assert.deepEqual(createStockCardState(options).read().symbols, ["usMSFT", "hk00700"], "saved selections and order take precedence");
  fresh.update([]);
  const empty = createStockCardState(options);
  assert.deepEqual(empty.read().symbols, [], "removing all stocks stays empty after reopening");
  await empty.ensure();
  locale = "en";
  assert.deepEqual(empty.read().symbols, [], "language changes preserve an explicitly empty list");
  assert.equal(requests.length, 2, "an explicitly empty list does not fetch default quotes");
  assert.deepEqual(createStockCardState({ ...options, initialSymbols: [] }).read().symbols, []);

  applyExternalStoragePatch({ [STOCK_WATCHLIST_KEY]: '["NVDA"]' });
  fresh.syncFromStorage();
  assert.deepEqual(fresh.read().symbols, ["usNVDA"], "synced selections replace local defaults");
  applyExternalStoragePatch({ [STOCK_WATCHLIST_KEY]: "[]" });
  fresh.syncFromStorage();
  assert.deepEqual(fresh.read().symbols, [], "a synced empty list never restores defaults");
  assert.equal(saved.length, 2, "only explicit list edits persist");
}

async function testService(payload) {
  let allowed = false, fetched = 0, writes = 0, cached = null, fail = false, hold = null, time = Date.parse("2026-11-12T09:00:00Z");
  const permissionEpoch = createPermissionEpoch(), cacheMutations = createEpochMutationQueue();
  const typedError = (code, messageKey) => Object.assign(new Error(messageKey), { code, messageKey });
  const service = createStockService({ permissionEpoch, cacheMutations, typedError, now: () => time,
    hasOriginPermissions: async origins => { assert.deepEqual(origins, [STOCK_ORIGIN]); return allowed; },
    getRecord: async key => { assert.equal(key, STOCK_CACHE_KEY); return cached; },
    setRecord: async (key, value, kind) => { assert.equal(key, STOCK_CACHE_KEY); assert.equal(kind, "cache"); cached = value; writes++; },
    fetchResponse: async (url, options, limits) => {
      fetched++;
      assert.equal(url, `${STOCK_ORIGIN}/q=sh600519,hk00700,usAAPL`);
      assert.equal(options.credentials, "omit"); assert.equal(options.redirect, "error");
      assert.equal(limits.maxBytes, 128 * 1024);
      if (hold) await hold.promise;
      if (fail) throw new Error("offline");
      const response = { ok: true, url, headers: new Headers({ "content-type": "text/plain; charset=utf-8" }) };
      limits.validateResponse(response);
      return { response, buffer: new TextEncoder().encode(payload).buffer };
    },
  });
  const request = { symbols: ["600519", "00700", "AAPL"] };
  await assert.rejects(service.getQuotes(request), { code: "STOCK_PERMISSION_REQUIRED" });
  assert.equal(fetched, 0); allowed = true;
  const both = await Promise.all([service.getQuotes(request), service.getQuotes(request)]);
  assert.equal(fetched, 1, "concurrent cards and tabs share a request"); assert.deepEqual(both[0], both[1]);
  await service.getQuotes(request); assert.equal(fetched, 1, "fresh cache avoids network");
  assert.equal(writes, 1);
  time += 61_000; fail = true;
  assert.equal((await service.getQuotes(request)).stale, true, "offline fallback is visibly stale");
  time += STOCK_STALE_MS;
  await assert.rejects(service.getQuotes(request), { code: "STOCK_NETWORK_ERROR" });
  allowed = false;
  await assert.rejects(service.getQuotes(request), { code: "STOCK_PERMISSION_REQUIRED" });
  const policy = createCacheAccessPolicy({ stockCachePermitted: service.stockCachePermitted });
  assert.equal(await policy.isRecordPermitted({ key: STOCK_CACHE_KEY, value: cached }, {}), false);
  allowed = true; fail = false; cached = null;
  hold = deferred();
  let operation = service.getQuotes(request);
  await flush();
  permissionEpoch.next(); allowed = false; hold.resolve();
  await assert.rejects(operation, { code: "STOCK_PERMISSION_REQUIRED" }); assert.equal(writes, 1, "revoked requests cannot restore cache");
  allowed = true; hold = deferred();
  operation = service.getQuotes(request); await flush(); cacheMutations.invalidate(); hold.resolve();
  await assert.rejects(operation, { code: "STOCK_INVALIDATED" }); assert.equal(writes, 1, "cleared cache rejects late requests");
}

async function testState() {
  const requests = [], saved = [];
  const state = createStockCardState({ initialSymbols: ["AAPL"], notify() {}, localizedErrorMessage: error => error.message,
    writeJson: (key, value) => saved.push([key, value]), request: ({ payload }) => {
      const request = deferred(); requests.push({ ...request, payload }); return request.promise;
    } });
  const first = state.ensure(); assert.equal(state.ensure(), first);
  await flush(); state.update(["00700"]);
  const next = state.ensure(); await flush();
  requests[1].resolve({ quotes: [{ symbol: "hk00700" }], fetchedAt: new Date().toISOString() }); await next;
  requests[0].resolve({ quotes: [{ symbol: "usAAPL" }] }); await first;
  assert.equal(state.read().result.quotes[0].symbol, "hk00700", "late quote response cannot replace a changed watchlist");
  assert.deepEqual(saved[0][1], ["hk00700"]);
  await state.ensure(); assert.equal(requests.length, 2);
  state.invalidate(); const revoked = state.ensure(); await flush();
  requests[2].reject(Object.assign(new Error("permission"), { code: "STOCK_PERMISSION_REQUIRED" })); await revoked;
  assert.equal(state.read().result, null);
  await state.ensure(); assert.equal(requests.length, 3, "rendering permission errors does not loop");
  const retried = state.ensure({ force: true }); await flush();
  state.invalidate(); requests[3].resolve({ quotes: [{ symbol: "hk00700" }] }); await retried;
  assert.equal(state.read().result, null);
  const stale = state.ensure(); await flush();
  applyExternalStoragePatch({ "dash.stocks.watchlist.v1": '["MSFT"]' });
  state.syncFromStorage();
  assert.deepEqual(state.read().symbols, ["usMSFT"]);
  assert.equal(state.read().busy, false);
  requests[4].resolve({ quotes: [{ symbol: "hk00700" }] }); await stale;
  assert.equal(state.read().result, null, "late quotes cannot replace a remotely changed watchlist");
  const fresh = state.ensure(); await flush();
  assert.deepEqual(requests[5].payload.symbols, ["usMSFT"]);
  state.syncFromStorage();
  assert.equal(state.read().busy, true, "unchanged sync events preserve the current request");
  requests[5].resolve({ quotes: [{ symbol: "usMSFT" }] }); await fresh;
  applyExternalStoragePatch({ "dash.stocks.watchlist.v1": "[]" });
  state.syncFromStorage();
  assert.deepEqual(state.read().symbols, []);
  assert.equal(state.read().result, null);
  await state.ensure(); assert.equal(requests.length, 6, "a synced empty watchlist stops quote fetching");
  assert.equal(saved.length, 1, "remote watchlists do not echo into local writes");
}

function quote(symbol, name, code, time = "20261112150000", overrides = {}) {
  const fields = Array(33).fill(""); Object.assign(fields, { 1: name, 2: code, 3: "100.25", 30: time, 31: "-1.27", 32: "-1.25", ...overrides });
  return `v_${symbol}="${fields.join("~")}";`;
}
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function flush() { for (let i = 0; i < 20; i++) await Promise.resolve(); }

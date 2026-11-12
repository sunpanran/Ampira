import assert from "node:assert/strict";
import { CACHE_LIMIT_BYTES, CACHE_RETENTION_MS } from "../../extension/core/constants.mjs";
import {
  createHeaderCoverCache, HEADER_COVER_CACHE_KEY, HEADER_COVER_CACHE_NAME,
  normalizeNetworkHeaderCoverUrl,
} from "../../extension/core/header-cover-cache.mjs";
import { createHeaderCoverFetchHandler } from "../../extension/runtime/header-cover-fetch.mjs";
import { createHeaderCoverRenderer } from "../../assets/client/header-cover-renderer.mjs";

const firstUrl = "https://images.example/first.webp";
const secondUrl = "https://images.example/second.webp";
assert.equal(normalizeNetworkHeaderCoverUrl(`${firstUrl}#fragment`), firstUrl);
assert.equal(normalizeNetworkHeaderCoverUrl("http://localhost:1234/image.png"), "http://localhost:1234/image.png");
for (const url of ["http://images.example/a", "data:image/png;base64,AAAA", "javascript:alert(1)", "https://user:password@images.example/a", "file:///a", "http://[::1]/a"]) {
  assert.equal(normalizeNetworkHeaderCoverUrl(url), "");
}

const reuse = harness();
const [first, duplicate] = await Promise.all([reuse.service.load(firstUrl), reuse.service.load(firstUrl)]);
assert.equal(reuse.requests.length, 1, "preload and image requests must share one download");
assert.notEqual(first, duplicate, "each consumer receives its own response body");
assert.equal(reuse.records.get(HEADER_COVER_CACHE_KEY).externalSize, 8 * 1024 * 1024);
assert.equal((await reuse.restart().load(firstUrl)).type, "opaque");
assert.equal(reuse.requests.length, 1, "a new worker must reuse the persistent image without revalidation");
await reuse.service.load(secondUrl);
assert.deepEqual([...reuse.bodies.keys()], [secondUrl], "only one opaque cover body is retained");
await reuse.service.reject(firstUrl);
assert(reuse.bodies.has(secondUrl), "a late image error must not evict the replacement");
await reuse.service.reject(secondUrl);
assert.equal(reuse.bodies.size, 0, "failed decodes must not remain in the image cache");
await reuse.service.load(secondUrl);
assert.equal(reuse.requests.length, 3, "failed images can be retried on the next use");

const failedFetch = harness();
failedFetch.fetch = async () => { throw new Error("offline"); };
await assert.rejects(failedFetch.service.load(firstUrl), /offline/);
assert.equal(failedFetch.records.size, 0);
failedFetch.fetch = async () => response();
await failedFetch.service.load(firstUrl);
assert.equal(failedFetch.requests.length, 2, "network failures must not poison the pending-request map");

const httpError = harness();
httpError.fetch = async () => response("basic", false);
assert.equal((await httpError.service.load(firstUrl)).ok, false);
assert.equal(httpError.bodies.size, 0, "readable HTTP errors must never be cached");

for (const bytes of [CACHE_LIMIT_BYTES + 1, NaN, 0]) {
  const limited = harness();
  await limited.service.load(firstUrl);
  limited.bytes = bytes;
  assert.equal((await limited.service.load(secondUrl)).type, "opaque", "quota failures must still display the fetched image");
  assert.equal(limited.bodies.size, 0);
  assert.equal(limited.records.size, 0, "failed replacements must release old accounting as well as bodies");
}
const unavailable = harness();
unavailable.options.storage = undefined;
assert.equal((await unavailable.restart().load(firstUrl)).type, "opaque", "unavailable local storage must leave network display usable");
const failedWrite = harness();
failedWrite.options.setRecord = async () => { throw new Error("quota"); };
assert.equal((await failedWrite.restart().load(firstUrl)).type, "opaque");
assert.equal(failedWrite.bodies.size, 0, "failed metadata writes must not leave unaccounted bodies");

const expired = harness();
await expired.service.load(firstUrl);
expired.time += CACHE_RETENTION_MS;
await expired.service.prune();
assert.equal(expired.bodies.size, 1, "the exact retention boundary follows the shared cache policy");
expired.time += 1;
await expired.service.prune();
assert.equal(expired.bodies.size, 0);
await expired.service.load(firstUrl);
assert.equal(expired.requests.length, 2);
expired.records.clear();
await expired.service.prune();
assert.equal(expired.bodies.size, 0, "shared cache eviction must reclaim the associated response");
const orphan = harness();
await orphan.service.load(firstUrl);
orphan.bodies.clear();
orphan.bodies.set(secondUrl, response());
await orphan.service.prune();
assert.equal(orphan.bodies.size, 0, "an interrupted replacement must not leave an unaccounted body");
assert.equal(orphan.records.size, 0);

for (const operation of ["clear", "reject"]) {
  const delayed = harness();
  const gate = deferred();
  delayed.fetch = () => gate.promise;
  const loading = delayed.service.load(firstUrl);
  await tick();
  await delayed.service[operation](firstUrl);
  gate.resolve(response());
  await loading;
  assert.equal(delayed.bodies.size, 0, `${operation} must prevent late downloads from restoring deleted data`);
  assert.equal(delayed.records.size, 0);
}
const raced = harness();
const slow = deferred();
raced.fetch = url => url === firstUrl ? slow.promise : Promise.resolve(response());
const old = raced.service.load(firstUrl);
await tick();
await raced.service.load(secondUrl);
slow.resolve(response());
await old;
assert.deepEqual([...raced.bodies.keys()], [secondUrl], "the older download must not replace the current image");

let cacheCalls = 0;
const origin = "https://app.example";
let clientUrl = `${origin}/dashboard.html`;
let resetting = false;
const handler = createHeaderCoverFetchHandler({
  cache: { async load() { cacheCalls += 1; return response(); } }, origin,
  clients: { async get() { return { url: clientUrl }; } }, isResetting: () => resetting,
});
const dispatch = async (request = {}, clientId = "dashboard") => {
  let result;
  handler({ clientId, request: { url: `${origin}/_header-cover?url=${encodeURIComponent(firstUrl)}`, method: "GET", destination: "image", mode: "no-cors", ...request }, respondWith(value) { result = value; } });
  return await result;
};
assert.equal((await dispatch()).type, "opaque");
for (const request of [{ method: "POST" }, { destination: "script" }, { destination: "" }, { mode: "cors" }, { url: `${origin}/_header-cover?url=http://insecure.example/a` }]) {
  assert.equal((await dispatch(request)).type, "error");
}
assert.equal((await dispatch({}, "")).type, "error");
clientUrl = "https://other.example/dashboard.html";
assert.equal((await dispatch()).type, "error");
clientUrl = `${origin}/action-popup.html`;
assert.equal((await dispatch()).type, "error");
clientUrl = `${origin}/dashboard.html`;
resetting = true;
assert.equal((await dispatch()).type, "error");
assert.equal(cacheCalls, 1, "only a dashboard image request may read or populate the image cache");
assert.equal(await dispatch({ url: `${origin}/assets/client/app.mjs` }), undefined, "unrelated requests must remain untouched");
const previousBootstrap = globalThis.ampiraLayoutBootstrap;
const previousDocument = globalThis.document;
let rejectedImages = 0;
globalThis.ampiraLayoutBootstrap = { rejectHeaderCover: () => { rejectedImages += 1; } };
globalThis.document = { documentElement: { classList: { remove() {} } } };
try {
  const hero = { hidden: false, classList: { remove() {} } };
  const controller = createHeaderCoverRenderer({ state: {}, els: {
    headerImage: { complete: true, naturalWidth: 0, getAttribute: () => `${origin}/_header-cover?url=${encodeURIComponent(firstUrl)}` },
    headerImageHero: hero,
  } });
  controller.syncHeaderImageLoadState();
  assert.equal(rejectedImages, 0, "a pending source assignment must not invalidate a cached image");
  assert.equal(hero.hidden, false, "undecoded pending images must wait for their load or error event");
  controller.handleHeaderImageError();
  assert.equal(rejectedImages, 1, "a real decode error must evict the unusable image");
  assert.equal(hero.hidden, true);
} finally {
  if (previousBootstrap === undefined) delete globalThis.ampiraLayoutBootstrap;
  else globalThis.ampiraLayoutBootstrap = previousBootstrap;
  if (previousDocument === undefined) delete globalThis.document;
  else globalThis.document = previousDocument;
}
console.log("network header cover cache tests passed");

function harness() {
  const state = { records: new Map(), bodies: new Map(), requests: [], time: 1800000000000, bytes: 8 * 1024 * 1024, fetch: async () => response() };
  const cache = {
    async keys() { return [...state.bodies.keys()]; },
    async match(url) { return state.bodies.get(url)?.clone(); },
    async put(url, value) { state.bodies.set(url, value.clone()); },
    async delete(url) { return state.bodies.delete(url); },
  };
  state.options = {
    getRecord: async key => state.records.get(key)?.value || null,
    setRecord: async (key, value, kind, externalSize) => { state.records.set(key, { value, kind, externalSize }); },
    deleteRecord: async key => { state.records.delete(key); },
    storage: { async open(name) { assert.equal(name, HEADER_COVER_CACHE_NAME); return cache; }, async delete() { state.bodies.clear(); return true; } },
    estimate: async () => ({ usageDetails: { caches: state.bytes } }),
    fetchImage: async url => { state.requests.push(url); return state.fetch(url); },
    now: () => state.time,
  };
  state.restart = () => createHeaderCoverCache(state.options);
  state.service = state.restart();
  return state;
}
function response(type = "opaque", ok = false) {
  return { type, ok, clone: () => response(type, ok) };
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function tick() { return new Promise(resolve => setImmediate(resolve)); }

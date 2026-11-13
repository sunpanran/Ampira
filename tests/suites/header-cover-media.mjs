import assert from "node:assert/strict";
import { createHeaderCoverStore } from "../../extension/core/header-cover.mjs";
import { LOCAL_HEADER_COVER_KEY } from "../../extension/core/constants.mjs";
import { HEADER_VIDEO_MAX_BYTES, HEADER_VIDEO_RECORD_PREFIX, normalizeHeaderVideoRecord, isHeaderVideoBlob, headerVideoResponse } from "../../extension/core/header-video.mjs";
import { handleHeaderVideoFetch } from "../../extension/runtime/header-video-fetch.mjs";
import { prepareHeaderVideoFile } from "../../assets/client/header-cover-local-video.mjs";

const blob = new Blob([new Uint8Array([0, 0, 0, 24]), "ftypisom", new Uint8Array(20)], { type: "video/mp4" });
const video = { schemaVersion: 2, videoId: "11111111-1111-4111-8111-111111111111", name: "synthetic.mp4",
  mimeType: "video/mp4", byteLength: blob.size, width: 1280, height: 720, duration: 3 };
assert(normalizeHeaderVideoRecord(video));
for (const patch of [{ videoId: "../../private" }, { byteLength: HEADER_VIDEO_MAX_BYTES + 1 },
  { width: 0 }, { height: 9000 }, { mimeType: "text/html" }]) assert.equal(normalizeHeaderVideoRecord({ ...video, ...patch }), null);
assert(await isHeaderVideoBlob(blob, video));
assert.equal(await isHeaderVideoBlob(new Blob(["<html>invalid</html>"], { type: "video/mp4" }), video), false);
await assert.rejects(prepareHeaderVideoFile({ type: "video/mp4", size: HEADER_VIDEO_MAX_BYTES + 1 }), { messageKey: "settings.headerImage.localVideoErrorSize" });
await assert.rejects(prepareHeaderVideoFile(new File(["not video"], "fake.mp4", { type: "video/mp4" })), { messageKey: "settings.headerImage.localVideoErrorDecode" });

for (const [range, expected, status] of [["", blob.size, 200], ["bytes=0-3", 4, 206], ["bytes=5-", blob.size - 5, 206],
  ["bytes=-4", 4, 206], ["bytes=0-9999", blob.size, 206], ["bytes=99-", 0, 416], ["bytes=-0", 0, 416],
  ["bytes=4-2", 0, 416], ["bytes=0-1,5-8", 0, 416], ["bytes=-", 0, 416]]) {
  const response = headerVideoResponse(blob, range);
  assert.equal(response.status, status, range);
  assert.equal((await response.arrayBuffer()).byteLength, expected, range);
}

const values = new Map(), records = new Map();
let failStorage = false;
const storage = {
  async get(key) { return values.has(key) ? { [key]: structuredClone(values.get(key)) } : {}; },
  async set(value) { if (failStorage) throw new Error("quota"); for (const [key, entry] of Object.entries(value)) values.set(key, structuredClone(entry)); },
  async remove(key) { values.delete(key); },
};
const store = createHeaderCoverStore(storage, { records: {
  async getRecord(key) { return records.get(key)?.value; },
  async setRecord(key, value, kind) { records.set(key, { key, value, kind }); },
  async deleteRecord(key) { records.delete(key); },
  async listRecords(kind) { return [...records.values()].filter(record => record.kind === kind); },
} });
await assert.rejects(store.apply({ action: "replace", record: video }), { code: "HEADER_COVER_INVALID" });
failStorage = true;
await assert.rejects(store.apply({ action: "replace", record: video, blob }), { code: "HEADER_COVER_STORAGE_FAILED" });
assert.equal(records.size, 0, "failed metadata writes must not leave video blobs behind");
failStorage = false;
const first = await store.apply({ action: "replace", record: video, blob });
assert.equal((await store.read()).record.videoId, video.videoId);
assert.equal(values.get(LOCAL_HEADER_COVER_KEY).blob, undefined, "Chrome JSON storage contains metadata only");
assert.equal(await store.readVideo("22222222-2222-4222-8222-222222222222"), null);
await store.finalize(first);
const replacement = { ...video, videoId: "22222222-2222-4222-8222-222222222222" };
const replaced = await store.apply({ action: "replace", record: replacement, blob });
await store.restore(replaced.previous);
assert.equal((await store.read()).record.videoId, video.videoId, "a failed settings transaction restores the previous video");
assert.equal(records.size, 1);
const removed = await store.apply({ action: "remove" });
await store.restore(removed.previous);
assert(await store.readVideo(video.videoId), "a failed removal keeps the original video playable");

const origin = "https://extension.example";
const requests = [];
const options = {
  origin, clients: { async get(id) { return { url: `${origin}/${id === "dashboard" ? "dashboard.html" : "other.html"}` }; } },
  headerCoverStore: store,
  async saveSettings(body) { const mutation = await store.apply(body.headerCoverOperation); await store.finalize(mutation); return { headerCoverChanged: true }; },
  async fetchVideo(request, init) { requests.push({ request, init }); return new Response(blob); },
};
const event = (pathname, changes = {}) => ({ clientId: "dashboard", request: {
  url: /^https?:/.test(pathname) ? pathname : origin + pathname, method: "GET", destination: "video", mode: "no-cors", headers: new Headers({ Range: "bytes=0-" }),
  signal: new AbortController().signal, ...changes,
} });
assert.equal((await handleHeaderVideoFetch(event("https://media.example/download?id=5"), options)).status, 200);
assert.equal(requests[0].request.url, "https://media.example/download?id=5");
assert.equal(requests[0].init.credentials, "omit");
assert.equal(requests[0].init.referrerPolicy, "no-referrer");
assert.equal(requests[0].request.mode, "no-cors");
assert.equal(requests[0].init.redirect, "follow");
assert.equal(requests[0].request.headers.get("range"), "bytes=0-");
assert.equal(requests[0].init.headers, undefined, "rebuilding headers would strip privileged media Range requests");
for (const candidate of [
  event("http://remote.example/video"),
  event("https://user:pass@media.example/video"),
  event("https://media.example/video", { destination: "" }),
  { ...event("https://media.example/video"), clientId: "other" },
  event("https://media.example/video", { mode: "cors" }),
]) assert.equal((await handleHeaderVideoFetch(candidate, options)).type, "error");
assert.equal(requests.length, 1, "invalid callers and URLs must not reach the network");
const local = await handleHeaderVideoFetch(event(`/_header-video?local=${video.videoId}`, { headers: new Headers({ Range: "bytes=4-7" }) }), options);
assert.equal(local.status, 206);
assert.equal(await local.text(), "ftyp");

const form = new FormData();
form.set("settings", JSON.stringify({ headerCoverOperation: { action: "replace", record: replacement } }));
form.set("requestId", "synthetic-request");
form.set("file", blob, "synthetic.mp4");
const upload = new Request(origin + "/_header-cover-save", { method: "POST", mode: "same-origin", body: form });
const saved = await handleHeaderVideoFetch({ clientId: "dashboard", request: upload }, options);
assert.deepEqual(await saved.json(), { ok: true, requestId: "synthetic-request", data: { headerCoverChanged: true } });
assert.equal((await store.read()).record.videoId, replacement.videoId);
assert.equal(records.has(HEADER_VIDEO_RECORD_PREFIX + video.videoId), false, "successful replacements delete the old file");
await store.finalize(await store.apply({ action: "remove" }));
assert.equal(records.size, 0);
assert.deepEqual(await store.read(), { available: false, invalid: false, record: null });

console.log("local and download header video tests passed");

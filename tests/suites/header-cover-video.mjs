import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { isHeaderVideoUrl } from "../../assets/client/header-cover-model.mjs";
import { createHeaderVideoController } from "../../assets/client/header-cover-video.mjs";
import { normalizeSettings } from "../../extension/core/settings.mjs";
import { createSettingsTransferDocument, parseSettingsTransferDocument } from "../../extension/core/settings-transfer.mjs";
import { encodeSettingsForSync, decodeSettingsFromSync } from "../../extension/core/settings-storage.mjs";

for (const url of ["https://media.example/cover.mp4", "https://media.example/COVER.WEBM?token=synthetic#t=1", "http://localhost:43210/cover.ogv"]) {
  assert.equal(isHeaderVideoUrl(url), true);
  assert.equal(isHeaderVideoUrl(url, "image"), false);
}
assert.equal(isHeaderVideoUrl("https://media.example/image.jpg?filename=video.mp4"), false);
assert.equal(isHeaderVideoUrl("https://media.example/play?id=1"), false);
assert.equal(isHeaderVideoUrl("https://media.example/play?id=1", "video"), true);
assert.equal(isHeaderVideoUrl("invalid"), false);
assert.equal(normalizeSettings({}).headerImageMediaType, "auto");
assert.equal(normalizeSettings({ headerImageMediaType: "iframe" }).headerImageMediaType, "auto");
for (const type of ["auto", "image", "video"]) {
  const settings = normalizeSettings({ headerImageUrl: "https://media.example/stream", headerImageMediaType: type });
  const transfer = createSettingsTransferDocument(settings);
  assert.equal(parseSettingsTransferDocument(transfer, {}).patch.headerImageMediaType, type);
  assert.equal(decodeSettingsFromSync(encodeSettingsForSync(settings)).headerImageMediaType, type);
}
for (const url of ["http://media.example/cover.mp4", "javascript:alert(1)", "data:video/mp4;base64,AAAA", "https://user:pass@media.example/cover.mp4"]) {
  assert.equal(normalizeSettings({ headerImageUrl: url, headerImageMediaType: "video" }).headerImageUrl, "");
}
assert.throws(() => parseSettingsTransferDocument({ ...createSettingsTransferDocument({}), settings: { headerImageMediaType: "iframe" } }), { code: "SETTINGS_IMPORT_INVALID_VALUE" });

const previous = Object.fromEntries(["document", "matchMedia", "addEventListener"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const document = new EventTarget(), motion = new EventTarget(), window = new EventTarget();
document.hidden = false;
motion.matches = false;
const video = new EventTarget(), image = { hidden: false };
let src = "", plays = 0, pauses = 0, loads = 0, reveals = 0, fallbacks = 0, rejectPlay;
Object.assign(video, {
  setAttribute() {}, hasAttribute: () => Boolean(src), removeAttribute() { src = ""; },
  pause() { pauses++; this.paused = true; },
  play() { plays++; this.paused = false; return new Promise((resolve, reject) => { rejectPlay = reject; }); },
  load() { loads++; this.readyState = 0; this.videoWidth = 0; this.error = null; },
});
Object.defineProperty(video, "src", { get: () => src, set: value => { src = value; } });
document.createElement = tag => { assert.equal(tag, "video"); return video; };
const hero = new EventTarget();
Object.assign(hero, { dataset: {}, classList: { remove() {} }, querySelector: () => image, insertBefore() {}, hidden: false });
try {
  globalThis.document = document;
  globalThis.matchMedia = () => motion;
  globalThis.addEventListener = window.addEventListener.bind(window);
  const controller = createHeaderVideoController(hero, {
    reveal: () => { reveals++; }, fallback: () => { fallbacks++; },
  });
  controller.setSource("https://media.example/first.mp4");
  assert.equal(plays, 1);
  assert.equal(video.muted && video.defaultMuted && video.loop && video.playsInline, true);
  assert.equal(video.crossOrigin, "anonymous", "remote playback must omit site credentials");
  assert.equal(image.hidden, true);
  assert.equal(hero.dataset.headerVideoState, "loading");
  video.dispatchEvent(new Event("loadeddata"));
  assert.equal(reveals, 0, "undecoded video must not reveal a black cover");
  Object.assign(video, { readyState: 2, videoWidth: 1280 });
  video.dispatchEvent(new Event("loadeddata"));
  assert.equal(reveals, 1);
  assert.equal(hero.dataset.headerVideoState, "ready");
  controller.setSource(src);
  assert.equal(plays, 1, "settings repaint must not restart playback");
  for (const [target, property, event] of [[motion, "matches", "change"], [document, "hidden", "visibilitychange"]]) {
    target[property] = true;
    target.dispatchEvent(new Event(event));
    assert.equal(video.paused, true);
    target[property] = false;
    target.dispatchEvent(new Event(event));
    assert.equal(video.paused, false);
  }
  window.dispatchEvent(new Event("pagehide"));
  assert.equal(video.paused, true);
  window.dispatchEvent(new Event("pageshow"));
  assert.equal(video.paused, false);
  const rejectOld = rejectPlay;
  controller.setSource("https://media.example/second.webm");
  rejectOld(Object.assign(new Error("old source"), { name: "NotSupportedError" }));
  await Promise.resolve();
  assert.equal(fallbacks, 0, "an old play rejection must not replace the new video");
  video.error = { code: 4 };
  video.dispatchEvent(new Event("error"));
  assert.equal(fallbacks, 1);
  assert.equal(hero.dataset.headerVideoState, "error");
  assert.equal(src, "", "failed media must stop downloading");
  assert.equal(image.hidden, false);
  controller.setSource("https://media.example/second.webm");
  assert.equal(src, "", "unrelated settings repaint must not repeatedly retry a broken URL");
  controller.setSource("");
  assert.equal(hero.dataset.headerVideoState, "");
  motion.matches = true;
  const before = plays;
  controller.setSource("https://media.example/second.webm");
  assert.equal(plays, before, "reduced motion must retain a still frame without starting playback");
  controller.setSource("");
  assert.equal(video.hidden && video.paused, true);
  assert.equal(src, "");
  assert(loads >= 3 && pauses >= 3, "switching or disabling must release the prior media");
} finally {
  for (const [key, descriptor] of Object.entries(previous)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
}

const manifest = JSON.parse(await fs.readFile(new URL("../../manifest.json", import.meta.url), "utf8"));
const csp = manifest.content_security_policy.extension_pages;
assert(csp.includes("media-src 'self' blob: https: http://localhost:* http://127.0.0.1:*"));
assert(csp.includes("frame-src 'none'"), "video backgrounds must not enable embedded remote webpages");
console.log("header cover video tests passed");

import assert from "node:assert/strict";
import { loadImageWithReveal } from "../../assets/client/async-image-reveal.mjs";

export async function runAsyncImageRevealTests() {
  await testNetworkLoadRevealsAfterDecode();
  await testCacheHitSkipsInitialReveal();
  await testResolvedPlaceholderStillReveals();
  testRejectedImageNeverReveals();
}

async function testNetworkLoadRevealsAfterDecode() {
  const image = createImage();
  const frames = [];
  loadImageWithReveal(image, "https://example.com/slow.webp", {
    requestFrame: (callback) => frames.push(callback),
    validate: ({ naturalWidth }) => naturalWidth >= 320,
  });
  assert.equal(image.classList.contains("is-preview-image-pending"), true);
  image.naturalWidth = 640;
  image.dispatch("load");
  await settlePromises();
  assert.equal(frames.length, 1, "a decoded network image must wait for a painted hidden frame");
  frames.shift()();
  assert.equal(frames.length, 1);
  frames.shift()();
  assert.equal(image.classList.contains("is-preview-image-pending"), false);
  assert.equal(image.classList.contains("is-preview-image-revealing"), true);
}

async function testCacheHitSkipsInitialReveal() {
  const image = createImage({ complete: true, naturalWidth: 640 });
  const frames = [];
  loadImageWithReveal(image, "https://example.com/cached.webp", {
    requestFrame: (callback) => frames.push(callback),
  });
  await settlePromises();
  assert.equal(frames.length, 0, "an initial cache hit must not blink through another entrance animation");
  assert.equal(image.classList.contains("is-preview-image-pending"), false);
}

async function testResolvedPlaceholderStillReveals() {
  const image = createImage({ complete: true, naturalWidth: 640 });
  const frames = [];
  loadImageWithReveal(image, "https://example.com/resolved.webp", {
    forceReveal: true,
    requestFrame: (callback) => frames.push(callback),
  });
  await settlePromises();
  assert.equal(frames.length, 1, "an asynchronously resolved preview must fade in even when preloaded");
}

function testRejectedImageNeverReveals() {
  const image = createImage();
  const frames = [];
  let rejects = 0;
  loadImageWithReveal(image, "https://example.com/tiny.webp", {
    onReject: () => { rejects += 1; },
    requestFrame: (callback) => frames.push(callback),
    validate: ({ naturalWidth }) => naturalWidth >= 320,
  });
  image.naturalWidth = 64;
  image.dispatch("load");
  assert.equal(rejects, 1, "an invalid image must preserve the existing recovery path");
  assert.equal(frames.length, 0);
}

function createImage({ complete = false, naturalWidth = 0 } = {}) {
  const target = new EventTarget();
  const classes = new Set();
  target.complete = complete;
  target.naturalWidth = naturalWidth;
  target.src = "";
  target.classList = {
    add: (...names) => names.forEach((name) => classes.add(name)),
    contains: (name) => classes.has(name),
    remove: (...names) => names.forEach((name) => classes.delete(name)),
  };
  target.decode = () => Promise.resolve();
  target.dispatch = (type) => target.dispatchEvent(new Event(type));
  return target;
}

async function settlePromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

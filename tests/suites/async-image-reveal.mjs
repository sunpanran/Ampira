import assert from "node:assert/strict";
import { loadImageWithReveal, prepareImageForSnapshot } from "../../assets/client/async-image-reveal.mjs";
import { settleBatchImages } from "../../assets/client/batch-transition.mjs";

export async function runAsyncImageRevealTests() {
  await testNetworkLoadRevealsAfterDecode();
  await testCacheHitSkipsInitialReveal();
  await testResolvedPlaceholderStillReveals();
  testRejectedImageNeverReveals();
  await testBatchSnapshotUsesDecodedImage();
  await testSnapshotCancelsQueuedReveal();
  await testSlowImageDoesNotBlockBatch();
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

async function testBatchSnapshotUsesDecodedImage() {
  const image = createImage();
  const frames = [];
  loadImageWithReveal(image, "https://example.com/batch.webp", { requestFrame: callback => frames.push(callback), forceReveal: true });
  const capture = prepareImageForSnapshot(image);
  image.naturalWidth = 640;
  image.dispatch("load");
  await capture.ready;
  capture.release();
  assert.equal(frames.length, 0, "the decoded snapshot must not wait for a second image animation");
  assert.equal(image.classList.contains("is-preview-image-pending"), false);
  assert.equal(image.classList.contains("is-preview-image-revealing"), false);
}

async function testSnapshotCancelsQueuedReveal() {
  const image = createImage({ complete: true, naturalWidth: 640 });
  const frames = [];
  loadImageWithReveal(image, "https://example.com/queued.webp", { requestFrame: callback => frames.push(callback), forceReveal: true });
  await settlePromises();
  const capture = prepareImageForSnapshot(image);
  await capture.ready;
  capture.release();
  while (frames.length) frames.shift()();
  assert.equal(image.classList.contains("is-preview-image-revealing"), false, "a queued image callback must not restart a fade after capture");
}

async function testSlowImageDoesNotBlockBatch() {
  const image = createImage();
  const frames = [];
  loadImageWithReveal(image, "https://example.com/unresponsive.webp", { requestFrame: callback => frames.push(callback) });
  await settleBatchImages([{ querySelectorAll: () => [image] }]);
  assert.equal(image.classList.contains("is-preview-image-pending"), true, "snapshot preparation must time out without revealing an unloaded image");
  image.naturalWidth = 640;
  image.dispatch("load");
  await settlePromises();
  while (frames.length) frames.shift()();
  assert.equal(image.classList.contains("is-preview-image-revealing"), true, "images arriving after the snapshot budget retain their normal load reveal");
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

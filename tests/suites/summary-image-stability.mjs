import assert from "node:assert/strict";
import { createSitePreviewController, sitePreviewFingerprint } from "../../assets/client/inspiration-preview-controller.mjs";
import { createSummaryImageThumbs } from "../../assets/client/summary-image-thumb.mjs";

export async function runSummaryImageStabilityTests() {
  await testArticlePreviewSurvivesOrganization();
  await testStalePreviewStillInvalidates();
  testRepeatedImageNotification();
  console.log("summary image stability tests passed");
}

async function testArticlePreviewSurvivesOrganization() {
  let current = { key: "article", url: "https://news.example/story", title: "Original headline" };
  const requests = [], images = [];
  const controller = createSitePreviewController({
    isEnabled: () => true, isHttpUrl: () => true, normalizeUrl: String, profileForItem: () => "article",
    apiGet: () => new Promise(resolve => requests.push(resolve)),
    isCurrent: (_item, fingerprint) => controller.fingerprint(current) === fingerprint,
    onImage: (_item, imageUrl) => images.push(imageUrl),
  });
  const original = { ...current };
  const pending = controller.request(current);
  await Promise.resolve();
  current = { ...current, title: "整理后的中文标题" };
  assert.equal(controller.request(current), pending, "organizing a headline must reuse the article's in-flight image request");
  requests[0]({ imageUrl: "https://images.example/story.jpg", source: "origin" });
  await pending;
  assert.equal(controller.get(current)?.imageUrl, "https://images.example/story.jpg", "title localization must preserve an already resolved article preview");
  await controller.request(current);
  assert.equal(requests.length, 1, "organization must not refetch the same origin image");
  assert.deepEqual(images, ["https://images.example/story.jpg"]);
  assert.notEqual(sitePreviewFingerprint(original), sitePreviewFingerprint(current), "visual bookmark searches must still invalidate when their search title changes");
  assert.notEqual(controller.fingerprint(current), controller.fingerprint({ ...current, key: "another" }));
  assert.notEqual(controller.fingerprint(current), controller.fingerprint({ ...current, url: "https://news.example/other" }));
  assert.notEqual(controller.fingerprint(current), sitePreviewFingerprint(current, String, "visual"));
}

async function testStalePreviewStillInvalidates() {
  let current = { key: "article", url: "https://news.example/story", title: "Original" };
  let resolve;
  const images = [];
  const controller = createSitePreviewController({
    isEnabled: () => true, isHttpUrl: () => true, normalizeUrl: String, profileForItem: () => "article",
    apiGet: () => new Promise(done => { resolve = done; }),
    isCurrent: (_item, fingerprint) => controller.fingerprint(current) === fingerprint,
    onImage: (_item, imageUrl) => images.push(imageUrl),
  });
  const stale = controller.request(current);
  await Promise.resolve();
  current = { ...current, url: "https://news.example/replacement" };
  resolve({ imageUrl: "https://images.example/stale.jpg" });
  assert.equal(await stale, null, "a changed article URL must still reject stale image work");
  const invalidated = controller.request(current);
  await Promise.resolve();
  controller.invalidate();
  resolve({ imageUrl: "https://images.example/invalidated.jpg" });
  assert.equal(await invalidated, null, "permission/cache invalidation must still reject a pending preview");
  assert.deepEqual(images, []);
  assert.equal(controller.get(current), null);
}

function testRepeatedImageNotification() {
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  try {
    globalThis.document = { createElement: tag => element(tag) };
    const item = { key: "article", url: "https://news.example/story", summary: {} };
    const card = { dataset: { key: item.key, previewFingerprint: "current" }, classList: { remove() {}, add() {} }, querySelector: () => thumb };
    const view = createSummaryImageThumbs({
      els: { summaryGrid: { querySelectorAll: () => [card] } }, faviconUrl: () => "favicon.svg", itemUrl: item => item.url,
      newsPreviews: { get: () => ({ imageUrl: "https://images.example/current.jpg" }), isRejected: () => false },
    });
    const thumb = view.createSummaryThumb(item);
    thumb.closest = () => card;
    const image = thumb.firstElementChild;
    image.classList.remove("is-preview-image-pending");
    for (let count = 0; count < 3; count++) view.updateVisibleNewsThumbs(item, "https://images.example/current.jpg", "current");
    assert.equal(thumb.firstElementChild, image, "repeated callbacks for an unchanged image must preserve its decoded DOM node");
    assert.equal(image.classList.contains("is-preview-image-pending"), false, "repeated image callbacks must not hide the already painted image");
    view.updateVisibleNewsThumbs(item, "https://images.example/stale.jpg", "stale");
    assert.equal(thumb.firstElementChild, image, "callbacks for a stale fingerprint must be ignored");
    view.updateVisibleNewsThumbs(item, "https://images.example/replacement.jpg", "current");
    assert.notEqual(thumb.firstElementChild, image, "a genuinely changed image URL must still update");
    assert.equal(thumb.firstElementChild.src, "https://images.example/replacement.jpg");
  } finally {
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else delete globalThis.document;
  }
}

function element(tag) {
  let classes = new Set();
  return {
    tagName: tag.toUpperCase(), children: [], complete: false, naturalWidth: 0,
    get className() { return [...classes].join(" "); }, set className(value) { classes = new Set(value.split(/\s+/)); },
    classList: { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value) },
    get firstElementChild() { return this.children[0]; },
    replaceChildren(...children) { this.children = children; },
    querySelector: function () { return this.children[0] || null; },
    closest: () => null, dataset: {}, addEventListener() {},
    getAttribute(name) { return this[name] ?? null; }, setAttribute(name, value) { this[name] = value; },
  };
}

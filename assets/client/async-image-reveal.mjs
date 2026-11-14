const PENDING_CLASS = "is-preview-image-pending";
const REVEALING_CLASS = "is-preview-image-revealing";
const imageReveals = new WeakMap();

export function prepareImageForSnapshot(image) {
  return imageReveals.get(image)?.capture();
}

export function loadImageWithReveal(image, imageUrl, options = {}) {
  const isCurrent = typeof options.isCurrent === "function" ? options.isCurrent : () => true;
  const requestFrame = typeof options.requestFrame === "function" ? options.requestFrame : defaultRequestFrame;
  let settled = false;
  let cacheHit = false;
  let decoded = false;
  let immediate = false;
  let resolveReady;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  const reveal = () => {
    if (isCurrent()) image.classList.remove(PENDING_CLASS, REVEALING_CLASS);
  };
  imageReveals.set(image, { capture() {
    immediate = true;
    if (decoded) reveal();
    return { ready, release: () => { if (!decoded) immediate = false; } };
  } });

  const reject = () => {
    if (settled) return;
    settled = true;
    resolveReady();
    if (isCurrent()) options.onReject?.();
  };
  const accept = async () => {
    if (settled) return;
    if (!isCurrent()) {
      settled = true;
      resolveReady();
      return;
    }
    if (typeof options.validate === "function" && options.validate(image) === false) {
      reject();
      return;
    }
    settled = true;
    try { await image.decode?.(); } catch { /* A loaded image may still be painted if eager decode is unavailable. */ }
    decoded = true;
    resolveReady();
    if (!isCurrent()) return;
    if (immediate || (cacheHit && options.forceReveal !== true)) {
      reveal();
      return;
    }
    requestFrame(() => requestFrame(() => {
      if (!isCurrent()) return;
      if (immediate) { reveal(); return; }
      image.classList.remove(PENDING_CLASS);
      image.classList.add(REVEALING_CLASS);
    }));
  };

  image.classList.add(PENDING_CLASS);
  image.addEventListener("load", accept, { once: true });
  image.addEventListener("error", reject, { once: true });
  image.src = imageUrl;
  cacheHit = image.complete && image.naturalWidth > 0;
  if (cacheHit) queueMicrotask(accept);
}

function defaultRequestFrame(callback) {
  if (typeof globalThis.requestAnimationFrame === "function") return globalThis.requestAnimationFrame(callback);
  return globalThis.setTimeout(callback, 0);
}

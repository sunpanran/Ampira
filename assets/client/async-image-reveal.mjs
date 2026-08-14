const PENDING_CLASS = "is-preview-image-pending";
const REVEALING_CLASS = "is-preview-image-revealing";

export function loadImageWithReveal(image, imageUrl, options = {}) {
  const isCurrent = typeof options.isCurrent === "function" ? options.isCurrent : () => true;
  const requestFrame = typeof options.requestFrame === "function" ? options.requestFrame : defaultRequestFrame;
  let settled = false;
  let cacheHit = false;

  const reject = () => {
    if (settled) return;
    settled = true;
    if (isCurrent()) options.onReject?.();
  };
  const accept = async () => {
    if (settled) return;
    if (!isCurrent()) {
      settled = true;
      return;
    }
    if (typeof options.validate === "function" && options.validate(image) === false) {
      reject();
      return;
    }
    settled = true;
    try { await image.decode?.(); } catch { /* A loaded image may still be painted if eager decode is unavailable. */ }
    if (!isCurrent()) return;
    if (cacheHit && options.forceReveal !== true) {
      image.classList.remove(PENDING_CLASS);
      return;
    }
    requestFrame(() => requestFrame(() => {
      if (!isCurrent()) return;
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

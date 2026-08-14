import { browserImageMeetsProfileDimensions } from "./card-image-quality.mjs";
import { loadImageWithReveal } from "./async-image-reveal.mjs";
import { activeSummaryThumbSelector } from "./summary-thumb-transition.mjs";

export function createSummaryImageThumbs({ els, faviconUrl, itemUrl, newsPreviews }) {
  return { createSummaryThumb, updateVisibleNewsThumbs };

  function createSummaryThumb(item) {
    const thumb = document.createElement("div");
    const imageUrl = item.summary?.imageUrl || "";
    const imageUrls = [...new Set([imageUrl, ...(Array.isArray(item.summary?.imageUrls) ? item.summary.imageUrls : [])]
      .map((value) => String(value || "").trim())
      .filter((value) => value && !newsPreviews.isRejected(item, value)))];
    const fallbackUrl = faviconUrl({ ...item, url: itemUrl(item) });
    const preview = newsPreviews.get(item);

    if (preview?.imageUrl) {
      renderPreview(thumb, item, preview.imageUrl, fallbackUrl);
    } else if (imageUrls.length) {
      renderSource(thumb, item, imageUrls, fallbackUrl);
    } else {
      renderFavicon(thumb, fallbackUrl);
      applyResolved(thumb, item, fallbackUrl, newsPreviews.request(item));
    }
    return thumb;
  }

  function renderSource(thumb, item, imageUrls, fallbackUrl) {
    let imageIndex = 0;
    showImage();

    function showImage() {
      const currentUrl = imageUrls[imageIndex];
      renderImage(thumb, currentUrl, () => {
        newsPreviews.rejectUrl(item, currentUrl);
        imageIndex += 1;
        if (imageUrls[imageIndex]) return showImage();
        renderFavicon(thumb, fallbackUrl);
        applyResolved(thumb, item, fallbackUrl, newsPreviews.request(item));
      });
    }
  }

  function renderPreview(thumb, item, imageUrl, fallbackUrl, { forceReveal = false } = {}) {
    renderImage(thumb, imageUrl, () => {
      renderFavicon(thumb, fallbackUrl);
      applyResolved(thumb, item, fallbackUrl, newsPreviews.reject(item, imageUrl));
    }, { forceReveal });
  }

  function applyResolved(thumb, item, fallbackUrl, operation) {
    Promise.resolve(operation).then((preview) => {
      if (!preview?.imageUrl || !thumb.isConnected) return;
      const card = thumb.closest(".summary-card");
      if (card?.dataset.key !== item.key || card.dataset.previewFingerprint !== newsPreviews.fingerprint(item)) return;
      const currentImage = thumb.querySelector("img");
      if (!thumb.classList.contains("is-favicon-thumb") && currentImage?.src === preview.imageUrl) return;
      renderPreview(thumb, item, preview.imageUrl, fallbackUrl, { forceReveal: true });
    });
  }

  function renderImage(thumb, imageUrl, onError, { forceReveal = false } = {}) {
    thumb.className = "thumb";
    activeThumbCard(thumb)?.classList.remove("has-favicon-thumb");
    const img = document.createElement("img");
    let rejected = false;
    const rejectImage = () => {
      if (rejected || thumb.firstElementChild !== img) return;
      rejected = true;
      onError();
    };
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";
    thumb.replaceChildren(img);
    loadImageWithReveal(img, imageUrl, {
      forceReveal,
      isCurrent: () => thumb.firstElementChild === img,
      onReject: rejectImage,
      validate: (image) => browserImageMeetsProfileDimensions(image, "article"),
    });
  }

  function updateVisibleNewsThumbs(item, imageUrl, fingerprint) {
    for (const card of els.summaryGrid.querySelectorAll(".summary-card")) {
      if (card.dataset.key !== item.key || card.dataset.previewFingerprint !== fingerprint) continue;
      const thumb = card.querySelector(activeSummaryThumbSelector);
      if (thumb) renderPreview(thumb, item, imageUrl, faviconUrl({ ...item, url: itemUrl(item) }), { forceReveal: true });
    }
  }

  function renderFavicon(thumb, fallbackUrl) {
    const favicon = fallbackUrl || "favicon.svg";
    thumb.className = "thumb is-favicon-thumb";
    activeThumbCard(thumb)?.classList.add("has-favicon-thumb");
    const glow = document.createElement("img");
    glow.className = "thumb-favicon-glow";
    glow.src = favicon;
    glow.alt = "";
    glow.loading = "lazy";
    glow.referrerPolicy = "no-referrer";
    glow.setAttribute("aria-hidden", "true");
    glow.addEventListener("error", () => {
      if (glow.src.endsWith("/favicon.svg")) return;
      glow.src = "favicon.svg";
    }, { once: true });
    thumb.replaceChildren(glow);
  }

  function activeThumbCard(thumb) {
    if (thumb.dataset.summaryThumbPhase === "leaving") return null;
    return thumb.closest(".summary-card");
  }
}

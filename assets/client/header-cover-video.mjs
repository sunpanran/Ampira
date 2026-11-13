// Loaded only when a video cover is selected; image-only pages stay unchanged.
export function createHeaderVideoController(hero, { reveal, fallback }) {
  const image = hero.querySelector("img");
  const video = document.createElement("video");
  const motion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");
  let source = "";
  let failed = false;
  let suspended = false;
  let playing = false;
  let generation = 0;
  video.hidden = true;
  video.muted = true;
  video.defaultMuted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = "auto";
  video.disablePictureInPicture = true;
  video.setAttribute("aria-hidden", "true");
  video.setAttribute("tabindex", "-1");
  hero.insertBefore(video, image);
  video.addEventListener("loadeddata", ready);
  video.addEventListener("canplay", ready);
  video.addEventListener("error", () => { if (video.error && source && !failed) fail(); });
  document.addEventListener("visibilitychange", syncPlayback);
  motion?.addEventListener("change", syncPlayback);
  globalThis.addEventListener("pagehide", () => { suspended = true; syncPlayback(); });
  globalThis.addEventListener("pageshow", () => { suspended = false; syncPlayback(); });
  return { setSource };

  function setSource(value) {
    if (value === source) return;
    source = value;
    failed = false;
    generation += 1;
    release();
    hero.classList.remove("is-loaded");
    image.hidden = Boolean(source);
    if (!source) { setStatus(""); return; }
    const url = new URL(source);
    // A controlling extension worker strips remote credentials while preserving
    // the browser's original media request, including its Range header.
    const controlled = globalThis.location?.protocol === "chrome-extension:" && globalThis.navigator?.serviceWorker?.controller;
    video.crossOrigin = controlled || url.protocol === "blob:" || url.origin === globalThis.location?.origin ? null : "anonymous";
    video.hidden = false;
    video.src = source;
    setStatus("loading");
    syncPlayback();
  }

  function ready() {
    if (!source || failed || video.readyState < 2 || !video.videoWidth) return;
    reveal(hero, video);
    setStatus("ready");
    syncPlayback();
  }

  function syncPlayback() {
    if (!source || failed || suspended || document.hidden || motion?.matches || hero.hidden) {
      playing = false;
      video.pause();
      return;
    }
    if (playing) return;
    playing = true;
    const expected = generation;
    video.play().catch((error) => {
      if (expected !== generation) return;
      playing = false;
      if (error.name === "NotSupportedError") fail();
      // Autoplay may be denied by the browser; retain the decoded still frame.
    });
  }

  function fail() {
    failed = true;
    generation += 1;
    release();
    image.hidden = false;
    hero.classList.remove("is-loaded");
    fallback();
    setStatus("error");
  }

  function release() {
    playing = false;
    video.pause();
    video.hidden = true;
    if (video.hasAttribute("src")) {
      video.removeAttribute("src");
      video.load();
    }
  }

  function setStatus(value) {
    if (hero.dataset.headerVideoState === value) return;
    hero.dataset.headerVideoState = value;
    hero.dispatchEvent(new Event("headermediastatechange"));
  }
}

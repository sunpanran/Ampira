import { formatDateTime } from "./time.mjs";
import { faviconUrl, hostFromUrl, isReaderUrl } from "./urls.mjs";
import { readerErrorBodyKey, readerErrorTitleKey, safeReaderOrigin, sameOrigin } from "./reader-policy.mjs";

const READER_CLOSE_MOTION_MS = 180;

export function createReaderController(context) {
  const {
    state,
    els,
    t,
    apiGet,
    apiPost,
    markOpenedItem,
    renderEfficiencyPanel,
    syncNavToCurrentSection,
    toggleSeen,
    actionKey,
    defaultSeenSource,
    localizedErrorMessage,
  } = context;
  let readerRequestGeneration = 0;
  let readerCloseTimer = 0;
  let readerTranslation = null;

  function openExternal(url, title = "", item = null) {
    markReadOnOpen(item);
    if (shouldOpenInFloatingFrame(url)) {
      openFloatingWeb(url, title, item);
      return;
    }
    if (item) markOpenedItem(item);
    openExternalWindow(url);
  }

  function markReadOnOpen(item) {
    if (!item) return;
    const key = actionKey(item);
    if (!key || state.seen.has(key)) return;
    toggleSeen(item, true, defaultSeenSource(item));
  }

  function openExternalWindow(url) {
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function shouldOpenInFloatingFrame(url) {
    return isReaderUrl(url) && state.settings?.floatingWebOpenEnabled === true;
  }

  async function openFloatingWeb(url, title = "", item = null, options = {}) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      if (item) markOpenedItem(item);
      openExternalWindow(url);
      return;
    }
    if (readerCloseTimer) window.clearTimeout(readerCloseTimer);
    readerCloseTimer = 0;
    els.webFrameOverlay.classList.remove("closing");
    const requestGeneration = ++readerRequestGeneration;
    if (!options.preserveHistory) state.webFrameHistory = [];
    clearFloatingReadTracking();
    state.webFrameUrl = parsed.href;
    state.webFrameItem = item;
    state.webFrameResult = null;
    readerTranslation = null;
    syncReaderTranslateButton();
    syncReaderBackButton();
    els.webFrameFavicon.src = faviconUrl({ url: parsed.href, host: parsed.hostname.replace(/^www\./, "") });
    els.webFrameTitle.textContent = title || parsed.hostname.replace(/^www\./, "") || t("webFrame.page");
    els.webFrameUrl.textContent = parsed.href;
    els.webFrameOverlay.classList.add("open");
    document.body.classList.add("web-frame-open");
    els.webFrame.classList.add("is-loading");
    els.webFrame.textContent = t("webFrame.loading");
    els.closeWebFrame.focus();
    try {
      const result = await apiGet(`/api/reader?url=${encodeURIComponent(parsed.href)}`);
      if (requestGeneration !== readerRequestGeneration) return;
      renderReaderResult(result, title, item);
    } catch (error) {
      if (requestGeneration !== readerRequestGeneration) return;
      renderReaderError(error, parsed.href, title);
    }
  }

  function renderReaderResult(result, fallbackTitle = "", item = null, scrollTop = 0, options = {}) {
    const currentUrl = result.url || result.requestedUrl || state.webFrameUrl;
    state.webFrameUrl = currentUrl;
    state.webFrameItem = item;
    state.webFrameResult = result;
    if (!options.preserveTranslation) readerTranslation = null;
    els.webFrameTitle.textContent = result.title || fallbackTitle || hostFromUrl(currentUrl) || t("webFrame.page");
    els.webFrameUrl.textContent = currentUrl;
    els.webFrameFavicon.src = faviconUrl({ url: currentUrl, host: hostFromUrl(currentUrl) });
    els.webFrame.classList.remove("is-loading", "is-error");
    const documentShell = document.createElement("div");
    documentShell.className = "reader-document";
    documentShell.append(createReaderHeader(result));
    const content = document.createElement("div");
    content.className = "reader-content";
    for (const block of result.blocks || []) {
      const element = createReaderBlock(block, result);
      if (element) content.append(element);
    }
    if (!content.childElementCount) {
      const empty = document.createElement("p");
      empty.className = "reader-empty";
      empty.textContent = t("reader.noContent");
      content.append(empty);
    }
    documentShell.append(content);
    els.webFrame.replaceChildren(documentShell);
    els.webFrame.scrollTop = scrollTop;
    if (item) markOpenedItem(item);
    renderEfficiencyPanel();
    syncReaderBackButton();
    syncReaderTranslateButton();
    startFloatingReadTracking();
  }

  function createReaderHeader(result) {
    const header = document.createElement("header");
    header.className = "reader-header";
    const site = document.createElement("div");
    site.className = "reader-site";
    site.textContent = result.siteName || hostFromUrl(result.url || "") || t("webFrame.page");
    const title = document.createElement("h1");
    title.className = "reader-title";
    title.textContent = result.title || t("webFrame.page");
    header.append(site, title);
    const metaValues = [];
    if (result.byline) metaValues.push(result.byline);
    if (result.publishedAt) metaValues.push(formatDateTime(result.publishedAt));
    if (result.readingMinutes) metaValues.push(t("reader.readingMinutes", { count: result.readingMinutes }));
    if (result.wordCount) metaValues.push(t("reader.wordCount", { count: result.wordCount }));
    if (metaValues.length) {
      const meta = document.createElement("div");
      meta.className = "reader-meta";
      meta.textContent = metaValues.join(" · ");
      header.append(meta);
    }
    const notices = document.createElement("div");
    notices.className = "reader-notices";
    if (result.source === "cache") notices.append(createReaderNotice("cache", t("reader.cached", { time: result.fetchedAt ? formatDateTime(result.fetchedAt) : t("reader.unknownTime"), reason: readerStaleReason(result) })));
    if (result.truncated) notices.append(createReaderNotice("warning", t("reader.truncated")));
    if (result.quality === "partial") notices.append(createReaderNotice("warning", t("reader.partial")));
    if (notices.childElementCount) header.append(notices);
    return header;
  }

  function createReaderNotice(kind, text) {
    const notice = document.createElement("div");
    notice.className = `reader-notice is-${kind}`;
    notice.textContent = text;
    return notice;
  }

  function createReaderBlock(block, result) {
    if (block.type === "heading") {
      const heading = document.createElement(block.level === 3 ? "h3" : "h2");
      heading.className = "reader-section-title";
      appendReaderRuns(heading, block.runs, result);
      return heading;
    }
    if (block.type === "paragraph") {
      const paragraph = document.createElement("p");
      appendReaderRuns(paragraph, block.runs, result);
      return paragraph;
    }
    if (block.type === "list") {
      const list = document.createElement(block.ordered ? "ol" : "ul");
      for (const runs of block.items || []) {
        const item = document.createElement("li");
        appendReaderRuns(item, runs, result);
        list.append(item);
      }
      return list;
    }
    if (block.type === "quote") {
      const quote = document.createElement("blockquote");
      quote.textContent = block.text || "";
      return quote;
    }
    if (block.type === "code") {
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.textContent = block.text || "";
      pre.append(code);
      return pre;
    }
    if (block.type === "image") return createReaderImage(block, result);
    if (block.type === "video") return createReaderVideo(block, result);
    return null;
  }

  function appendReaderRuns(container, runs, result) {
    for (const run of runs || []) {
      if (!run?.href) {
        container.append(document.createTextNode(run?.text || ""));
        continue;
      }
      const anchor = document.createElement("a");
      anchor.href = run.href;
      anchor.rel = "noreferrer";
      anchor.textContent = run.text || run.href;
      anchor.addEventListener("click", (event) => {
        event.preventDefault();
        if (sameOrigin(run.href, result.url || state.webFrameUrl)) {
          navigateReaderLink(run.href, anchor.textContent);
          return;
        }
        openExternalWindow(run.href);
      });
      container.append(anchor);
    }
  }

  function createReaderImage(block, result) {
    const figure = document.createElement("figure");
    figure.className = "reader-media reader-image";
    const media = document.createElement("div");
    media.className = "reader-image-media";
    const image = document.createElement("img");
    const imageUrls = [...new Set((Array.isArray(block.imageUrls) ? block.imageUrls : [block.url])
      .map((value) => String(value || "").trim()).filter(Boolean))];
    let imageIndex = 0;
    image.src = imageUrls[imageIndex] || block.url;
    image.alt = block.alt || "";
    image.loading = "lazy";
    image.decoding = "async";
    image.referrerPolicy = "no-referrer";
    image.addEventListener("error", () => {
      imageIndex += 1;
      if (imageUrls[imageIndex]) {
        image.src = imageUrls[imageIndex];
        return;
      }
      const fallback = document.createElement("button");
      fallback.type = "button";
      fallback.className = "reader-media-fallback";
      fallback.textContent = t("reader.imageFailed");
      fallback.addEventListener("click", () => openExternalWindow(result.url || state.webFrameUrl));
      media.replaceChildren(fallback);
    });
    media.append(image);
    figure.append(media);
    if (block.caption) {
      const caption = document.createElement("figcaption");
      caption.textContent = block.caption;
      figure.append(caption);
    }
    return figure;
  }

  function createReaderVideo(block, result) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "reader-media reader-video";
    if (block.posterUrl) {
      const poster = document.createElement("img");
      poster.src = block.posterUrl;
      poster.alt = "";
      poster.loading = "lazy";
      poster.decoding = "async";
      poster.referrerPolicy = "no-referrer";
      poster.addEventListener("error", () => poster.remove(), { once: true });
      card.append(poster);
    }
    const copy = document.createElement("span");
    copy.className = "reader-video-copy";
    const title = document.createElement("strong");
    title.textContent = block.title || t("reader.video");
    const action = document.createElement("span");
    action.textContent = t("reader.playOnSource");
    copy.append(title, action);
    card.append(copy);
    card.addEventListener("click", () => openExternalWindow(block.externalUrl || result.url || state.webFrameUrl));
    return card;
  }

  function renderReaderError(error, url, fallbackTitle = "") {
    state.webFrameResult = null;
    els.webFrameTitle.textContent = fallbackTitle || hostFromUrl(url) || t("webFrame.page");
    els.webFrameUrl.textContent = url;
    els.webFrame.classList.remove("is-loading");
    els.webFrame.classList.add("is-error");
    const stateView = document.createElement("div");
    stateView.className = "reader-state";
    const code = document.createElement("div");
    code.className = "reader-state-code";
    code.textContent = error?.code || "READER_ERROR";
    const title = document.createElement("h2");
    title.textContent = readerErrorTitle(error);
    const body = document.createElement("p");
    body.textContent = readerErrorMessage(error);
    const actions = document.createElement("div");
    actions.className = "reader-state-actions";
    if (error?.code === "ORIGIN_PERMISSION_REQUIRED") {
      const authorize = readerActionButton(t("reader.authorize"), "primary", () => authorizeReaderOrigin(error, authorize));
      actions.append(authorize);
    }
    actions.append(
      readerActionButton(t("action.reload"), "ghost", reloadFloatingWeb),
      readerActionButton(t("action.openExternal"), "ghost", () => {
        if (state.webFrameItem) markOpenedItem(state.webFrameItem);
        openExternalWindow(state.webFrameUrl);
      }),
    );
    stateView.append(code, title, body, actions);
    els.webFrame.replaceChildren(stateView);
    syncReaderBackButton();
  }

  function readerActionButton(label, className, action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `btn ${className}`;
    button.textContent = label;
    button.addEventListener("click", action);
    return button;
  }

  async function authorizeReaderOrigin(error, button) {
    const origin = error?.details?.origin || safeReaderOrigin(error?.details?.url || state.webFrameUrl);
    if (!origin || !globalThis.chrome?.permissions?.request) return;
    button.disabled = true;
    try {
      const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
      if (granted) reloadFloatingWeb();
      else button.textContent = t("reader.authorizationDeclined");
    } catch {
      button.textContent = t("reader.authorizationDeclined");
    } finally {
      button.disabled = false;
    }
  }

  function readerErrorTitle(error) {
    return t(readerErrorTitleKey(error?.code));
  }

  function readerErrorMessage(error) {
    const key = readerErrorBodyKey(error?.code);
    return key ? t(key, { status: error?.details?.status || "—" }) : t("reader.error.genericBody", { message: localizedErrorMessage(error) });
  }

  function readerStaleReason(result) {
    const error = { code: result.staleCode, message: result.staleReason, details: result.staleDetails || {} };
    return readerErrorMessage(error);
  }

  function navigateReaderLink(url, title = "") {
    if (state.webFrameResult) {
      state.webFrameHistory.push({
        result: state.webFrameResult,
        title: els.webFrameTitle.textContent,
        item: state.webFrameItem,
        scrollTop: els.webFrame.scrollTop,
      });
    }
    openFloatingWeb(url, title, null, { preserveHistory: true });
  }

  function backFloatingWeb() {
    const previous = state.webFrameHistory.pop();
    if (!previous) return;
    readerRequestGeneration += 1;
    renderReaderResult(previous.result, previous.title, previous.item, previous.scrollTop);
  }

  function syncReaderBackButton() {
    els.backWebFrame.disabled = !state.webFrameHistory.length;
  }

  function syncReaderTranslateButton() {
    const available = state.data?.ai?.enabled === true && Boolean(state.webFrameResult);
    els.translateWebFrame.hidden = !available;
    els.translateWebFrame.disabled = false;
    els.translateWebFrame.textContent = t(readerTranslation?.showing ? "reader.showOriginal" : "reader.translate");
  }

  async function toggleReaderTranslation() {
    if (readerTranslation?.showing) {
      const saved = readerTranslation;
      renderReaderResult(saved.original, "", state.webFrameItem, els.webFrame.scrollTop, { preserveTranslation: true });
      readerTranslation = { ...saved, showing: false };
      syncReaderTranslateButton();
      return;
    }
    if (readerTranslation?.translated) {
      const saved = readerTranslation;
      renderTranslatedReader(saved.translated, saved.original);
      readerTranslation = { ...saved, showing: true };
      syncReaderTranslateButton();
      return;
    }
    const original = state.webFrameResult;
    if (!original) return;
    els.translateWebFrame.disabled = true;
    els.translateWebFrame.textContent = t("reader.translating");
    try {
      const text = readerPlainText(original);
      const translated = await apiPost("/api/reader/translate", {
        url: original.url || state.webFrameUrl,
        title: original.title || "",
        text,
      });
      readerTranslation = { original, translated, showing: true };
      renderTranslatedReader(translated, original);
    } catch (error) {
      els.translateWebFrame.textContent = localizedErrorMessage(error);
      window.setTimeout(syncReaderTranslateButton, 2200);
    } finally {
      els.translateWebFrame.disabled = false;
    }
  }

  function readerPlainText(result) {
    return (result.blocks || []).map((block) => {
      if (block.type === "list") return (block.items || []).map((runs) => (runs || []).map((run) => run?.text || "").join("")).join("\n");
      if (block.runs) return block.runs.map((run) => run?.text || "").join("");
      return block.text || block.caption || "";
    }).filter(Boolean).join("\n\n");
  }

  function renderTranslatedReader(translated, original) {
    const result = {
      ...original,
      title: translated.title || original.title,
      blocks: String(translated.text || "").split(/\n{2,}/).filter(Boolean).map((text) => ({ type: "paragraph", runs: [{ text }] })),
    };
    renderReaderResult(result, "", state.webFrameItem, 0, { preserveTranslation: true });
  }

  function closeFloatingWeb() {
    if (!els.webFrameOverlay.classList.contains("open") || els.webFrameOverlay.classList.contains("closing")) return;
    readerRequestGeneration += 1;
    clearFloatingReadTracking();
    els.webFrameOverlay.classList.add("closing");
    const closeDelay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : READER_CLOSE_MOTION_MS;
    readerCloseTimer = window.setTimeout(() => {
      readerCloseTimer = 0;
      finalizeFloatingWebClose();
    }, closeDelay);
  }

  function finalizeFloatingWebClose() {
    els.webFrameOverlay.classList.remove("open", "closing");
    document.body.classList.remove("web-frame-open");
    els.webFrame.replaceChildren();
    els.webFrame.classList.remove("is-loading", "is-error");
    els.webFrameFavicon.src = "favicon.svg";
    state.webFrameUrl = "";
    state.webFrameItem = null;
    state.webFrameResult = null;
    readerTranslation = null;
    state.webFrameHistory = [];
    syncReaderBackButton();
    syncNavToCurrentSection();
  }

  function reloadFloatingWeb() {
    if (!state.webFrameUrl) return;
    openFloatingWeb(state.webFrameUrl, els.webFrameTitle.textContent, state.webFrameItem, { preserveHistory: true });
  }

  function startFloatingReadTracking() {
    clearFloatingReadTracking();
    if (!state.webFrameItem || state.seen.has(actionKey(state.webFrameItem))) return;
    state.webFrameActiveMs = 0;
    state.webFrameLastActiveAt = performance.now();
    state.webFrameProgressTimer = window.setInterval(checkFloatingReadProgress, 1000);
  }

  function checkFloatingReadProgress() {
    const item = state.webFrameItem;
    if (!item) return clearFloatingReadTracking();
    const now = performance.now();
    const elapsed = Math.min(2000, Math.max(0, now - state.webFrameLastActiveAt));
    state.webFrameLastActiveAt = now;
    if (document.visibilityState === "visible" && els.webFrameOverlay.classList.contains("open")) state.webFrameActiveMs += elapsed;
    if (state.webFrameActiveMs < 20000) return;
    const scrolling = els.webFrame;
    const height = Math.max(1, Number(scrolling.scrollHeight || 0));
    const progress = Math.min(1, (Number(scrolling.scrollTop || 0) + Number(scrolling.clientHeight || 0)) / height);
    if (progress < 0.6) return;
    clearFloatingReadTracking();
    toggleSeen(item, true, defaultSeenSource(item));
  }

  function clearFloatingReadTracking() {
    if (state.webFrameReadTimer) clearTimeout(state.webFrameReadTimer);
    if (state.webFrameProgressTimer) clearInterval(state.webFrameProgressTimer);
    state.webFrameReadTimer = 0;
    state.webFrameProgressTimer = 0;
    state.webFrameActiveMs = 0;
    state.webFrameLastActiveAt = 0;
  }
  return {
    backFloatingWeb,
    closeFloatingWeb,
    openExternal,
    openExternalWindow,
    reloadFloatingWeb,
    toggleReaderTranslation,
  };
}

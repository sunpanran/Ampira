import { cardIconName, cardTone } from "./card-policy.mjs";

export function createDailyCardView(options) {
  const {
    state, els, t, itemUrl, displayTitle, displaySummaryTitle, createIcon,
    createReadingActions, createBookmarkFavicon, contextAttachLink, openDailyItem,
    createSeenButton, localizedCategory, inspirationPreviews, faviconUrl,
    isHttpUrl, hostFromUrl, openExternal, displayBookmarkTitle, isNewsCard,
    isInspirationCard, setCardItemIdentity,
  } = options;
  let newsTitleReveal = null;
  let activeNewsTitle = null;

  return {
    activateCardFromKeyboard,
    createNewsListCard,
    createDailyCard,
    preloadBrowserImage,
    updateVisibleInspirationThumbs,
    createArchiveCard,
  };

function activateCardFromKeyboard(event, action) {
  if (event.target !== event.currentTarget) return;
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  action();
}

function createNewsListCard(item) {
  const cardTitle = displaySummaryTitle(item);
  const card = document.createElement("article");
  card.className = `news-list-card link-row ${state.seen.has(item.key) ? "seen" : (state.opened.has(item.key) ? "opened" : "")}`;
  setCardItemIdentity(card, item);
  card.tabIndex = 0;
  card.setAttribute("role", "link");
  card.setAttribute("aria-label", t("card.openNews", { title: cardTitle }));
  card.addEventListener("click", () => openDailyItem(item));
  card.addEventListener("keydown", (event) => {
    activateCardFromKeyboard(event, () => openDailyItem(item));
  });
  contextAttachLink(card, () => ({ url: itemUrl(item), title: cardTitle, item }));
  const main = document.createElement("div");
  main.className = "link-main";
  const title = document.createElement("span");
  title.className = "link-title news-list-title";
  title.textContent = cardTitle;
  attachNewsTitleReveal(card, title, cardTitle);
  const meta = document.createElement("div");
  meta.className = "link-host";
  meta.textContent = newsListMetaText(item);
  const actions = document.createElement("div");
  actions.className = "news-list-actions";
  actions.append(
    createReadingActions(item, { source: "news", compact: true, includeRead: false }),
    createSeenButton(item, t("action.markSeen"), t("action.unmarkSeen"), "news"),
  );
  main.append(title, meta);
  card.append(
    createBookmarkFavicon({ ...item, url: itemUrl(item) }),
    main,
    actions,
  );
  return card;
}

function attachNewsTitleReveal(card, title, cardTitle) {
  title.addEventListener("pointerenter", (event) => {
    if (event.pointerType === "touch") return;
    showNewsTitleReveal(title, cardTitle);
  });
  title.addEventListener("pointerleave", () => {
    if (activeNewsTitle === title) hideNewsTitleReveal();
  });
  card.addEventListener("focus", () => showNewsTitleReveal(title, cardTitle));
  card.addEventListener("blur", () => {
    if (activeNewsTitle === title) hideNewsTitleReveal();
  });
}

function showNewsTitleReveal(title, cardTitle) {
  if (!title.isConnected || title.scrollWidth <= title.clientWidth + 1) {
    if (activeNewsTitle === title) hideNewsTitleReveal();
    return;
  }
  const rect = title.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const reveal = ensureNewsTitleReveal();
  const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
  const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
  const viewportInset = 8;
  const width = Math.min(
    Math.max(rect.width + 12, Math.min(320, viewportWidth - viewportInset * 2)),
    480,
    viewportWidth - viewportInset * 2,
  );
  const left = Math.min(
    Math.max(rect.left - 6, viewportInset),
    viewportWidth - width - viewportInset,
  );
  reveal.textContent = cardTitle;
  reveal.style.width = `${width}px`;
  reveal.style.left = `${left}px`;
  reveal.style.top = `${rect.top - 5}px`;
  reveal.classList.toggle("is-seen", Boolean(title.closest(".seen")));
  reveal.classList.remove("is-visible", "is-above");
  const revealHeight = reveal.offsetHeight;
  const opensAbove = rect.top - 5 + revealHeight > viewportHeight - viewportInset;
  const top = opensAbove
    ? Math.max(viewportInset, rect.bottom + 5 - revealHeight)
    : Math.max(viewportInset, rect.top - 5);
  reveal.style.top = `${top}px`;
  reveal.classList.toggle("is-above", opensAbove);
  activeNewsTitle = title;
  void reveal.offsetWidth;
  reveal.classList.add("is-visible");
}

function ensureNewsTitleReveal() {
  if (newsTitleReveal?.isConnected) return newsTitleReveal;
  newsTitleReveal = document.createElement("div");
  newsTitleReveal.className = "news-title-reveal";
  newsTitleReveal.setAttribute("aria-hidden", "true");
  document.body.append(newsTitleReveal);
  window.addEventListener("scroll", hideNewsTitleReveal, { capture: true, passive: true });
  window.addEventListener("resize", hideNewsTitleReveal, { passive: true });
  document.addEventListener("visibilitychange", hideNewsTitleReveal);
  return newsTitleReveal;
}

function hideNewsTitleReveal() {
  activeNewsTitle = null;
  newsTitleReveal?.classList.remove("is-visible");
}

function newsListMetaText(item) {
  return [item.externalDiscovery
    ? t("category.externalDiscovery")
    : item.timeUnverified ? t("category.timeUnverified") : localizedCategory(item), item.host || item.url].filter(Boolean).join(" · ");
}

function createDailyCard(item) {
  const cardTitle = isNewsCard(item) ? displaySummaryTitle(item) : displayTitle(item);
  const card = document.createElement("article");
  card.className = `daily-card ${state.seen.has(item.key) ? "seen" : (state.opened.has(item.key) ? "opened" : "")}`;
  setCardItemIdentity(card, item);
  card.tabIndex = 0;
  card.setAttribute("role", "link");
  card.setAttribute("aria-label", t("card.openEntry", { title: cardTitle }));
  card.title = isNewsCard(item) ? cardTitle : itemUrl(item);
  card.addEventListener("click", () => openDailyItem(item));
  card.addEventListener("keydown", (event) => {
    activateCardFromKeyboard(event, () => openDailyItem(item));
  });
  contextAttachLink(card, () => ({ url: itemUrl(item), title: cardTitle, item }));
  const top = document.createElement("div");
  top.className = "daily-top";
  const pill = document.createElement("span");
  pill.className = `pill ${cardTone(item)}`;
  const pillLabel = item.externalDiscovery
    ? t("category.externalDiscovery")
    : item.timeUnverified ? t("category.timeUnverified") : localizedCategory(item);
  pill.append(createIcon(cardIconName(item), "pill-icon"), document.createTextNode(pillLabel));
  top.append(pill);
  const title = document.createElement("span");
  title.className = "item-title";
  title.textContent = cardTitle;
  const host = document.createElement("span");
  host.className = "item-host";
  host.textContent = item.host || item.url;
  if (isInspirationCard(item)) {
    card.classList.add("has-inspiration-thumb");
    card.dataset.previewFingerprint = inspirationPreviews.fingerprint(item);
    card.append(top, title, host, createInspirationThumb(item));
  } else {
    card.append(top, title, host);
  }
  return card;
}

function createInspirationThumb(item) {
  const thumb = document.createElement("div");
  thumb.className = "inspiration-thumb";
  const preview = inspirationPreviews.get(item);
  const imageUrl = preview?.imageUrl || "";
  if (imageUrl) renderInspirationImageThumb(thumb, item, imageUrl);
  else {
    renderInspirationFallbackThumb(thumb, item);
    requestInspirationPreview(item);
  }
  return thumb;
}

function renderInspirationImageThumb(thumb, item, imageUrl) {
  thumb.className = "inspiration-thumb";
  const img = document.createElement("img");
  img.src = imageUrl;
  img.alt = "";
  img.loading = "eager";
  img.decoding = "async";
  img.fetchPriority = "high";
  img.referrerPolicy = "no-referrer";
  img.addEventListener("error", () => {
    inspirationPreviews.reject(item, imageUrl);
    renderInspirationFallbackThumb(thumb, item);
  }, { once: true });
  thumb.replaceChildren(img);
}

function preloadBrowserImage(imageUrl) {
  if (typeof Image !== "function" || !isHttpUrl(imageUrl)) return Promise.resolve(false);
  return new Promise((resolve) => {
    const image = new Image();
    let settled = false;
    const finish = (loaded) => {
      if (settled) return;
      settled = true;
      resolve(loaded);
    };
    image.decoding = "async";
    image.fetchPriority = "high";
    image.referrerPolicy = "no-referrer";
    image.addEventListener("load", async () => {
      try { await image.decode?.(); } catch { /* A loaded image remains cacheable if decode is deferred. */ }
      finish(true);
    }, { once: true });
    image.addEventListener("error", () => finish(false), { once: true });
    image.src = imageUrl;
  });
}

function renderInspirationFallbackThumb(thumb, item) {
  const fallback = faviconUrl(item) || "favicon.svg";
  thumb.className = "inspiration-thumb is-fallback";
  const glow = document.createElement("img");
  glow.className = "inspiration-favicon-glow";
  glow.src = fallback;
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

function requestInspirationPreview(item) {
  inspirationPreviews.request(item);
}

function updateVisibleInspirationThumbs(item, imageUrl, fingerprint) {
  for (const card of els.dailyBoard.querySelectorAll(".daily-card.has-inspiration-thumb")) {
    if (card.dataset.key !== item.key || card.dataset.previewFingerprint !== fingerprint) continue;
    const thumb = card.querySelector(".inspiration-thumb");
    if (thumb) renderInspirationImageThumb(thumb, item, imageUrl);
  }
}

function createArchiveCard(item) {
  const titleText = archiveDisplayTitle(item);
  const url = archiveItemUrl(item);
  const card = document.createElement("article");
  card.className = "daily-card archive-card link-row seen";
  setCardItemIdentity(card, item);
  card.tabIndex = 0;
  card.setAttribute("role", "link");
  card.setAttribute("aria-label", t("card.openArchive", { title: titleText }));
  card.title = archiveSource(item) === "news" ? titleText : url;
  card.addEventListener("click", () => openExternal(url, titleText));
  card.addEventListener("keydown", (event) => {
    activateCardFromKeyboard(event, () => openExternal(url, titleText));
  });
  contextAttachLink(card, () => ({ url, title: titleText }));
  const main = document.createElement("div");
  main.className = "link-main";
  const title = document.createElement("span");
  title.className = "link-title archive-title";
  title.textContent = titleText;
  const meta = document.createElement("span");
  meta.className = "link-host archive-host";
  meta.textContent = archiveMetaText(item, url);
  main.append(title, meta);
  card.append(createBookmarkFavicon({ ...item, url }), main, createSeenButton(item, t("action.markSeen"), t("action.removeArchive"), archiveSource(item)));
  return card;
}

function archiveMetaText(item, url) {
  return [archivePillText(item), hostFromUrl(url)].filter(Boolean).join(" · ");
}

function archiveDisplayTitle(item) {
  if (archiveSource(item) === "news") return displaySummaryTitle(item);
  return displayBookmarkTitle(item);
}

function archiveItemUrl(item) {
  if (archiveSource(item) === "news") return itemUrl(item);
  return item.url || item.seenUrl || itemUrl(item);
}

function archivePillText(item) {
  if (archiveSource(item) === "bookmark" && isNewsCard(item)) return t("category.website");
  return localizedCategory(item) || item.section || t("category.seen");
}

function archiveSource(item) {
  return item.seenSource === "news" ? "news" : "bookmark";
}
}

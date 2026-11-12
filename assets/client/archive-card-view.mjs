import { spanText } from "./dom.mjs";
import { fadeElementsOut } from "./motion.mjs";

export function createArchiveCardView({ state, t, createEmptyState, createArchiveCard, setIconLabel,
  confirmAction, persistSeen, renderAll, newsSummaryItems, hostFromUrl, newsSectionName, newsCardType, isNewsCard }) {
  let confirming = false;
  return { render };

  function render() {
    const items = seenArchiveItems();
    const content = document.createElement("div");
    content.className = "card-list";
    const actions = [];
    if (items.length) {
      content.append(...items.map(createArchiveCard));
      const clear = document.createElement("button");
      clear.type = "button";
      clear.className = "column-action";
      setIconLabel(clear, "trash-01", t("action.clear"), "inline-icon", "btn-label");
      clear.addEventListener("click", async () => {
        if (confirming) return;
        confirming = true;
        try { await clearSeenArchive(); } finally { confirming = false; }
      });
      actions.push(clear);
    } else {
      content.classList.add("is-empty");
      content.append(createEmptyState({ title: t("daily.empty.archiveTitle"), body: t("daily.empty.archiveBody"), variant: "compact" }));
    }
    return { content, actions, meta: items.length ? spanText(String(items.length), "count") : null };
  }

  async function clearSeenArchive() {
    if (!state.seen.size) return;
    if (!await confirmAction({
      kicker: t("confirmation.clearArchive.kicker"),
      title: t("confirmation.clearArchive.title"),
      body: t("confirmation.clearArchive.body"),
      cancelLabel: t("confirmation.clearArchive.cancel"),
      confirmLabel: t("confirmation.clearArchive.confirm"),
      tone: "danger",
    })) return;
    state.seen.clear();
    state.seenMeta.clear();
    persistSeen();
    if (!fadeElementsOut(document.querySelectorAll(".archive-card"), renderAll)) renderAll();
  }
  function seenArchiveItems() {
    const byKey = new Map(displayArchiveItems().map((item) => [item.key, item]));
    return Array.from(state.seen)
      .map((key) => archiveItemForSeenKey(key, byKey.get(key)))
      .filter(Boolean);
  }

  function displayArchiveItems() {
    const bookmarks = state.data?.bookmarks || [];
    return [
      ...bookmarks,
      ...newsSummaryItems(false).filter((item) => item.sourceKey),
    ];
  }

  function archiveItemForSeenKey(key, item) {
    const meta = state.seenMeta.get(key) || {};
    if (!item && !meta.title && !meta.url) return null;
    return {
      ...(item || fallbackArchiveItem(key, meta)),
      key,
      seenSource: meta.source || inferArchiveSource(item),
      seenTitle: meta.title || "",
      seenUrl: meta.url || "",
    };
  }

  function fallbackArchiveItem(key, meta) {
    const url = meta.url || "";
    const isNews = meta.source === "news";
    return {
      key,
      title: meta.title || hostFromUrl(url) || url || key,
      url,
      host: hostFromUrl(url),
      section: isNews ? newsSectionName() : t("nav.bookmarks"),
      category: isNews ? t("category.news") : t("category.website"),
      cardType: isNews ? newsCardType : "",
    };
  }

  function inferArchiveSource(item) {
    return item?.sourceKey || isNewsCard(item) ? "news" : "bookmark";
  }

}

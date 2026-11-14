import { hostFromUrl } from "./urls.mjs";
import { fadeElementsOut } from "./motion.mjs";

const NEWS_CARD_TYPE = "news";

export function createArchiveCardView({ state, t, createEmptyState, createArchiveCard, setIconLabel,
  confirmAction, persistSeen, renderAll, newsSummaryItems, newsSectionName, isNewsCard, attachMenuButton }) {
  let confirming = false;
  const menuButtons = new Map();
  return { render };

  function render(instanceId = "archive") {
    const items = seenArchiveItems();
    const content = document.createElement("div");
    content.className = "card-list";
    const actions = [];
    if (items.length) {
      content.append(...items.map(createArchiveCard));
      let more = menuButtons.get(instanceId);
      if (!more) {
        more = document.createElement("button");
        more.type = "button";
        more.className = "action-toggle archive-more";
        attachMenuButton(more, () => [{
          label: t("action.clearArchive"), icon: "trash-01", tone: "danger",
          action: async () => {
            if (confirming) return;
            confirming = true;
            try { await clearSeenArchive(); } finally { confirming = false; }
          },
        }]);
        menuButtons.set(instanceId, more);
      }
      const label = t("action.archiveMore");
      if (more.title !== label) {
        more.title = label;
        more.setAttribute("aria-label", label);
        setIconLabel(more, "more-horizontal", label, "action-toggle-icon", "sr-only");
      }
      actions.push(more);
    } else {
      content.classList.add("is-empty");
      content.append(createEmptyState({ title: t("daily.empty.archiveTitle"), variant: "compact" }));
    }
    return { content, actions };
  }

  async function clearSeenArchive() {
    if (!state.seen.size) return;
    if (!await confirmAction({
      kicker: t("confirmation.clearArchive.kicker"),
      title: t("confirmation.clearArchive.title"),
      body: t("confirmation.clearArchive.body", { count: seenArchiveItems().length }),
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
      cardType: isNews ? NEWS_CARD_TYPE : "",
    };
  }

  function inferArchiveSource(item) {
    return item?.sourceKey || isNewsCard(item) ? "news" : "bookmark";
  }

}

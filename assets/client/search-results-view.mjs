import { createThemedIcon } from "./icons.mjs";
import { faviconUrl } from "./urls.mjs";

// Keep row and image identities stable while a new query is being resolved.
export function createSearchResultsView({ list, t, onSelect, doc = document,
  icon = createThemedIcon, getFaviconUrl = faviconUrl }) {
  const entries = new Map();
  let nextId = 0;

  function createEntry(row) {
    const node = doc.createElement("div");
    node.className = "search-recommendation";
    node.id = `search-recommendation-${++nextId}`;
    node.dataset.searchId = row.id;
    node.setAttribute("role", "option");
    const symbol = doc.createElement("span");
    symbol.className = "search-recommendation-symbol";
    const copy = doc.createElement("span");
    copy.className = "search-recommendation-copy";
    const title = doc.createElement("span");
    title.className = "search-recommendation-title";
    const detail = doc.createElement("span");
    detail.className = "search-recommendation-detail";
    const source = doc.createElement("span");
    source.className = "search-recommendation-source";
    copy.append(title, detail);
    node.append(symbol, copy, source);
    const entry = { node, symbol, title, detail, source, row, iconKey: "", image: null, imageUrl: "" };
    node.addEventListener("mousedown", event => event.preventDefault());
    node.addEventListener("click", () => {
      if (node.getAttribute("aria-disabled") !== "true") onSelect(entry.row);
    });
    return entry;
  }

  function updateSymbol(entry, row) {
    const website = row.kind === "result" && row.sources?.some(source => source === "bookmark" || source === "history");
    const key = website ? "website" : row.icon;
    if (entry.iconKey !== key) {
      entry.iconKey = key;
      entry.image = null;
      entry.imageUrl = "";
      entry.symbol.classList.remove("has-favicon");
      entry.symbol.replaceChildren(icon(row.icon, "search-recommendation-icon"));
      if (website) {
        const image = doc.createElement("img");
        image.className = "search-recommendation-favicon";
        image.width = 20;
        image.height = 20;
        image.alt = "";
        image.decoding = "async";
        image.referrerPolicy = "no-referrer";
        image.setAttribute("aria-hidden", "true");
        image.addEventListener("load", () => entry.symbol.classList.add("has-favicon"));
        image.addEventListener("error", () => {
          entry.symbol.classList.remove("has-favicon");
          if (image.getAttribute("src") !== "favicon.svg") image.src = "favicon.svg";
        });
        entry.image = image;
        entry.symbol.append(image);
      }
    }
    if (entry.image) {
      const url = getFaviconUrl(row);
      if (url !== entry.imageUrl) {
        entry.imageUrl = url;
        entry.symbol.classList.remove("has-favicon");
        entry.image.src = url;
      }
    }
  }

  function render(rows, { activeId, stale = false } = {}) {
    const entering = [];
    const wanted = new Set(rows.map(row => row.id));
    for (const [id, entry] of entries) {
      if (!wanted.has(id)) { entry.node.remove(); entries.delete(id); }
    }
    let cursor = list.firstElementChild;
    rows.forEach((row, index) => {
      const existing = entries.get(row.id);
      const entry = existing || createEntry(row);
      if (!existing && row.kind === "result") entering.push(entry.node);
      entries.set(row.id, entry);
      entry.row = row;
      entry.node.classList.toggle("is-action", row.kind !== "result");
      entry.node.classList.toggle("is-action-start", row.kind !== "result" && rows[index - 1]?.kind === "result");
      entry.node.setAttribute("aria-disabled", String(stale && row.kind === "result"));
      entry.node.setAttribute("aria-selected", String(row.id === activeId));
      entry.node.classList.toggle("is-active", row.id === activeId);
      setText(entry.title, row.titleKey ? t(row.titleKey) : row.title);
      const host = row.url ? new URL(row.url).hostname.replace(/^www\./, "") : "";
      const detail = row.kind === "result" ? [host, row.folderPath?.split(" / ").slice(-2).join(" / ")
        || (row.lastVisitTime ? new Date(row.lastVisitTime).toLocaleDateString() : row.detail)].filter(Boolean).join(" · ")
        : row.detail || "";
      setText(entry.detail, detail);
      entry.detail.hidden = !detail;
      entry.node.title = [row.title, row.url, row.folderPath].filter(Boolean).join("\n");
      const source = (row.sources || []).map(value => t(`search.unified.source.${value}`)).join(" · ");
      setText(entry.source, source);
      entry.source.hidden = !source;
      entry.source.title = source;
      updateSymbol(entry, row);
      if (entry.node === cursor) cursor = cursor.nextElementSibling;
      else list.insertBefore(entry.node, cursor);
    });
    return entering;
  }

  function clear() {
    entries.clear();
    list.replaceChildren();
  }

  return { render, clear };
}

function setText(node, value = "") {
  if (node.textContent !== value) node.textContent = value;
}

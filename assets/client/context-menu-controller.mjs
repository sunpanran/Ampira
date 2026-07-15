import { copyText } from "./clipboard.mjs";
import { spanText } from "./dom.mjs";
import { createIcon } from "./icons.mjs";

export function createContextMenuController(options) {
  const menu = options.menu;

  function bind() {
    menu.addEventListener("click", (event) => event.stopPropagation());
    document.addEventListener("click", (event) => {
      if (!menu.hidden && !event.target.closest("#linkContextMenu")) hide();
    });
    document.addEventListener("scroll", hide, { capture: true, passive: true });
    window.addEventListener("resize", hide, { passive: true });
  }

  function attachLink(element, getLink, getLeadingActions) {
    element.addEventListener("contextmenu", (event) => {
      const interactiveTarget = event.target.closest("button, input, select, textarea");
      if (interactiveTarget && interactiveTarget !== element) return;
      const link = typeof getLink === "function" ? getLink() : getLink;
      const url = String(link?.url || "").trim();
      if (!url) return;
      event.preventDefault();
      const item = link?.item;
      const leadingActions = typeof getLeadingActions === "function"
        ? getLeadingActions(link)
        : getLeadingActions;
      const actions = Array.isArray(leadingActions) ? leadingActions.filter(Boolean) : [];
      if ((link?.canExplain || item?.feedItem?.articleId) && options.aiEnabled()) {
        actions.push({ label: options.t("context.explainArticle"), icon: "file-search-01", action: () => options.explain(url) });
      }
      actions.push(
        { label: options.t("context.openNewTab"), icon: "arrow-up-right", action: () => {
          if (item) options.markOpened(item);
          options.openExternal(url);
        } },
        { label: options.t("context.copyLink"), icon: "copy-01", action: () => copyText(url) },
      );
      if (item?.feedItem?.articleId && options.personalizationEnabled()) {
        actions.push(
          { label: options.t("context.moreLike"), icon: "stars-01", action: () => options.sendFeedback(item, "more_like_this") },
          { label: options.t("context.notInterested"), icon: "slash-circle-01", action: () => options.dismiss(item) },
        );
      }
      show(event, actions);
    });
  }

  function attachGroup(element, getGroup) {
    element.addEventListener("contextmenu", (event) => {
      if (event.target.closest("button, input, select, textarea")) return;
      const group = typeof getGroup === "function" ? getGroup() : getGroup;
      const links = uniqueLinks(group?.items || []);
      if (!links.length) return;
      event.preventDefault();
      show(event, [{
        label: options.t("context.openAll", { count: links.length }),
        icon: "arrow-up-right",
        action: () => links.forEach((link) => options.openExternal(link.url)),
      }]);
    });
  }

  function attachActions(element, getActions) {
    element.addEventListener("contextmenu", (event) => {
      const interactiveTarget = event.target.closest("button, input, select, textarea");
      if (interactiveTarget && interactiveTarget !== element) return;
      const actions = typeof getActions === "function" ? getActions() : getActions;
      if (!Array.isArray(actions) || !actions.length) return;
      event.preventDefault();
      show(event, actions.filter(Boolean));
    });
  }

  function show(event, actions) {
    menu.replaceChildren(...actions.map(createButton));
    menu.hidden = false;
    menu.style.left = "0px";
    menu.style.top = "0px";
    const rect = menu.getBoundingClientRect();
    const left = Math.min(Math.max(8, event.clientX), Math.max(8, window.innerWidth - rect.width - 8));
    const top = Math.min(Math.max(8, event.clientY), Math.max(8, window.innerHeight - rect.height - 8));
    const opensUpward = event.clientY + rect.height + 8 > window.innerHeight;
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.style.setProperty("--context-menu-origin-x", event.clientX - left >= rect.width / 2 ? "right" : "left");
    menu.style.setProperty("--context-menu-origin-y", opensUpward ? "bottom" : "top");
    menu.style.setProperty("--context-menu-shift-y", opensUpward ? "4px" : "-4px");
    menu.querySelector("button")?.focus({ preventScroll: true });
  }

  function createButton(item) {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "menuitem");
    button.replaceChildren(createIcon(item.icon || "arrow-up-right", "menu-icon"), spanText(item.label, "menu-label"));
    button.addEventListener("click", async () => {
      hide();
      await item.action();
    });
    return button;
  }

  function hide() {
    if (!menu || menu.hidden) return;
    menu.hidden = true;
    menu.replaceChildren();
  }

  function uniqueLinks(items) {
    const seen = new Set();
    const links = [];
    for (const item of items || []) {
      const url = String(item?.url || options.itemUrl(item) || "").trim();
      if (!url || seen.has(url)) continue;
      seen.add(url);
      links.push({ url });
    }
    return links;
  }

  return { bind, attachLink, attachGroup, attachActions, hide };
}

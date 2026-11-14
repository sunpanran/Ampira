import { copyText } from "./clipboard.mjs";
import { spanText } from "./dom.mjs";
import { createIcon } from "./icons.mjs";

export function createContextMenuController(options) {
  const menu = options.menu;
  let returnFocus = null;
  let menuButton = null;

  function bind() {
    menu.addEventListener("click", (event) => event.stopPropagation());
    for (const type of ["pointermove", "pointerdown"]) {
      menu.addEventListener(type, () => { menu.dataset.inputMode = "pointer"; });
    }
    menu.addEventListener("keydown", (event) => {
      menu.dataset.inputMode = "keyboard";
      if (!["Escape", "Tab"].includes(event.key)) return;
      if (event.key === "Escape") event.preventDefault();
      event.stopPropagation();
      hide({ restoreFocus: true });
    });
    document.addEventListener("click", (event) => {
      if (!menu.hidden && !event.target.closest("#linkContextMenu")) hide();
    });
    document.addEventListener("contextmenu", (event) => {
      if (event.defaultPrevented) return;
      hide();
      if (event.target.closest('a, input, select, textarea, [contenteditable]:not([contenteditable="false"]), [role="menu"]')) return;
      show(event, headerCoverActions(event));
    });
    document.addEventListener("scroll", (event) => {
      if (!menu.contains(event.target)) hide();
    }, { capture: true, passive: true });
    window.addEventListener("resize", hide, { passive: true });
  }

  function headerCoverActions(event) {
    const cover = options.headerCover;
    if (!cover || cover.hidden || !options.openAppearanceSettings) return [];
    const target = event.target;
    if (target.closest("button, [data-dashboard-card]")) return [];
    if (!target.matches("body, .app, .main, .main > section")
      && !target.closest("#headerImageHero, .main > section > .section-head")) return [];
    // The decorative cover passes pointer events through to the page beneath it.
    const rect = cover.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX >= rect.right
      || event.clientY < rect.top || event.clientY >= rect.bottom) return [];
    return [{ label: options.t("context.appearanceSettings"), icon: "palette", action: options.openAppearanceSettings }];
  }

  function attachLink(element, getLink, getLeadingActions) {
    element.addEventListener("contextmenu", (event) => {
      const interactiveTarget = event.target.closest("button, input, select, textarea");
      if (interactiveTarget && interactiveTarget !== element) return;
      const link = typeof getLink === "function" ? getLink() : getLink;
      const url = String(link?.url || "").trim();
      if (!url) return;
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
          { label: options.t("context.moreLike"), icon: "stars-01", group: "feedback", action: () => options.sendFeedback(item, "more_like_this") },
          { label: options.t("context.notInterested"), icon: "slash-circle-01", group: "feedback", action: () => options.dismiss(item) },
        );
      }
      show(event, actions);
    });
  }

  function attachGroup(element, getGroup, getActions = () => []) {
    element.addEventListener("contextmenu", (event) => {
      if (event.target.closest("button, input, select, textarea")) return;
      const group = typeof getGroup === "function" ? getGroup() : getGroup;
      const links = uniqueLinks(group?.items || []);
      if (!links.length) return;
      show(event, [{
        label: options.t("context.openAll", { count: links.length }),
        icon: "arrow-up-right",
        action: () => links.forEach((link) => options.openExternal(link.url)),
      }, ...getActions().map(item => ({ ...item, group: "management" }))]);
    });
  }

  function attachActions(element, getActions) {
    element.addEventListener("contextmenu", (event) => {
      const interactiveTarget = event.target.closest("button, input, select, textarea");
      if (interactiveTarget && interactiveTarget !== element) return;
      const actions = typeof getActions === "function" ? getActions() : getActions;
      if (!Array.isArray(actions) || !actions.length) return;
      show(event, actions.filter(Boolean));
    });
  }

  function attachMenuButton(button, getActions) {
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-controls", menu.id);
    button.setAttribute("aria-expanded", "false");
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!menu.hidden && menuButton === button) { hide({ restoreFocus: true }); return; }
      const rect = button.getBoundingClientRect();
      show({
        target: button, clientX: rect.right, clientY: rect.bottom + 4,
        button: event.detail === 0 ? 0 : 2, preventDefault() {},
      }, getActions(), { includeCardActions: false });
      if (!menu.hidden) {
        menuButton = button;
        button.setAttribute("aria-expanded", "true");
      }
    });
  }

  function show(event, actions, { includeCardActions = true } = {}) {
    const cardActions = (includeCardActions ? options.getCardActions?.(event.target) || [] : []).map(item => ({ ...item, group: "card" }));
    actions = [...actions, ...cardActions];
    if (!actions.length) return;
    hide();
    event.preventDefault();
    returnFocus = event.target.closest("button, a, [tabindex]") || document.activeElement;
    menu.dataset.inputMode = event.button === 2 || ["touch", "pen"].includes(event.pointerType) ? "pointer" : "keyboard";
    menu.replaceChildren(...actions.map((item, index) => createButton(item,
      index > 0 && (item.group || "") !== (actions[index - 1].group || ""))));
    menu.hidden = false;
    menu.style.left = "0px";
    menu.style.top = "0px";
    const width = menu.offsetWidth, height = menu.offsetHeight;
    const left = Math.min(Math.max(8, event.clientX), Math.max(8, window.innerWidth - width - 8));
    const top = Math.min(Math.max(8, event.clientY), Math.max(8, window.innerHeight - height - 8));
    const opensUpward = event.clientY + height + 8 > window.innerHeight;
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.style.setProperty("--context-menu-origin-x", event.clientX - left >= width / 2 ? "right" : "left");
    menu.style.setProperty("--context-menu-origin-y", opensUpward ? "bottom" : "top");
    menu.style.setProperty("--context-menu-shift-y", opensUpward ? "4px" : "-4px");
    menu.querySelector("button")?.focus({ preventScroll: true });
  }

  function createButton(item, startsGroup) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = startsGroup ? "context-menu-group-start" : "";
    if (item.tone === "danger") button.classList.add("is-danger");
    button.setAttribute("role", "menuitem");
    button.replaceChildren(createIcon(item.icon || "arrow-up-right", "menu-icon"), spanText(item.label, "menu-label"));
    button.addEventListener("click", async () => {
      hide({ restoreFocus: Boolean(menuButton) });
      await item.action();
    });
    return button;
  }

  function hide({ restoreFocus = false } = {}) {
    if (!menu || menu.hidden) return;
    menu.hidden = true;
    menu.replaceChildren();
    menuButton?.setAttribute("aria-expanded", "false");
    menuButton = null;
    if (restoreFocus) returnFocus?.focus({ preventScroll: true });
    returnFocus = null;
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

  return { bind, attachLink, attachGroup, attachActions, attachMenuButton, hide };
}

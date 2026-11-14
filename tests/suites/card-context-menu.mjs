import assert from "node:assert/strict";
import { createContextMenuController } from "../../assets/client/context-menu-controller.mjs";

export async function runCardContextMenuTests() {
  const originals = Object.fromEntries(["document", "window"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const doc = new TestNode("document");
  doc.createElement = tag => new TestNode(tag, doc);
  const win = new TestNode("window", doc);
  Object.assign(win, { innerWidth: 400, innerHeight: 300 });
  Object.defineProperty(globalThis, "document", { configurable: true, value: doc });
  Object.defineProperty(globalThis, "window", { configurable: true, value: win });
  try {
    const menu = doc.createElement("div");
    menu.id = "linkContextMenu";
    menu.hidden = true;
    menu.setAttribute("role", "menu");
    doc.append(menu);
    const opened = [], switched = [], appearanceOpened = [], feedback = [];
    const cover = doc.createElement("div");
    cover.id = "headerImageHero";
    cover.rect = { left: 0, right: 400, top: 0, bottom: 180 };
    let locale = "zh-CN", pickerOpen = false, aiEnabled = false, personalizationEnabled = false;
    const controller = createContextMenuController({
      menu, headerCover: cover, openAppearanceSettings: () => appearanceOpened.push(locale),
      t: key => key === "context.appearanceSettings" ? `${locale}:appearance` : key,
      aiEnabled: () => aiEnabled, personalizationEnabled: () => personalizationEnabled,
      sendFeedback: (item, value) => feedback.push([item.feedItem.articleId, value]),
      openExternal: url => opened.push(url), itemUrl: item => item.url,
      getCardActions: target => {
        const id = target.closest("[data-dashboard-card]")?.dataset.dashboardCard;
        if (!["utility", "digest", "archive", "news", "inspiration", "queue"].includes(id) || pickerOpen) return [];
        return [{ label: `${locale}:switch`, icon: "grid-view", action: () => switched.push(id) }];
      },
    });
    controller.bind();
    const card = doc.createElement("section"), body = doc.createElement("div"), button = doc.createElement("button");
    card.append(body, button);
    doc.append(card);
    const labels = () => menu.children.map(item => item.children[1].textContent);
    for (const id of ["utility", "digest", "news", "inspiration", "queue", "archive"]) {
      card.dataset.dashboardCard = id;
      for (const target of [card, body, button]) {
        const event = await target.emit("contextmenu");
        assert(event.defaultPrevented, "card backgrounds, text and controls expose the switch action");
        assert.deepEqual(labels(), ["zh-CN:switch"]);
        assert.equal(doc.activeElement, menu.children[0], "the menu action receives keyboard focus");
        assert.equal(menu.dataset.inputMode, "pointer", "right-click focuses without showing keyboard selection");
        await menu.children[0].emit("click");
        assert(menu.hidden);
        assert.equal(switched.at(-1), id, "the action belongs to the clicked card instance");
      }
    }
    locale = "en";
    await body.emit("contextmenu", { clientX: 399, clientY: 299 });
    assert.deepEqual(labels(), ["en:switch"], "menu copy follows the current locale");
    assert.equal(menu.style.left, "214px");
    assert.equal(menu.style.top, "246px", "the menu remains inside the viewport at its bottom edge");

    for (const tag of ["input", "textarea", "select", "a"]) {
      const control = doc.createElement(tag), child = doc.createElement("span");
      control.append(child); body.append(control);
      assert(!(await child.emit("contextmenu")).defaultPrevented, "native link and editing menus remain available");
      assert(menu.hidden, "a native menu must not leave the old custom menu visible");
    }
    const editor = doc.createElement("div"), text = doc.createElement("span");
    editor.setAttribute("contenteditable", "true"); editor.append(text); body.append(editor);
    assert(!(await text.emit("contextmenu")).defaultPrevented);
    pickerOpen = true;
    assert(!(await body.emit("contextmenu")).defaultPrevented, "an open type picker suppresses another switch menu");
    pickerOpen = false;

    controller.attachLink(button, { url: "https://example.com/article" });
    await button.emit("contextmenu");
    assert.deepEqual(labels(), ["context.openNewTab", "context.copyLink", "en:switch"], "link actions and the card action share one menu without bubbling duplicates");
    assert.equal(menu.children[0].className, "", "the first action never gets a leading divider");
    assert.equal(menu.children[2].className, "context-menu-group-start", "card layout actions are separated from link actions");
    await menu.children[0].emit("click");
    assert.deepEqual(opened, ["https://example.com/article"]);
    assert.equal(switched.length, 18, "opening a link must not switch cards");
    await button.emit("contextmenu");
    await menu.children[2].emit("click");
    assert.equal(switched.length, 19);
    assert.equal(switched.at(-1), "archive");
    await button.emit("contextmenu");
    await menu.children[0].emit("keydown", { key: "Enter" });
    assert.equal(menu.dataset.inputMode, "keyboard", "keyboard interaction restores the focus indicator after right-click");
    assert.equal(doc.activeElement, menu.children[0]);
    await menu.children[1].emit("pointermove");
    assert.equal(menu.dataset.inputMode, "pointer", "mouse movement removes the old keyboard highlight");
    await button.emit("contextmenu", { button: -1, pointerType: "mouse" });
    assert.equal(menu.dataset.inputMode, "keyboard", "keyboard invocation is not mistaken for mouse input");
    assert.equal(doc.activeElement, menu.children[0]);
    await menu.children[0].emit("pointerdown");
    assert.equal(menu.dataset.inputMode, "pointer");
    for (const pointerType of ["touch", "pen"]) {
      await button.emit("contextmenu", { button: 0, pointerType });
      assert.equal(menu.dataset.inputMode, "pointer", "long-press menus do not show a keyboard focus ring");
    }
    await button.emit("contextmenu");
    assert((await menu.children[0].emit("keydown", { key: "Escape" })).defaultPrevented);
    assert(menu.hidden && doc.activeElement === button, "Escape returns focus to the context target");
    await button.emit("contextmenu");
    assert(!(await menu.children[0].emit("keydown", { key: "Tab" })).defaultPrevented, "Tab retains native keyboard navigation");
    assert(menu.hidden);

    const outside = doc.createElement("div"); doc.append(outside);
    await body.emit("contextmenu");
    await outside.emit("click"); assert(menu.hidden);
    await body.emit("contextmenu");
    await menu.emit("scroll"); assert(!menu.hidden, "scrolling a tall context menu keeps it open");
    await doc.emit("scroll"); assert(menu.hidden);
    await body.emit("contextmenu");
    await win.emit("resize"); assert(menu.hidden);
    card.dataset.dashboardCard = "unrelated";
    assert(!(await body.emit("contextmenu")).defaultPrevented, "unrelated surfaces retain the native menu");
    assert(!(await outside.emit("contextmenu")).defaultPrevented);
    await button.emit("contextmenu");
    assert.deepEqual(labels(), ["context.openNewTab", "context.copyLink"], "links outside switchable cards keep their original actions");

    const groupHeader = doc.createElement("div");
    doc.append(groupHeader);
    let hiddenGroup = "";
    controller.attachGroup(groupHeader, () => ({ items: [{ url: "https://example.com/group" }] }), () => [{
      label: "context.hideBookmarkCategory", action: () => { hiddenGroup = "sample"; },
    }]);
    await groupHeader.emit("contextmenu");
    assert.deepEqual(labels(), ["context.openAll", "context.hideBookmarkCategory"], "group menus preserve bulk opening and expose category hiding");
    assert.equal(menu.children[1].className, "context-menu-group-start", "management actions form a second group");
    await menu.children[1].emit("click");
    assert.equal(hiddenGroup, "sample");
    assert(menu.hidden);

    const article = doc.createElement("a"); doc.append(article);
    aiEnabled = true; personalizationEnabled = true;
    controller.attachLink(article, { url: "https://example.com/news", item: { feedItem: { articleId: "news" } } });
    await article.emit("contextmenu");
    assert.deepEqual(labels(), ["context.explainArticle", "context.openNewTab", "context.copyLink", "context.moreLike", "context.notInterested"]);
    assert.deepEqual(menu.children.map(item => item.className), ["", "", "", "context-menu-group-start", ""], "one decorative divider separates feedback without adding a focusable row");
    await menu.children[3].emit("click");
    assert.deepEqual(feedback, [["news", "more_like_this"]]);
    aiEnabled = false; personalizationEnabled = false;
    await article.emit("contextmenu");
    assert.deepEqual(menu.children.map(item => item.className), ["", ""], "unavailable action groups leave no orphan divider");
    controller.hide();

    const pageBody = doc.createElement("body"), app = doc.createElement("div"), main = doc.createElement("main");
    app.className = "app"; main.className = "main";
    const section = doc.createElement("section"), heading = doc.createElement("div"), title = doc.createElement("h2");
    heading.className = "section-head";
    const image = doc.createElement("img"), video = doc.createElement("video"), fade = doc.createElement("span");
    cover.append(image, video, fade); heading.append(title); section.append(heading); main.append(cover, section);
    app.append(main); pageBody.append(app); doc.append(pageBody);
    for (locale of ["zh-CN", "zh-Hant", "en"]) {
      for (const target of [pageBody, app, main, section, heading, title, cover, image, video, fade]) {
        button.focus();
        assert((await target.emit("contextmenu")).defaultPrevented, "the visible cover and click-through page surfaces expose appearance settings");
        assert.deepEqual(labels(), [`${locale}:appearance`]);
        assert.equal(doc.activeElement, menu.children[0]);
        await menu.children[0].emit("keydown", { key: "Escape" });
        assert(menu.hidden && doc.activeElement === button, "dismissing the decorative cover menu restores the previous focus");
      }
      await main.emit("contextmenu");
      await menu.children[0].emit("click");
      assert(menu.hidden);
      assert.equal(appearanceOpened.at(-1), locale);
    }
    assert.equal(appearanceOpened.length, 3, "appearance opens only after choosing its action");
    for (const tag of ["button", "input", "select", "textarea", "a"]) {
      const control = doc.createElement(tag), child = doc.createElement("span");
      control.append(child); heading.append(control);
      assert(!(await child.emit("contextmenu")).defaultPrevented, "foreground controls keep their own context behavior over the cover");
    }
    const editable = doc.createElement("div");
    editable.setAttribute("contenteditable", "true"); heading.append(editable);
    assert(!(await editable.emit("contextmenu")).defaultPrevented);
    const content = doc.createElement("article"); section.append(content);
    assert(!(await content.emit("contextmenu")).defaultPrevented, "foreground content is not mistaken for the cover");
    assert(!(await outside.emit("contextmenu")).defaultPrevented, "overlays and unrelated surfaces do not expose appearance settings");
    for (const point of [{ clientX: -1 }, { clientX: 400 }, { clientY: -1 }, { clientY: 180 }]) {
      assert(!(await main.emit("contextmenu", point)).defaultPrevented, "the context target must lie within the current cover bounds");
    }
    cover.hidden = true;
    assert(!(await main.emit("contextmenu")).defaultPrevented, "disabled and failed covers do not expose appearance settings");
    cover.hidden = false;
    cover.rect = { left: 0, right: 400, top: -200, bottom: -20 };
    assert(!(await main.emit("contextmenu")).defaultPrevented, "a scrolled-away cover does not claim the page background");
    cover.rect = { left: 0, right: 400, top: 0, bottom: 300 };
    assert((await main.emit("contextmenu", { clientX: 399, clientY: 299 })).defaultPrevented, "fullscreen covers use their current visible bounds");
    assert.equal(menu.style.left, "214px");
    assert.equal(menu.style.top, "246px");
    card.dataset.dashboardCard = "utility";
    await body.emit("contextmenu");
    assert.deepEqual(labels(), ["en:switch"], "cards over a fullscreen cover keep only their own actions");
    controller.hide();

    const more = doc.createElement("button"), otherMore = doc.createElement("button");
    more.rect = otherMore.rect = { right: 390, bottom: 40 };
    card.append(more, otherMore);
    const selected = [];
    const archiveActions = () => [{ label: `${locale}:clear`, icon: "trash-01", tone: "danger", action: () => selected.push(doc.activeElement) }];
    controller.attachMenuButton(more, archiveActions);
    controller.attachMenuButton(otherMore, archiveActions);
    assert.equal(more.attributes["aria-haspopup"], "menu");
    assert.equal(more.attributes["aria-controls"], menu.id);
    assert.equal(more.attributes["aria-expanded"], "false");
    await more.emit("click", { detail: 1 });
    assert(!menu.hidden, "the opening click must not bubble into the outside-click dismissal");
    assert.equal(more.attributes["aria-expanded"], "true");
    assert.deepEqual(labels(), ["en:clear"], "explicit action menus must not inherit card switching");
    assert.equal(menu.dataset.inputMode, "pointer");
    assert.equal(menu.style.left, "214px", "button menus stay within the viewport");
    assert.equal(menu.style.top, "44px", "button menus open below their trigger");
    assert.equal(selected.length, 0, "opening a menu must not execute its destructive action");
    await more.emit("click", { detail: 1 });
    assert(menu.hidden && more.attributes["aria-expanded"] === "false", "a second click toggles the menu closed");
    await more.emit("click", { detail: 0 });
    assert.equal(menu.dataset.inputMode, "keyboard");
    await menu.children[0].emit("keydown", { key: "Escape" });
    assert(menu.hidden && doc.activeElement === more);
    assert.equal(more.attributes["aria-expanded"], "false");
    await more.emit("click", { detail: 0 });
    await menu.children[0].emit("click");
    assert.equal(selected[0], more, "restore the trigger before opening a confirmation so cancellation can return focus");
    await more.emit("click", { detail: 1 });
    await otherMore.emit("click", { detail: 1 });
    assert.equal(more.attributes["aria-expanded"], "false", "switching instances resets the previous trigger");
    assert.equal(otherMore.attributes["aria-expanded"], "true");
    await outside.emit("click");
    assert(menu.hidden && otherMore.attributes["aria-expanded"] === "false");
    await body.emit("contextmenu");
    assert.deepEqual(labels(), ["en:switch"], "card switching remains available from the card context menu");
    controller.hide();
  } finally {
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

class TestNode {
  constructor(tag, doc) {
    Object.assign(this, { tag, doc, children: [], dataset: {}, attributes: {}, listeners: {}, style: { setProperty() {} } });
    this.classList = { add() {}, remove() {} };
  }
  append(...nodes) { nodes.forEach(node => { node.parentElement = this; this.children.push(node); }); }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  replaceChildren(...nodes) { this.children.forEach(node => { node.parentElement = null; }); this.children = []; this.append(...nodes); }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }
  focus() { this.doc.activeElement = this; }
  get offsetWidth() { return 178; }
  get offsetHeight() { return this.children.length * 34 + 12; }
  getBoundingClientRect() { return this.rect || { width: 178, height: this.children.length * 34 + 12 }; }
  matches(selector) {
    if (selector.includes(",")) return selector.split(",").some(part => this.matches(part.trim()));
    if (selector.includes(" > ")) {
      const parts = selector.split(" > ");
      return this.matches(parts.pop()) && Boolean(this.parentElement?.matches(parts.join(" > ")));
    }
    if (selector.startsWith(".")) return (this.className || "").split(" ").includes(selector.slice(1));
    if (selector.startsWith("#")) return this.id === selector.slice(1);
    if (selector === "[data-dashboard-card]") return Boolean(this.dataset.dashboardCard);
    if (selector.startsWith("[contenteditable]")) return this.attributes.contenteditable !== undefined && this.attributes.contenteditable !== "false";
    if (selector === '[role="menu"]') return this.attributes.role === "menu";
    return this.tag === selector;
  }
  closest(selectors) {
    for (let node = this; node; node = node.parentElement) {
      if (selectors.split(",").some(selector => node.matches(selector.trim()))) return node;
    }
    return null;
  }
  querySelector(selector) {
    for (const child of this.children) {
      if (child.matches(selector)) return child;
      const found = child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }
  async emit(type, values = {}) {
    const event = { target: this, clientX: 20, clientY: 30, button: 2, pointerType: "mouse", defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...values };
    for (let node = this; node; node = node.parentElement) {
      for (const callback of node.listeners[type] || []) await callback(event);
      if (event.stopped) break;
    }
    return event;
  }
}

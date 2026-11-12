import assert from "node:assert/strict";
import { createWebsiteShortcutLayout } from "../../assets/client/website-shortcut-layout.mjs";

export function runWebsiteShortcutLayoutTests() {
  const savedDocument = globalThis.document;
  const savedMatchMedia = globalThis.matchMedia;
  const doc = { activeElement: null, hidden: false };
  let reduced = false;
  globalThis.document = doc;
  globalThis.matchMedia = () => ({ matches: reduced });
  try {
    const shortcuts = ["A", "B", "C", "D"].map((title) => ({ title, url: `https://${title.toLowerCase()}.example/` }));
    const list = new ShortcutList(doc);
    let revision = 0;
    const layout = createWebsiteShortcutLayout({
      list,
      createItem: (shortcut) => new ShortcutItem(shortcut.url, list, doc),
      signatureFor: (shortcut) => `${shortcut.title}:${revision}`,
    });
    const render = (order = shortcuts, options) => layout.render(order, options);
    const rects = () => new Map(list.children.map((node) => [node.dataset.key, node.getBoundingClientRect().left]));
    const advance = (progress) => list.children.forEach((node) => { if (node.animation) node.animation.progress = progress; });
    const finish = () => list.children.forEach((node) => node.animation?.finish());
    const animationCount = () => list.children.reduce((count, node) => count + node.history.length, 0);
    const point = (index) => ({ clientX: list.left + index * 106 - list.scrollLeft + 40 });
    render();
    const originalNodes = [...list.children];
    assert.equal(animationCount(), 0, "initial shortcuts rely on the rail entrance instead of replaying item entrances");

    layout.begin(shortcuts[0].url, point(0));
    assert.equal(layout.preview(point(2)), 2);
    assert.deepEqual(list.children, originalNodes, "drag previews must not detach the native drag source or change DOM order");
    assert.equal(originalNodes[0].style.getPropertyValue("translate"), "212px 0px");
    assert.equal(originalNodes[1].style.getPropertyValue("translate"), "-106px 0px");
    assert.equal(originalNodes[2].style.getPropertyValue("translate"), "-106px 0px");
    assert.equal(originalNodes[3].history.length, 0, "unaffected shortcuts stay still");
    const previewCount = animationCount();
    advance(.45);
    layout.preview(point(2));
    assert.equal(animationCount(), previewCount, "repeated dragover events must not restart the same movement");
    const beforeReverse = rects();
    assert.equal(layout.preview(point(1)), 1);
    assert.deepEqual(rects(), beforeReverse, "reversing a drag starts from its current visual positions");
    advance(.5);
    const beforeCancel = rects();
    layout.end();
    assert.deepEqual(rects(), beforeCancel, "Escape or an outside drop returns smoothly from the preview");
    finish();
    assert(originalNodes.every((node) => !node.style.getPropertyValue("translate")));
    assert(originalNodes.every((node) => !node.style.getPropertyValue("will-change")));

    layout.begin(shortcuts[0].url, point(0));
    layout.preview(point(2));
    advance(.6);
    const beforeDrop = rects();
    layout.end({ commit: true });
    originalNodes[1].focus();
    const next = [shortcuts[1], shortcuts[2], shortcuts[0], shortcuts[3]];
    render(next, { draggable: false });
    assert.deepEqual(list.children, [originalNodes[1], originalNodes[2], originalNodes[0], originalNodes[3]]);
    assert.deepEqual([...rects()].sort(), [...beforeDrop].sort(), "drop settlement keeps the preview's exact on-screen positions");
    assert.equal(doc.activeElement, originalNodes[1], "fallback DOM moves restore keyboard focus");
    assert(list.children.every((node) => node.draggable === false));
    const pendingAnimations = list.children.map((node) => node.animation);
    const droppedCount = animationCount();
    assert.equal(render(next.map((item) => ({ ...item })), { draggable: true }), false);
    assert.equal(animationCount(), droppedCount, "a fast save acknowledgement must not create a second movement");
    assert.deepEqual(list.children.map((node) => node.animation), pendingAnimations);
    assert(list.children.every((node) => node.draggable));
    assert.deepEqual(list.children.map((node) => node.dataset.shortcutIndex), ["0", "1", "2", "3"]);

    advance(.35);
    const beforeRollback = rects();
    render();
    assert.deepEqual([...rects()].sort(), [...beforeRollback].sort(), "failed persistence rolls back from the in-flight frame");
    finish();
    assert.deepEqual(list.children, originalNodes);

    list.scrollLeft = 106;
    layout.begin(shortcuts[2].url, point(2));
    list.scrollLeft = 212;
    assert.equal(layout.preview({ clientX: 186 }), 3, "edge scrolling shifts hit testing into the list's content coordinates");
    advance(1);
    assert.equal(layout.preview({ clientX: 186 }), 3, "animated elements cannot change their own insertion target");
    layout.end({ commit: true });
    render([shortcuts[0], shortcuts[1], shortcuts[3], shortcuts[2]]);
    assert.equal(list.scrollLeft, 212, "reconciliation preserves the user's scroll position");
    finish();

    revision += 1;
    render();
    assert(list.children.every((node) => !originalNodes.includes(node)), "changed titles, locale or icon access invalidate the reused content");
    finish();
    reduced = true;
    const reducedCount = animationCount();
    layout.begin(shortcuts[0].url, point(0));
    layout.preview(point(3));
    layout.end({ commit: true });
    render([...shortcuts].reverse());
    assert.equal(animationCount(), reducedCount, "reduced motion updates layout without animated travel");
    assert(list.children.every((node) => !node.style.getPropertyValue("translate")));
    reduced = false;
    doc.hidden = true;
    render();
    assert.equal(animationCount(), reducedCount, "hidden documents do not play movement");
    doc.hidden = false;

    layout.begin(shortcuts[0].url, point(0));
    layout.preview(point(3));
    const active = list.children.map((node) => node.animation).filter(Boolean);
    layout.reset();
    assert(active.every((animation) => animation.cancelled));
    assert(list.children.every((node) => !node.style.getPropertyValue("translate") && !node.style.getPropertyValue("will-change")));
    assert.equal(layout.preview(point(2)), -1, "hiding or emptying the rail clears the active gesture");
  } finally {
    if (savedDocument === undefined) delete globalThis.document;
    else globalThis.document = savedDocument;
    if (savedMatchMedia === undefined) delete globalThis.matchMedia;
    else globalThis.matchMedia = savedMatchMedia;
  }
}

class ShortcutList {
  constructor(doc) { this.doc = doc; this.children = []; this.left = 40; this.scrollLeft = 0; this.clientLeft = 0; }
  querySelectorAll() { return this.children; }
  contains(node) { return this.children.includes(node); }
  getBoundingClientRect() { return { left: this.left, top: 100, width: 220, height: 50 }; }
  insertBefore(node, target) {
    if (this.contains(node)) {
      this.children.splice(this.children.indexOf(node), 1);
      if (this.doc.activeElement === node) this.doc.activeElement = null;
    }
    const index = target ? this.children.indexOf(target) : this.children.length;
    this.children.splice(index, 0, node);
    node.parentElement = this;
  }
}

class ShortcutItem {
  constructor(key, list, doc) {
    this.dataset = { key };
    this.list = list;
    this.doc = doc;
    this.history = [];
    this.animation = null;
    const styles = new Map();
    this.style = {
      setProperty: (key, value) => styles.set(key, value),
      removeProperty: (key) => styles.delete(key),
      getPropertyValue: (key) => styles.get(key) || "",
    };
  }
  get offsetLeft() { return this.list.children.indexOf(this) * 106; }
  get offsetTop() { return 0; }
  get offsetWidth() { return 104; }
  getBoundingClientRect() {
    let x = parseFloat(this.style.getPropertyValue("translate")) || 0;
    if (this.animation) {
      const [start, end] = this.animation.frames.map((frame) => parseFloat(frame.translate));
      x = start + (end - start) * this.animation.progress;
    }
    return { left: this.list.left + this.offsetLeft - this.list.scrollLeft + x, top: 100, width: 104, height: 50 };
  }
  focus() { this.doc.activeElement = this; }
  remove() { this.list.children.splice(this.list.children.indexOf(this), 1); this.parentElement = null; }
  animate(frames, options) {
    const listeners = new Map();
    const emit = (type) => { for (const listener of listeners.get(type) || []) listener(); };
    const animation = {
      frames, options, progress: 0, cancelled: false,
      addEventListener(type, callback) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(callback);
      },
      cancel: () => {
        if (animation.cancelled) return;
        animation.cancelled = true;
        if (this.animation === animation) this.animation = null;
        emit("cancel");
      },
      finish: () => { animation.progress = 1; if (this.animation === animation) this.animation = null; emit("finish"); },
    };
    this.history.push(animation);
    this.animation = animation;
    return animation;
  }
}

import { animateElement, captureKeyedLayout } from "./motion.mjs";

const ITEM_SELECTOR = ".website-shortcut[data-key]";

export function createWebsiteShortcutLayout({ list, createItem, signatureFor }) {
  const entries = new Map();
  const animations = new Map();
  let drag = null;
  const items = () => Array.from(list.querySelectorAll(ITEM_SELECTOR));
  const capture = () => captureKeyedLayout(list, ITEM_SELECTOR);

  function stop() {
    for (const animation of animations.values()) animation.cancel();
    animations.clear();
    for (const node of items()) node.style.removeProperty("translate");
  }

  function play(previous, offsets = new Map(), animate = true) {
    stop();
    const nodes = items();
    for (const node of nodes) {
      const offset = offsets.get(node.dataset.key);
      if (offset) node.style.setProperty("translate", `${offset.x}px ${offset.y}px`);
    }
    if (!animate) return;
    // Read every destination before starting any animation.
    const next = capture();
    for (const node of nodes) {
      const before = previous.get(node.dataset.key);
      const after = next.get(node.dataset.key);
      if (!before || !after?.width || !after.height) continue;
      const x = before.left - after.left;
      const y = before.top - after.top;
      if (Math.abs(x) < .5 && Math.abs(y) < .5) continue;
      const offset = offsets.get(node.dataset.key) || { x: 0, y: 0 };
      const animation = animateElement(node, [
        { translate: `${offset.x + x}px ${offset.y + y}px` },
        { translate: `${offset.x}px ${offset.y}px` },
      ], { duration: "move", easing: "move", willChange: "translate" });
      if (!animation) continue;
      animations.set(node, animation);
      const cleanup = () => {
        if (animations.get(node) !== animation) return;
        animations.delete(node);
        animation.cancel();
      };
      animation.addEventListener("finish", cleanup, { once: true });
      animation.addEventListener("cancel", cleanup, { once: true });
    }
  }

  function render(shortcuts, { animate = true, draggable = true } = {}) {
    const next = shortcuts.map((shortcut, index) => {
      const signature = signatureFor(shortcut);
      let entry = entries.get(shortcut.url);
      if (!entry || entry.signature !== signature) {
        entry = { signature, node: createItem(shortcut, index, shortcuts.length) };
        entries.set(shortcut.url, entry);
      }
      entry.node.dataset.shortcutIndex = String(index);
      entry.node.draggable = draggable && shortcuts.length > 1;
      return entry.node;
    });
    // Save acknowledgements and ordinary refreshes must not restart a move.
    if (next.length === list.children.length && next.every((node, index) => list.children[index] === node)) return false;
    const previous = capture();
    const scrollLeft = list.scrollLeft;
    const focused = list.contains(document.activeElement) ? document.activeElement : null;
    drag = null;
    const retained = new Set(next);
    for (const child of Array.from(list.children)) if (!retained.has(child)) child.remove();
    for (const [key, entry] of entries) if (!retained.has(entry.node)) entries.delete(key);
    next.forEach((node, index) => {
      if (list.children[index] === node) return;
      if (typeof list.moveBefore === "function" && node.parentElement === list) list.moveBefore(node, list.children[index] || null);
      else list.insertBefore(node, list.children[index] || null);
    });
    list.scrollLeft = scrollLeft;
    play(previous, undefined, animate);
    if (focused && list.contains(focused) && document.activeElement !== focused) focused.focus({ preventScroll: true });
    return true;
  }

  function begin(key, event) {
    const nodes = items();
    const fromIndex = nodes.findIndex((node) => node.dataset.key === key);
    if (fromIndex < 0) return;
    const source = nodes[fromIndex];
    drag = {
      fromIndex, toIndex: fromIndex,
      pointerOffset: event.clientX - source.getBoundingClientRect().left,
      slots: nodes.map((node) => ({ key: node.dataset.key, left: node.offsetLeft, top: node.offsetTop, width: node.offsetWidth })),
    };
  }

  function preview(event) {
    if (!drag) return -1;
    const source = drag.slots[drag.fromIndex];
    const center = event.clientX - list.getBoundingClientRect().left - list.clientLeft
      + list.scrollLeft - drag.pointerOffset + source.width / 2;
    // Use fixed layout slots, not the animated hit target, to avoid oscillation.
    const toIndex = drag.slots.reduce((nearest, slot, index, slots) => (
      Math.abs(slot.left + slot.width / 2 - center) < Math.abs(slots[nearest].left + slots[nearest].width / 2 - center)
        ? index : nearest
    ), 0);
    if (toIndex === drag.toIndex) return toIndex;
    drag.toIndex = toIndex;
    const order = drag.slots.filter((_slot, index) => index !== drag.fromIndex);
    order.splice(toIndex, 0, source);
    const offsets = new Map(order.map((slot, index) => [slot.key, {
      x: drag.slots[index].left - slot.left,
      y: drag.slots[index].top - slot.top,
    }]));
    play(capture(), offsets);
    return toIndex;
  }

  function end({ commit = false } = {}) {
    if (!drag) return;
    drag = null;
    if (!commit) play(capture());
  }

  function reset() {
    drag = null;
    stop();
    entries.clear();
  }

  return { render, begin, preview, end, reset };
}

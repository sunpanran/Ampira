import assert from "node:assert/strict";
import { createNavigationAutoHideController } from "../../assets/client/navigation-auto-hide.mjs";

export function runNavigationAutoHideTests() {
  const originals = new Map(["window", "document", "setTimeout", "clearTimeout"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const timers = new Map();
  let nextTimer = 0;
  let keyboardFocus = false;
  const root = { dataset: {}, classList: classes() };
  const doc = target({ documentElement: root, hidden: false });
  const sidebar = target({ classList: classes(), querySelector(selector) {
    if (selector === ":focus-visible") return keyboardFocus ? {} : null;
    return { focus() { keyboardFocus = true; sidebar.fire("focusin"); } };
  } });
  const reveal = target({ hidden: true });
  const tick = () => {
    for (const [id, callback] of [...timers]) { timers.delete(id); callback(); }
  };
  const hidden = () => sidebar.classList.contains("is-auto-hidden");
  try {
    globalThis.window = target();
    globalThis.document = doc;
    globalThis.setTimeout = (callback) => { timers.set(++nextTimer, callback); return nextTimer; };
    globalThis.clearTimeout = id => timers.delete(id);
    const controller = createNavigationAutoHideController({ sidebar, reveal });
    controller.sync({ navPosition: "left" });
    tick();
    assert.equal(hidden(), false, "navigation stays visible by default");
    controller.sync({ navPosition: "left", navAutoHideEnabled: true });
    root.classList.add("has-nav-entrance");
    tick();
    assert.equal(hidden(), false, "auto-hide must not interrupt the entrance animation");
    root.classList.remove("has-nav-entrance");
    tick();
    assert.equal(hidden(), true);
    assert.equal(reveal.hidden, false);
    reveal.fire("pointerenter", { pointerType: "mouse" });
    sidebar.fire("pointerenter", { pointerType: "mouse" });
    tick();
    assert.equal(hidden(), false, "hovering the navigation keeps it visible");
    sidebar.fire("pointerleave");
    tick();
    assert.equal(hidden(), true);

    reveal.fire("pointerenter", { pointerType: "touch" });
    assert.equal(hidden(), true, "touch must wait for activation, not a synthetic hover");
    reveal.fire("click");
    tick();
    assert.equal(hidden(), false, "keyboard focus keeps the revealed buttons usable");
    assert.equal(reveal.hidden, true);
    keyboardFocus = false;
    sidebar.fire("focusout");
    sidebar.fire("pointerdown");
    tick();
    assert.equal(hidden(), false, "a press cannot be hidden before it finishes");
    doc.fire("pointerup");
    tick();
    assert.equal(hidden(), true, "pointer focus alone does not pin the navigation open");
    keyboardFocus = true;
    sidebar.fire("focusin");
    assert.equal(hidden(), false, "tabbing directly into a hidden navigation reveals it");
    keyboardFocus = false;
    sidebar.fire("focusout");
    controller.sync({ navPosition: "right", navAutoHideEnabled: true });
    assert.equal(hidden(), false);
    assert.equal(timers.size, 1, "position changes replace the pending hide");
    controller.sync({ navPosition: "right", navAutoHideEnabled: false });
    tick();
    assert.equal(hidden(), false);
    assert.equal(reveal.hidden, true);
    assert.equal(timers.size, 0, "disabling cancels pending work");

    controller.sync({ navPosition: "top", navAutoHideEnabled: true });
    doc.hidden = true;
    doc.fire("visibilitychange");
    assert.equal(timers.size, 0);
    doc.hidden = false;
    doc.fire("visibilitychange");
    assert.equal(hidden(), false);
    tick();
    assert.equal(hidden(), true);
    window.fire("resize");
    assert.equal(hidden(), false, "a breakpoint change reveals the navigation in its new position");
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

function target(properties = {}) {
  const listeners = new Map();
  return { ...properties,
    addEventListener(type, callback) { listeners.set(type, [...(listeners.get(type) || []), callback]); },
    fire(type, event = {}) { for (const callback of listeners.get(type) || []) callback(event); },
  };
}

function classes() {
  const values = new Set();
  return { add: value => values.add(value), remove: value => values.delete(value), contains: value => values.has(value) };
}

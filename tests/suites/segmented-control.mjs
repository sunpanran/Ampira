import assert from "node:assert/strict";
import { syncSegmentedIndicator } from "../../assets/client/segmented-control.mjs";

export function runSegmentedControlTests() {
  const names = ["document", "getComputedStyle", "requestAnimationFrame"];
  const originals = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  const frames = [], commits = [];
  const values = new Map(), classes = new Set();
  let visible = false;
  const buttons = [3, 103, 203].map(left => ({
    offsetLeft: left, offsetTop: 3, offsetWidth: 98, offsetHeight: 32,
    matches: selector => selector === "button",
    getClientRects: () => visible ? [{}] : [],
    getBoundingClientRect: () => ({ left: 22 + left, top: 35, width: 96, height: 30 }),
  }));
  let activeButton = buttons[2];
  const control = {
    children: [], scrollLeft: 0, scrollTop: 0,
    classList: {
      contains: name => classes.has(name),
      add: name => classes.add(name),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name),
    },
    style: { setProperty: (key, value) => values.set(key, value) },
    querySelector: () => activeButton,
    getClientRects: () => visible ? [{}] : [],
    getBoundingClientRect: () => ({ left: 20, top: 30 }),
    prepend: child => control.children.unshift(child),
  };
  const globals = {
    document: { createElement: () => ({ classList: { contains: name => name === "segment-indicator" }, setAttribute() {} }) },
    requestAnimationFrame: callback => frames.push(callback),
    getComputedStyle: element => {
      if (element === control) return { borderLeftWidth: "1px", borderTopWidth: "1px" };
      commits.push({ animated: classes.has("is-indicator-moving"), visible: classes.has("has-indicator"), x: values.get("--segmented-x") });
      return { transform: "none" };
    },
  };
  const flushFrames = () => frames.splice(0).forEach(callback => callback());
  try {
    for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, value: globals[name] });
    syncSegmentedIndicator(control);
    flushFrames();
    assert.equal(classes.has("has-indicator"), false, "hidden settings do not establish an animated starting position");
    assert.equal(commits.length, 0);

    visible = true;
    syncSegmentedIndicator(control);
    assert.deepEqual(commits.at(-1), { animated: false, visible: true, x: "203px" }, "the first visible frame commits the saved third option without sliding");
    assert.equal(values.get("--segmented-y"), "3px");
    assert.equal(values.get("--segmented-w"), "98px", "press feedback must not shrink the selection indicator");
    assert.equal(values.get("--segmented-h"), "32px");
    flushFrames();
    assert.equal(control.children.length, 1, "the deferred measurement reuses the existing indicator");

    activeButton = buttons[1];
    syncSegmentedIndicator(control, activeButton);
    assert.equal(classes.has("is-indicator-moving"), true, "a subsequent user selection retains the sliding transition");
    assert.equal(values.get("--segmented-x"), "103px");
    flushFrames();

    activeButton = buttons[0];
    syncSegmentedIndicator(control, null, { animate: false });
    flushFrames();
    assert.deepEqual(commits.at(-1), { animated: false, visible: true, x: "3px" }, "revealing a settings page snaps to its value through the deferred layout check");

    visible = false;
    syncSegmentedIndicator(control);
    flushFrames();
    visible = true;
    activeButton = buttons[2];
    control.scrollLeft = 40;
    syncSegmentedIndicator(control);
    assert.deepEqual(commits.at(-1), { animated: false, visible: true, x: "203px" }, "layout coordinates remain attached to the option when the control scrolls");
    flushFrames();
  } finally {
    names.forEach((name, index) => {
      if (originals[index]) Object.defineProperty(globalThis, name, originals[index]);
      else delete globalThis[name];
    });
  }
}

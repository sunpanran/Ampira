import assert from "node:assert/strict";
import { bindElasticActionFeedback, bindNavigationPressFeedback, playElasticActionFeedback } from "../../assets/client/motion.mjs";

export function runBatchActionMotionTests() {
  const originals = new Map(["document", "matchMedia", "getComputedStyle"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let reduced = false;
  let currentTransform = "matrix(0.94, 0, 0, 0.9, 0, 1)";
  const calls = [];
  const events = new Map();
  const dispatch = (type, event = {}) => events.get(type)?.forEach(listener => listener(event));
  const button = {
    addEventListener(type, listener) {
      if (!events.has(type)) events.set(type, []);
      events.get(type).push(listener);
    },
    animate(keyframes, options) {
      const listeners = new Map();
      const animation = {
        keyframes, options, cancelled: false,
        addEventListener: (type, listener) => listeners.set(type, listener),
        cancel() { this.cancelled = true; listeners.get("cancel")?.(); },
        finish() { listeners.get("finish")?.(); },
      };
      calls.push(animation);
      return animation;
    },
  };
  try {
    globalThis.document = { hidden: false };
    globalThis.matchMedia = () => ({ matches: reduced });
    globalThis.getComputedStyle = () => ({ transform: calls.at(-1)?.cancelled ? "none" : currentTransform });
    const first = playElasticActionFeedback(button);
    assert.equal(first.keyframes[0].transform, currentTransform, "release starts at the visible held-down pose");
    currentTransform = "matrix(1.02, 0, 0, 1.02, 0, 0)";
    const second = playElasticActionFeedback(button);
    assert(first.cancelled, "rapid clicks must replace the previous animation");
    assert.equal(second.keyframes[0].transform, "matrix(1.02, 0, 0, 1.02, 0, 0)", "rapid clicks continue from the displayed pose without snapping");
    assert.equal(second.options.fill, "none", "completed feedback must not hold a transformed button");
    first.finish();
    const third = playElasticActionFeedback(button);
    assert(second.cancelled, "late completion of an old animation must not lose the current animation");
    third.finish();
    currentTransform = "none";
    const fourth = playElasticActionFeedback(button);
    assert.equal(third.cancelled, false, "finished feedback must release its tracked animation");
    assert.equal(fourth.keyframes[0].transform, "none", "keyboard and programmatic activation start from the resting pose");
    reduced = true;
    assert.equal(playElasticActionFeedback(button), null);
    assert(fourth.cancelled, "reduced motion must also cancel previously running feedback");
    reduced = false;
    globalThis.document.hidden = true;
    assert.equal(playElasticActionFeedback(button), null, "hidden pages skip feedback");
    globalThis.document.hidden = false;
    button.disabled = true;
    assert.equal(playElasticActionFeedback(button), null, "disabled buttons skip feedback");
    assert.equal(calls.length, 4, "suppressed feedback must not create effects");
    assert.equal(playElasticActionFeedback({}), null, "missing animation support keeps the action usable");
    assert.equal(playElasticActionFeedback(null), null);

    button.disabled = false;
    bindElasticActionFeedback(button);
    bindElasticActionFeedback(button);
    dispatch("pointerdown", { button: 2 });
    dispatch("pointerdown", { button: 0, isPrimary: false });
    assert.equal(calls.length, 4, "secondary buttons and pointers do not squeeze the control");
    dispatch("pointerdown", { button: 0 });
    const held = calls.at(-1);
    assert.equal(calls.length, 5, "binding twice must not duplicate press feedback");
    assert.equal(held.options.fill, "forwards", "long presses keep their compressed pose");
    held.finish();
    currentTransform = "matrix(0.94, 0, 0, 0.9, 0, 1)";
    const released = playElasticActionFeedback(button);
    assert(held.cancelled, "release must remove the held effect even after its animation finished");
    assert.equal(released.keyframes[0].transform, currentTransform);
    currentTransform = "matrix(1.04, 0, 0, 1.1, 0, -1)";
    dispatch("pointerdown", { button: 0 });
    assert(released.cancelled, "pressing again interrupts the rebound immediately");
    assert.equal(calls.at(-1).keyframes[0].transform, currentTransform, "repeat presses keep the visible rebound pose");
    const repressed = calls.at(-1);
    dispatch("pointercancel");
    assert(repressed.cancelled, "cancelled touch gestures release the held effect");
    assert.equal(calls.at(-1).options.fill, "none", "cancelled gestures cannot leave a transformed control");
    const afterCancel = calls.length;
    dispatch("pointerleave");
    dispatch("blur");
    assert.equal(calls.length, afterCancel, "cancelled presses settle only once");
    dispatch("keydown", { key: " ", repeat: false });
    const keyPress = calls.at(-1);
    dispatch("keydown", { key: " ", repeat: true });
    assert.equal(calls.at(-1), keyPress, "holding Space does not restart its press animation");
    dispatch("blur");
    assert(keyPress.cancelled, "leaving a focused button cancels an unfinished keyboard press");
    reduced = true;
    const beforeReduced = calls.length;
    dispatch("pointerdown", { button: 0 });
    dispatch("keydown", { key: "Enter" });
    assert.equal(calls.length, beforeReduced, "reduced motion skips pointer and keyboard compression");

    const navEvents = new Map(), navClasses = new Set();
    const nav = {
      classList: { add: name => navClasses.add(name), remove: name => navClasses.delete(name) },
      addEventListener: (type, listener) => navEvents.set(type, listener),
    };
    bindNavigationPressFeedback(nav);
    navEvents.get("pointerdown")({ button: 2 });
    assert(!navClasses.has("is-nav-pressed"), "secondary clicks do not press navigation controls");
    for (const type of ["pointerup", "pointercancel", "pointerleave", "blur"]) {
      navEvents.get("pointerdown")({ button: 0, isPrimary: true });
      assert(navClasses.has("is-nav-pressed"), "navigation responds immediately to primary touch or mouse input");
      navEvents.get(type)();
      assert(!navClasses.has("is-nav-pressed"), `${type} releases navigation feedback`);
    }
    nav.disabled = true;
    navEvents.get("pointerdown")({ button: 0 });
    assert(!navClasses.has("is-nav-pressed"), "disabled navigation cannot be pressed");
    assert.equal(calls.length, beforeReduced, "navigation feedback never uses the elastic animation");
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

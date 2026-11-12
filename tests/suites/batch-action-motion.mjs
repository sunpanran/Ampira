import assert from "node:assert/strict";
import { playBatchActionFeedback } from "../../assets/client/motion.mjs";

export function runBatchActionMotionTests() {
  const originals = new Map(["document", "matchMedia", "getComputedStyle"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let reduced = false;
  const calls = [];
  const button = {
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
    globalThis.getComputedStyle = () => {
      assert.equal(calls.at(-1).cancelled, false, "read the visible pose before cancelling the previous feedback");
      return { transform: "matrix(1.02, 0, 0, 1.02, 0, 0)" };
    };
    const first = playBatchActionFeedback(button);
    const second = playBatchActionFeedback(button);
    assert(first.cancelled, "rapid clicks must replace the previous animation");
    assert.equal(second.keyframes[0].transform, "matrix(1.02, 0, 0, 1.02, 0, 0)", "rapid clicks continue from the displayed pose without snapping");
    assert.equal(second.options.fill, "none", "completed feedback must not hold a transformed button");
    first.finish();
    const third = playBatchActionFeedback(button);
    assert(second.cancelled, "late completion of an old animation must not lose the current animation");
    third.finish();
    const fourth = playBatchActionFeedback(button);
    assert.equal(third.cancelled, false, "finished feedback must release its tracked animation");
    assert.equal(fourth.keyframes[0].transform, first.keyframes[0].transform, "the next isolated click starts with normal press feedback");
    reduced = true;
    assert.equal(playBatchActionFeedback(button), null);
    assert(fourth.cancelled, "reduced motion must also cancel previously running feedback");
    reduced = false;
    globalThis.document.hidden = true;
    assert.equal(playBatchActionFeedback(button), null, "hidden pages skip feedback");
    globalThis.document.hidden = false;
    button.disabled = true;
    assert.equal(playBatchActionFeedback(button), null, "disabled buttons skip feedback");
    assert.equal(calls.length, 4, "suppressed feedback must not create effects");
    assert.equal(playBatchActionFeedback({}), null, "missing animation support keeps the action usable");
    assert.equal(playBatchActionFeedback(null), null);
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

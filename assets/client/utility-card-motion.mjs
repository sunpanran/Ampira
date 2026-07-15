import { MOTION_DURATION, prefersReducedMotion } from "./motion.mjs";

const MODE_SWITCH_OUT_MS = MOTION_DURATION.press;
const MODE_SWITCH_IN_MS = MOTION_DURATION.state;
const BODY_OUT_CLASS = "is-utility-mode-leaving";
const BODY_IN_CLASS = "is-utility-mode-entering";
const HEADER_OUT_CLASS = "is-utility-header-leaving";
const HEADER_IN_CLASS = "is-utility-header-entering";

export function createUtilityCardMotion(options) {
  const { body, getHeaderTargets, render } = options;
  let animationToken = 0;
  const animatedNodes = new Set();

  return { run };

  function run() {
    const token = ++animationToken;
    resetAnimations();
    if (prefersReducedMotion()) {
      render();
      return;
    }

    applyAnimation(body, BODY_OUT_CLASS);
    getHeaderTargets().forEach((node) => applyAnimation(node, HEADER_OUT_CLASS));
    waitForAnimation(body, MODE_SWITCH_OUT_MS).then(() => {
      if (token !== animationToken) return;
      resetAnimations();
      render();
      applyAnimation(body, BODY_IN_CLASS);
      getHeaderTargets().forEach((node) => applyAnimation(node, HEADER_IN_CLASS));
      waitForAnimation(body, MODE_SWITCH_IN_MS).then(() => {
        if (token === animationToken) resetAnimations();
      });
    });
  }

  function applyAnimation(node, className) {
    animatedNodes.add(node);
    node.classList.add(className);
  }

  function resetAnimations() {
    animatedNodes.forEach((node) => node.classList.remove(
      BODY_OUT_CLASS,
      BODY_IN_CLASS,
      HEADER_OUT_CLASS,
      HEADER_IN_CLASS,
    ));
    animatedNodes.clear();
  }
}

function waitForAnimation(node, duration) {
  return new Promise((resolve) => {
    let settled = false;
    const onAnimationEnd = (event) => {
      if (event.target === node) finish();
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      node.removeEventListener("animationend", onAnimationEnd);
      resolve();
    };
    node.addEventListener("animationend", onAnimationEnd);
    globalThis.setTimeout(finish, duration + 50);
  });
}

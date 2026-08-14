export { animatePanelEntrance } from "./motion.mjs";

const TRANSIENT_LOAD_STATE_CLASSES = Object.freeze([
  "is-icon-pending",
  "is-preview-image-pending",
  "is-preview-image-revealing",
]);

export function cloneWithoutIconLoadState(node) {
  const clone = node.cloneNode(true);
  for (const className of TRANSIENT_LOAD_STATE_CLASSES) {
    removeTransientClass(clone, className);
    clone.querySelectorAll?.(`.${className}`)?.forEach((element) => removeTransientClass(element, className));
  }
  return clone;
}

function removeTransientClass(element, className) {
  element.classList?.remove(className);
  if (element.classList?.length === 0) element.removeAttribute?.("class");
}

export function nodesEqualIgnoringIconLoadState(currentNode, nextNode) {
  return cloneWithoutIconLoadState(currentNode).isEqualNode(cloneWithoutIconLoadState(nextNode));
}

export const nodesEqualIgnoringTransientLoadState = nodesEqualIgnoringIconLoadState;

export function srOnly(text) {
  const node = document.createElement("span");
  node.className = "sr-only";
  node.textContent = text;
  return node;
}

export function spanText(text, className) {
  const node = document.createElement("span");
  if (className) node.className = className;
  node.textContent = text;
  return node;
}

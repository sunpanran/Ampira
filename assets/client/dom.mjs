export { animatePanelEntrance } from "./motion.mjs";

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

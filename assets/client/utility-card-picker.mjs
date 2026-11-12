import { spanText } from "./dom.mjs";
import { createUtilityCardMotion } from "./utility-card-motion.mjs";

let pickerSequence = 0;

export function createUtilityCardPicker({ card, trigger, covered, choices, getValue, onSelect, t, createIcon, getFocusTarget = () => trigger }) {
  const panel = document.createElement("div");
  panel.className = "utility-type-picker";
  panel.hidden = true;
  const motion = createUtilityCardMotion(panel);
  let opened = false;
  const head = document.createElement("div");
  head.className = "utility-type-picker-head";
  const title = spanText("", "utility-type-picker-title");
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "action-toggle utility-switch";
  closeButton.append(createIcon("x-close", "action-toggle-icon"));
  closeButton.addEventListener("click", () => close());
  head.append(title, closeButton);
  const menu = document.createElement("div");
  menu.id = `utilityTypePicker-${++pickerSequence}`;
  menu.className = "utility-type-options";
  menu.setAttribute("role", "menu");
  const buttons = choices.map(({ value, icon, labelKey }) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "utility-type-option";
    button.dataset.utilityType = value;
    button.setAttribute("role", "menuitemradio");
    button.tabIndex = -1;
    const label = spanText("", "utility-type-label");
    const check = createIcon("check", "utility-type-check");
    button.append(createIcon(icon, "utility-type-icon"), label, check);
    button.addEventListener("click", () => {
      const changed = value !== getValue();
      if (changed) onSelect(value);
      close();
    });
    menu.append(button);
    return { button, label, value, labelKey };
  });
  panel.append(head, menu);
  card.append(panel);
  trigger?.setAttribute("aria-haspopup", "menu");
  trigger?.setAttribute("aria-controls", menu.id);
  trigger?.setAttribute("aria-expanded", "false");
  panel.addEventListener("keydown", onKeydown);

  return { sync, open, close, isOpen: () => opened };

  function sync() {
    title.textContent = t("utility.cardType");
    const label = t("utility.chooseType");
    if (trigger) trigger.title = label;
    trigger?.setAttribute("aria-label", label);
    menu.setAttribute("aria-label", label);
    closeButton.title = t("action.close");
    closeButton.setAttribute("aria-label", closeButton.title);
    for (const entry of buttons) {
      entry.label.textContent = t(entry.labelKey);
      entry.button.setAttribute("aria-checked", String(entry.value === getValue()));
    }
  }

  function open() {
    if (opened) return;
    opened = true;
    sync();
    panel.inert = false;
    motion.show();
    covered.forEach((node) => { node.inert = true; });
    trigger?.setAttribute("aria-expanded", "true");
    focusOption(buttons.find(({ value }) => value === getValue())?.button);
    document.addEventListener("pointerdown", onOutsidePointer, true);
    document.addEventListener("focusin", onOutsideFocus);
  }

  function close({ restoreFocus = true, animate = true } = {}) {
    if (!opened) return;
    opened = false;
    document.removeEventListener("pointerdown", onOutsidePointer, true);
    document.removeEventListener("focusin", onOutsideFocus);
    panel.inert = true;
    covered.forEach((node) => { node.inert = false; });
    trigger?.setAttribute("aria-expanded", "false");
    if (restoreFocus) getFocusTarget()?.focus({ preventScroll: true });
    motion.hide({ animate });
  }

  function onOutsidePointer(event) {
    if (!panel.contains(event.target)) close();
  }

  function onOutsideFocus(event) {
    if (!panel.contains(event.target)) close({ restoreFocus: false });
  }

  function focusOption(button) {
    if (!button) return;
    button.focus({ preventScroll: true });
    const top = button.offsetTop - menu.offsetTop;
    const bottom = top + button.offsetHeight;
    if (top < menu.scrollTop + 4) menu.scrollTop = Math.max(0, top - 4);
    else if (bottom > menu.scrollTop + menu.clientHeight - 4) menu.scrollTop = bottom - menu.clientHeight + 4;
  }

  function onKeydown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === "Tab") {
      close();
      return;
    }
    const index = buttons.findIndex(({ button }) => button === document.activeElement);
    if (index < 0) return;
    let next;
    if (["ArrowRight", "ArrowDown"].includes(event.key)) next = (index + 1) % buttons.length;
    else if (["ArrowLeft", "ArrowUp"].includes(event.key)) next = (index + buttons.length - 1) % buttons.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = buttons.length - 1;
    else return;
    event.preventDefault();
    event.stopPropagation();
    focusOption(buttons[next].button);
  }
}

import { spanText } from "./dom.mjs";
import { createUtilityCardMotion } from "./utility-card-motion.mjs";

let pickerSequence = 0;
let activePicker = null;

export function createUtilityCardPicker({ card, trigger, covered, choices, getValue, onSelect, t, createIcon, getFocusTarget = () => trigger }) {
  const dialog = document.createElement("dialog");
  dialog.className = "utility-type-dialog";
  const backdrop = document.createElement("div");
  backdrop.className = "utility-type-backdrop";
  backdrop.setAttribute("aria-hidden", "true");
  const panel = document.createElement("div");
  panel.className = "utility-type-picker";
  panel.hidden = true;
  const motion = createUtilityCardMotion(panel, { card, backdrop, onHidden: finishClose });
  let opened = false;
  let restoreFocusOnClose = true;
  let coveredState = [];
  let focusedOption;
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
  dialog.id = `${menu.id}-dialog`;
  menu.className = "utility-type-options";
  menu.setAttribute("role", "menu");
  title.id = `${menu.id}-title`;
  dialog.setAttribute("aria-labelledby", title.id);
  const groups = new Map();
  const buttons = choices.map(({ value, icon, labelKey, groupKey }) => {
    let group = groups.get(groupKey);
    if (groupKey && !group) {
      const container = document.createElement("div");
      container.className = "utility-type-group";
      container.setAttribute("role", "group");
      const heading = spanText("", "utility-type-group-title");
      heading.id = `${menu.id}-group-${groups.size}`;
      container.setAttribute("aria-labelledby", heading.id);
      container.append(heading);
      menu.append(container);
      group = { container, heading, labelKey: groupKey };
      groups.set(groupKey, group);
    }
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
    const scrollTarget = group?.container.children.length === 1 ? group.heading : button;
    (group?.container || menu).append(button);
    return { button, label, value, labelKey, scrollTarget };
  });
  if (groups.size > 1 && choices.every(choice => choice.groupKey)) {
    const columns = [document.createElement("div"), document.createElement("div")];
    columns.forEach(column => { column.className = "utility-type-column"; });
    const split = Math.ceil(groups.size / 2);
    [...groups.values()].forEach((group, index) => columns[index < split ? 0 : 1].append(group.container));
    menu.append(...columns);
  }
  panel.append(head, menu);
  dialog.append(backdrop, panel);
  trigger?.setAttribute("aria-haspopup", "dialog");
  trigger?.setAttribute("aria-controls", dialog.id);
  trigger?.setAttribute("aria-expanded", "false");
  panel.addEventListener("keydown", onKeydown);
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
  dialog.addEventListener("pointerdown", (event) => {
    if (event.target === dialog || event.target === backdrop) {
      event.preventDefault();
      close();
    }
  });

  const picker = { sync, open, close, isOpen: () => opened };
  return picker;

  function sync() {
    title.textContent = t("context.switchCard");
    const label = t("utility.chooseType");
    if (trigger) trigger.title = label;
    trigger?.setAttribute("aria-label", label);
    menu.setAttribute("aria-label", label);
    closeButton.title = t("action.close");
    closeButton.setAttribute("aria-label", closeButton.title);
    for (const group of groups.values()) group.heading.textContent = t(group.labelKey);
    for (const entry of buttons) {
      entry.label.textContent = t(entry.labelKey);
      entry.button.setAttribute("aria-checked", String(entry.value === getValue()));
    }
  }

  function open() {
    if (opened) return;
    if (activePicker && activePicker !== picker) activePicker.close({ restoreFocus: false, animate: false });
    activePicker = picker;
    opened = true;
    sync();
    panel.inert = false;
    if (!dialog.open) {
      document.body.append(dialog);
      dialog.showModal();
      coveredState = covered.map(node => [node, node.inert]);
      covered.forEach(node => { node.inert = true; });
      card.classList.add("is-type-picker-source");
      globalThis.addEventListener?.("resize", onViewportChange);
    }
    motion.show();
    trigger?.setAttribute("aria-expanded", "true");
    focusOption(buttons.find(({ value }) => value === getValue()));
  }

  function close({ restoreFocus = true, animate = true } = {}) {
    if (!opened && (!dialog.open || animate)) return;
    opened = false;
    restoreFocusOnClose = restoreFocus;
    panel.inert = true;
    trigger?.setAttribute("aria-expanded", "false");
    motion.hide({ animate });
  }

  function finishClose() {
    card.classList.remove("is-type-picker-source");
    coveredState.forEach(([node, inert]) => { node.inert = inert; });
    coveredState = [];
    if (dialog.open) dialog.close();
    dialog.remove();
    globalThis.removeEventListener?.("resize", onViewportChange);
    if (activePicker === picker) activePicker = null;
    if (restoreFocusOnClose) getFocusTarget()?.focus({ preventScroll: true });
  }

  function onViewportChange() {
    if (opened) motion.show({ animate: false });
    else close({ animate: false, restoreFocus: restoreFocusOnClose });
  }

  function focusOption(entry) {
    if (!entry) return;
    const { button, scrollTarget } = entry;
    focusedOption = entry;
    buttons.forEach(option => { option.button.tabIndex = option === entry ? 0 : -1; });
    button.focus({ preventScroll: true });
    const rect = menu.getBoundingClientRect();
    const scale = menu.offsetHeight > 0 ? rect.height / menu.offsetHeight || 1 : 1;
    const top = (scrollTarget.getBoundingClientRect().top - rect.top) / scale + menu.scrollTop;
    const bottom = (button.getBoundingClientRect().bottom - rect.top) / scale + menu.scrollTop;
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
      event.preventDefault();
      if (document.activeElement === closeButton) focusOption(focusedOption);
      else closeButton.focus({ preventScroll: true });
      return;
    }
    const index = buttons.findIndex(({ button }) => button === document.activeElement);
    if (index < 0) return;
    let next;
    if (["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)) next = directionalOption(index, event.key);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = buttons.length - 1;
    else return;
    event.preventDefault();
    event.stopPropagation();
    focusOption(buttons[next]);
  }

  function directionalOption(index, key) {
    const horizontal = key === "ArrowRight" || key === "ArrowLeft";
    const direction = key === "ArrowRight" || key === "ArrowDown" ? 1 : -1;
    const origin = buttons[index].button.getBoundingClientRect();
    const centerX = origin.left + origin.width / 2;
    const centerY = origin.top + origin.height / 2;
    const candidates = buttons.map(({ button }, candidate) => {
      const rect = button.getBoundingClientRect();
      return { candidate, x: rect.left + rect.width / 2 - centerX, y: rect.top + rect.height / 2 - centerY };
    }).filter(({ x, y }) => horizontal ? x * direction > 1 : y * direction > 1 && Math.abs(x) < origin.width / 2);
    candidates.sort((a, b) => horizontal
      ? Math.abs(a.y) - Math.abs(b.y) || Math.abs(a.x) - Math.abs(b.x)
      : Math.abs(a.y) - Math.abs(b.y));
    return candidates[0]?.candidate ?? (index + direction + buttons.length) % buttons.length;
  }
}

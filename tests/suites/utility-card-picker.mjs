import assert from "node:assert/strict";
import { createUtilityCardPicker } from "../../assets/client/utility-card-picker.mjs";
import { createUtilityCardMotion } from "../../assets/client/utility-card-motion.mjs";
import { MOTION_DURATION } from "../../assets/client/motion.mjs";
import { DASHBOARD_CARD_GROUPS, CARD_TYPE_ICONS, CARD_TYPE_TITLES } from "../../assets/client/dashboard-card-types.mjs";

export function runUtilityCardPickerTests() {
  const previousDocument = globalThis.document;
  const doc = new TestNode();
  doc.createElement = () => new TestNode(doc);
  doc.body = doc.createElement();
  globalThis.document = doc;
  try {
    const card = doc.createElement();
    const trigger = doc.createElement();
    const head = doc.createElement();
    const body = doc.createElement();
    head.append(trigger);
    card.append(head, body);
    let value = "weather", locale = "en";
    const selections = [];
    const picker = createUtilityCardPicker({
      card, trigger, covered: [head, body],
      choices: ["events", "weather", "stocks", "todo", "countdown", "digest", "archive"].map((mode) => ({ value: mode, icon: mode, labelKey: mode })),
      getValue: () => value,
      onSelect: (mode) => { value = mode; selections.push(mode); picker.sync(); },
      t: (key) => `${locale}:${key}`,
      createIcon: () => doc.createElement(),
    });
    picker.sync();
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    picker.open();
    const dialog = doc.body.children[0];
    const [backdrop, panel] = dialog.children;
    const [pickerHead, menu] = panel.children;
    const [events, weather, stocks, todo, countdown, digest, archive] = menu.children;
    menu.offsetTop = 0; menu.clientHeight = 72; menu.scrollTop = 0;
    menu.children.forEach((button, index) => { button.offsetTop = index * 34; button.offsetHeight = 32; });
    const open = () => picker.open();
    const key = (name) => panel.emit("keydown", { key: name });
    assert.equal(trigger.getAttribute("aria-controls"), dialog.id);
    assert.equal(trigger.getAttribute("aria-haspopup"), "dialog");
    open();
    assert.equal(value, "weather", "opening the chooser must not cycle or persist a mode");
    assert.deepEqual(selections, []);
    assert.equal(panel.hidden, false);
    assert(dialog.open && card.classList.contains("is-type-picker-source"), "the floating chooser hides the original without changing its layout slot");
    assert(head.inert && body.inert, "covered content must not receive keyboard or pointer interaction");
    assert.equal(doc.activeElement, weather, "focus starts on the current type");
    assert.deepEqual(menu.children.map((node) => node.getAttribute("aria-checked")), ["false", "true", "false", "false", "false", "false", "false"]);
    assert(key("ArrowRight").defaultPrevented);
    assert.equal(doc.activeElement, stocks);
    key("ArrowRight");
    assert.equal(doc.activeElement, todo);
    key("ArrowRight"); assert.equal(doc.activeElement, countdown);
    key("ArrowRight"); assert.equal(doc.activeElement, digest);
    key("ArrowRight"); assert.equal(doc.activeElement, archive);
    key("ArrowRight"); assert.equal(doc.activeElement, events);
    key("ArrowUp"); assert.equal(doc.activeElement, archive);
    key("Home"); assert.equal(doc.activeElement, events);
    assert.equal(menu.scrollTop, 0, "Home returns the internal list to the first option");
    key("End"); assert.equal(doc.activeElement, archive);
    assert(menu.scrollTop > 0, "keyboard navigation scrolls the final option into view");
    assert.deepEqual(selections, [], "moving focus must not commit a choice");
    todo.emit("click");
    assert.deepEqual(selections, ["todo"], "select the requested mode directly");
    assert(panel.hidden && !head.inert && !body.inert);
    assert(!dialog.open && doc.body.children.length === 0, "closing releases the modal and removes its detached layer");
    assert(!card.classList.contains("is-type-picker-source"));
    assert.equal(doc.activeElement, trigger);
    open(); todo.emit("click");
    assert.deepEqual(selections, ["todo"], "reselecting the current type must preserve its editor and avoid writes");
    open();
    locale = "zh-CN"; picker.sync();
    assert.equal(panel.hidden, false, "background rendering must keep the chooser open");
    assert.equal(doc.activeElement, todo);
    assert.equal(todo.children[1].textContent, "zh-CN:todo");
    assert(key("Escape").defaultPrevented);
    assert(panel.hidden && !head.inert && !body.inert);
    assert.equal(doc.activeElement, trigger);
    open();
    assert(key("Tab").defaultPrevented, "Tab stays within the modal chooser");
    assert.equal(doc.activeElement, pickerHead.children[1]);
    key("Tab");
    assert.equal(doc.activeElement, todo, "Tab returns to the current keyboard option");
    dialog.emit("pointerdown", { target: events });
    assert(!panel.hidden, "an option's pointerdown must not dismiss before its click");
    dialog.emit("pointerdown", { target: backdrop });
    assert(panel.hidden);
    open();
    assert(dialog.emit("cancel").defaultPrevented, "native Escape waits for the return animation before releasing the modal");
    assert(panel.hidden && !dialog.open);
    open(); pickerHead.children[1].emit("click");
    assert(panel.hidden);
    for (const button of [events, weather, stocks, countdown, digest, archive]) { open(); button.emit("click"); }
    assert.deepEqual(selections, ["todo", "events", "weather", "stocks", "countdown", "digest", "archive"]);
    picker.open();
    assert.equal(panel.hidden, false);
    picker.close({ restoreFocus: false });
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    const largeCard = doc.createElement(), largeHead = doc.createElement(), hiddenTrigger = doc.createElement();
    largeCard.append(largeHead, hiddenTrigger);
    const largePicker = createUtilityCardPicker({
      card: largeCard, covered: [largeHead],
      choices: ["queue", "inspiration", "news"].map(type => ({ value: type, icon: type, labelKey: type })),
      getValue: () => "queue", onSelect() {}, t: key => key, createIcon: () => doc.createElement(),
      getFocusTarget: () => largeHead,
    });
    picker.open(); largePicker.open();
    assert(!dialog.open && !head.inert, "opening another card releases the preceding chooser immediately");
    assert.equal(doc.body.children.length, 1, "only one chooser may occupy the top layer");
    largePicker.close();
    assert.equal(doc.activeElement, largeHead, "context-only pickers restore focus to the card title without a switch button");
    body.inert = true;
    picker.open(); picker.close();
    assert(body.inert, "existing disabled content remains disabled after the modal closes");
    testGroupedPicker(doc);
    testPickerMotion(doc);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
}

function testGroupedPicker(doc) {
  const card = doc.createElement(), head = doc.createElement();
  card.append(head);
  let value = "topics", locale = "en";
  const selections = [];
  const picker = createUtilityCardPicker({
    card, covered: [head], getFocusTarget: () => head,
    choices: DASHBOARD_CARD_GROUPS.flatMap(group => group.types.map(type => ({
      value: type, icon: CARD_TYPE_ICONS[type], labelKey: CARD_TYPE_TITLES[type], groupKey: group.labelKey,
    }))),
    getValue: () => value, onSelect: type => { value = type; selections.push(type); },
    t: key => `${locale}:${key}`, createIcon: () => doc.createElement(),
  });
  picker.open();
  const dialog = doc.body.children[0], panel = dialog.children[1], menu = panel.children[1];
  menu.offsetTop = 0; menu.clientHeight = 90; menu.scrollTop = 0;
  let offset = 4;
  const buttons = [];
  const groups = menu.children.flatMap(column => column.children);
  assert.equal(menu.children.length, 2, "the four categories occupy two independent columns");
  groups.forEach((group, index) => {
    assert.equal(group.getAttribute("role"), "group");
    const [heading, ...options] = group.children;
    assert.equal(group.getAttribute("aria-labelledby"), heading.id, "each group has an accessible category name");
    assert.equal(options.length, DASHBOARD_CARD_GROUPS[index].types.length);
    heading.offsetTop = offset; heading.offsetHeight = 24; offset += 26;
    options.forEach(button => {
      button.offsetTop = offset; button.offsetHeight = 32; offset += 34;
      buttons.push(button);
    });
    offset += 8;
  });
  assert.equal(doc.activeElement.dataset.utilityType, "topics", "current choice stays focused after grouping");
  assert.equal(buttons.filter(button => button.getAttribute("aria-checked") === "true").length, 1);
  panel.emit("keydown", { key: "ArrowDown" });
  assert.equal(doc.activeElement.dataset.utilityType, "queue", "arrow navigation crosses headings without focusing them");
  panel.emit("keydown", { key: "End" });
  assert.equal(doc.activeElement.dataset.utilityType, "stocks");
  assert(menu.scrollTop > 0);
  panel.emit("keydown", { key: "Home" });
  assert.equal(doc.activeElement.dataset.utilityType, "news");
  assert.equal(menu.scrollTop, 0, "Home reveals the first category heading as well as its first option");
  panel.emit("keydown", { key: "ArrowUp" });
  assert.equal(doc.activeElement.dataset.utilityType, "stocks", "navigation wraps across the grouped list");
  locale = "zh-CN"; picker.sync();
  groups.forEach((group, index) => {
    assert.equal(group.children[0].textContent, `zh-CN:${DASHBOARD_CARD_GROUPS[index].labelKey}`);
  });
  assert.equal(doc.activeElement.dataset.utilityType, "stocks", "localizing headings preserves focus");
  assert.deepEqual(selections, [], "navigation and localization must not save a selection");
  buttons.find(button => button.dataset.utilityType === "queue").emit("click");
  assert.deepEqual(selections, ["queue"]);
  assert(panel.hidden && !head.inert);
  assert.equal(doc.activeElement, head);
  for (const button of buttons) {
    picker.open();
    button.emit("click");
    assert.equal(value, button.dataset.utilityType, "every grouped type selects the requested card");
    assert(!dialog.open && !head.inert);
  }
}

function testPickerMotion(doc) {
  const panel = doc.createElement(), card = doc.createElement(), backdrop = doc.createElement();
  const head = doc.createElement(), menu = doc.createElement();
  panel.append(head, menu);
  card.rect = { left: 40, top: 60, width: 310, height: 220 };
  const expanded = { left: 350, top: 280, width: 620, height: 440 };
  panel.rect = expanded;
  panel.hidden = true;
  const animations = [];
  for (const node of [panel, card, backdrop, head, menu]) {
    const styles = new Map();
    node.style = {
      getPropertyValue: name => styles.get(name) || "",
      setProperty: (name, value) => styles.set(name, value),
      removeProperty: name => styles.delete(name),
    };
    node.animate = (frames, options) => {
      const animation = new TestNode();
      animation.cancel = () => {
        animation.cancelled = true;
        if (node === panel && frames[0].transform) panel.rect = expanded;
      };
      Object.assign(animation, { node, frames, options });
      animations.push(animation);
      return animation;
    };
  }
  card.style.setProperty("will-change", "filter");
  const previousStyle = globalThis.getComputedStyle;
  globalThis.getComputedStyle = node => ({ opacity: node.opacity ?? 1 });
  try {
    let hiddenCount = 0;
    const motion = createUtilityCardMotion(panel, { card, backdrop, onHidden: () => { hiddenCount += 1; } });
    const track = (node, property) => animations.findLast(animation => animation.node === node && property in animation.frames[0]);
    motion.show();
    const opening = track(panel, "transform");
    assert.deepEqual(opening.frames, [
      { transform: "translate(-310px, -220px) scale(0.5, 0.5)" }, { transform: "none" },
    ], "the moving surface begins at the original card's viewport bounds");
    assert.deepEqual(track(card, "opacity").frames, [{ opacity: 1 }, { opacity: 0 }], "the original card fades out instead of disappearing on the first frame");
    assert.deepEqual(track(panel, "opacity").options, track(card, "opacity").options, "the original and floating surfaces share one crossfade clock");
    assert(track(head, "opacity").options.delay > 0 && track(menu, "opacity").options.delay > 0, "text appears after the shell starts expanding");
    panel.rect = { left: 195, top: 170, width: 465, height: 330 };
    panel.opacity = .75; card.opacity = .25; head.opacity = .5; menu.opacity = .5;
    motion.hide();
    const closing = track(panel, "transform");
    assert(opening.cancelled);
    assert.equal(closing.frames[0].transform, "translate(-155px, -110px) scale(0.75, 0.75)", "reversal starts at the visible in-flight bounds");
    assert.equal(closing.frames[1].transform, "translate(-310px, -220px) scale(0.5, 0.5)");
    assert.equal(track(panel, "opacity").frames[0].opacity, .75);
    assert.equal(track(card, "opacity").frames[0].opacity, .25);
    assert.equal(track(menu, "opacity").frames[0].opacity, .5, "reversal also preserves the text's current opacity");
    const reveal = track(card, "opacity"), fade = track(panel, "opacity");
    assert.deepEqual(reveal.options, fade.options);
    assert(reveal.options.delay > 0 && reveal.options.delay + reveal.options.duration === closing.options.duration, "the source card appears during the final leg, before the modal is removed");
    assert.equal(reveal.frames[1].opacity, 1);
    assert(track(menu, "opacity").options.duration < closing.options.duration, "text fades before the shrinking surface arrives");
    assert(opening.options.duration > closing.options.duration && closing.options.duration >= MOTION_DURATION.move);
    assert(!panel.hidden && hiddenCount === 0);
    motion.show();
    closing.emit("finish");
    assert(!panel.hidden && hiddenCount === 0, "a stale close cannot hide a reopened picker or steal focus");
    track(panel, "transform").emit("finish");
    assert(!panel.hidden && animations.every(animation => animation.cancelled));
    assert.equal(panel.style.getPropertyValue("will-change"), "");
    assert.equal(card.style.getPropertyValue("will-change"), "filter", "cleanup restores existing rendering hints");
    motion.hide(); track(panel, "transform").emit("finish");
    assert(panel.hidden && hiddenCount === 1);
    const count = animations.length;
    doc.hidden = true;
    motion.show();
    assert(!panel.hidden && animations.length === count, "hidden documents skip all animation phases");
    doc.hidden = false;
    motion.hide({ animate: false });
    assert(panel.hidden && animations.length === count && hiddenCount === 2);
  } finally {
    doc.hidden = false;
    if (previousStyle === undefined) delete globalThis.getComputedStyle;
    else globalThis.getComputedStyle = previousStyle;
  }
}

class TestNode {
  constructor(doc) {
    this.doc = doc;
    this.children = [];
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
    const classes = new Set();
    this.classList = { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) };
  }
  append(...nodes) { nodes.forEach(node => { node.remove(); this.children.push(node); node.parentElement = this; }); }
  remove() {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(node => node !== this);
    this.parentElement = null;
  }
  showModal() { this.open = true; }
  close() { this.open = false; }
  getBoundingClientRect() {
    if (this.rect) return { ...this.rect, bottom: this.rect.top + this.rect.height, right: this.rect.left + this.rect.width };
    let parent = this.parentElement;
    while (parent && parent.className !== "utility-type-options") parent = parent.parentElement;
    const top = (this.offsetTop || 0) - (parent?.scrollTop || 0);
    const height = this.offsetHeight || 0;
    return { left: 0, width: 200, top, height, bottom: top + height };
  }
  contains(node) { return this === node || this.children.some((child) => child.contains(node)); }
  setAttribute(key, value) { this.attributes.set(key, value); }
  getAttribute(key) { return this.attributes.get(key); }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  focus() { this.doc.activeElement = this; this.doc.emit("focusin", { target: this }); }
  emit(type, values = {}) {
    const event = { target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...values };
    for (const listener of this.listeners.get(type) || []) listener(event);
    return event;
  }
}

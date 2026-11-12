import assert from "node:assert/strict";
import { createUtilityCardPicker } from "../../assets/client/utility-card-picker.mjs";
import { createUtilityCardMotion } from "../../assets/client/utility-card-motion.mjs";
import { MOTION_DURATION } from "../../assets/client/motion.mjs";

export function runUtilityCardPickerTests() {
  const previousDocument = globalThis.document;
  const doc = new TestNode();
  doc.createElement = () => new TestNode(doc);
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
    const panel = card.children[2];
    const [pickerHead, menu] = panel.children;
    const [events, weather, stocks, todo, countdown, digest, archive] = menu.children;
    menu.offsetTop = 0; menu.clientHeight = 72; menu.scrollTop = 0;
    menu.children.forEach((button, index) => { button.offsetTop = index * 34; button.offsetHeight = 32; });
    const open = () => picker.open();
    const key = (name) => panel.emit("keydown", { key: name });
    assert.equal(trigger.getAttribute("aria-controls"), menu.id);
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    open();
    assert.equal(value, "weather", "opening the chooser must not cycle or persist a mode");
    assert.deepEqual(selections, []);
    assert.equal(panel.hidden, false);
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
    assert.equal(doc.listeners.get("pointerdown").size, 0, "dismissal removes document listeners");
    open();
    assert(!key("Tab").defaultPrevented, "Tab must dismiss and retain native forward/backward navigation");
    assert(panel.hidden);
    open();
    doc.emit("pointerdown", { target: events });
    assert(!panel.hidden, "an option's pointerdown must not dismiss before its click");
    const outside = doc.createElement();
    doc.emit("pointerdown", { target: outside });
    assert(panel.hidden);
    open(); outside.focus();
    assert(panel.hidden);
    assert.equal(doc.activeElement, outside, "outside focus must not be stolen back");
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
    largePicker.open(); largePicker.close();
    assert.equal(doc.activeElement, largeHead, "context-only pickers restore focus to the card title without a switch button");
    testPickerMotion(doc);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
}

function testPickerMotion(doc) {
  const panel = doc.createElement();
  panel.hidden = true;
  const styles = new Map();
  panel.style = {
    setProperty: (name, value) => styles.set(name, value),
    removeProperty: (name) => styles.delete(name),
  };
  const animations = [];
  panel.animate = (frames, options) => {
    const animation = new TestNode();
    animation.cancel = () => { animation.cancelled = true; animation.emit("cancel"); };
    animation.frames = frames;
    animation.options = options;
    animations.push(animation);
    return animation;
  };
  const motion = createUtilityCardMotion(panel);
  motion.show();
  assert.equal(styles.get("will-change"), "auto", "opacity-only picker fades must not create a transform layer that shifts text when removed");
  assert.deepEqual(animations[0].frames, [{ opacity: 0 }, { opacity: 1 }], "opening must fade without moving the card or its contents");
  assert.equal(animations[0].options.duration, MOTION_DURATION.state);
  motion.hide();
  assert(animations[0].cancelled, "reversing the transition cancels the preceding animation");
  assert.equal(animations[1].options.duration, MOTION_DURATION.press);
  assert(!panel.hidden, "keep the closing layer mounted until its fade completes");
  motion.show();
  animations[1].emit("finish");
  assert(!panel.hidden, "an obsolete close animation must not hide a reopened picker");
  animations[2].emit("finish");
  assert(!panel.hidden && animations[2].cancelled, "opening cleans up its completed effect");
  assert(!styles.has("will-change"), "finishing must release temporary animation hints");
  motion.hide(); animations[3].emit("finish");
  assert(panel.hidden && animations[3].cancelled, "closing hides the picker and removes its effect");
  doc.hidden = true;
  motion.show();
  assert(!panel.hidden && animations.length === 4, "hidden documents must change state without animation");
  doc.hidden = false;
  motion.hide({ animate: false });
  assert(panel.hidden && animations.length === 4);
}

class TestNode {
  constructor(doc) {
    this.doc = doc;
    this.children = [];
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
  }
  append(...nodes) { this.children.push(...nodes); }
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

import assert from "node:assert/strict";
import { bindControlFeedback } from "../../assets/client/control-feedback.mjs";

export function runControlFeedbackTests() {
  const view = events(), doc = events();
  let reduced = false;
  view.matchMedia = () => ({ matches: reduced });
  Object.assign(doc, { defaultView: view, documentElement: control(), hidden: false });
  const dispose = bindControlFeedback(doc);
  assert.equal(bindControlFeedback(doc), dispose, "repeated initialization reuses one delegated binding");
  const button = control();
  const icon = { closest: () => button };
  const dispatch = (type, detail = {}) => doc.emit(type, { target: button, pointerId: 1, button: 0, ...detail });
  const isPressed = element => element.classList.contains("is-control-pressed");
  const down = detail => dispatch("pointerdown", detail);

  down({ button: 2 });
  down({ isPrimary: false });
  assert(!isPressed(button), "secondary clicks and pointers must not press controls");
  down({ target: icon, pointerType: "touch" });
  assert(isPressed(button), "touching a nested icon responds before click activation");
  dispatch("pointerup", { pointerId: 2 });
  assert(isPressed(button), "another pointer cannot release the primary press");
  dispatch("pointerout", { relatedTarget: button.child });
  assert(isPressed(button), "moving within a control retains its press");
  dispatch("pointerout", { relatedTarget: {} });
  assert(!isPressed(button), "leaving a control cancels its press");
  for (const type of ["pointerup", "pointercancel", "lostpointercapture", "dragstart", "focusout"]) {
    down();
    dispatch(type);
    assert(!isPressed(button), `${type} releases a held control`);
  }
  down();
  view.emit("blur");
  assert(!isPressed(button), "switching windows releases feedback");
  down();
  doc.hidden = true;
  doc.emit("visibilitychange");
  assert(!isPressed(button));
  down();
  assert(!isPressed(button), "hidden documents do not start feedback");
  doc.hidden = false;

  for (const key of [" ", "Enter"]) {
    dispatch("keydown", { key });
    assert(isPressed(button));
    const count = button.additions;
    dispatch("keydown", { key, repeat: true });
    assert.equal(button.additions, count, "holding a key must not restart the press");
    dispatch("keyup", { key: "ArrowLeft" });
    assert(isPressed(button), "unrelated keys cannot release a held activation key");
    dispatch("keyup", { key });
    assert(!isPressed(button));
  }
  dispatch("keydown", { key: "Enter", ctrlKey: true });
  assert(!isPressed(button), "shortcuts do not pretend to activate the focused control");

  for (const property of ["disabled", "excluded", "ancestorDisabled"]) {
    button[property] = true;
    down();
    assert(!isPressed(button), `${property} controls are skipped`);
    button[property] = false;
  }
  reduced = true;
  down();
  dispatch("keydown", { key: " " });
  assert(!isPressed(button), "reduced motion skips transient press state");
  reduced = false;

  const dynamic = control();
  down({ target: dynamic });
  assert(isPressed(dynamic), "newly rendered controls need no per-element binding");
  view.emit("blur", { target: button }, { captureOnly: true });
  dispatch("focusout");
  assert(isPressed(dynamic), "the previous button losing focus must not release the new press");
  down();
  assert(!isPressed(dynamic) && isPressed(button), "a new press replaces the previous target");
  const input = control("input");
  input.toggle = true;
  const label = control("label");
  label.control = input;
  down({ target: label });
  assert(isPressed(input) && !isPressed(label), "switch labels press the visual toggle, not the whole settings row");
  dispatch("pointerup");
  dispatch("keydown", { target: label, key: "Enter" });
  assert(!isPressed(input), "Enter does not activate a checkbox");
  const link = control("a");
  dispatch("keydown", { target: link, key: " " });
  assert(!isPressed(link), "Space retains native link scrolling");

  down();
  dispose();
  assert(!isPressed(button));
  assert(!doc.documentElement.classList.contains("has-control-feedback"));
  assert.equal(doc.count() + view.count(), 0, "disposal removes all delegated listeners");
}

function control(tag = "button") {
  const classes = new Set();
  const element = {
    additions: 0, child: {},
    classList: {
      add(name) { classes.add(name); element.additions++; },
      remove: name => classes.delete(name), contains: name => classes.has(name),
    },
    closest(selector) {
      if (selector === "[inert], [aria-disabled='true']") return element.ancestorDisabled ? {} : null;
      if (selector === ".toggle") return element.toggle ? {} : null;
      return element;
    },
    matches(selector) {
      if (selector.includes(":disabled")) return element.disabled || element.excluded;
      return selector.split(", ").includes(tag);
    },
    contains: node => node === element || node === element.child,
  };
  return element;
}

function events() {
  const listeners = new Map();
  return {
    addEventListener(type, handler, capture) {
      if (!listeners.has(type)) listeners.set(type, new Map());
      listeners.get(type).set(handler, capture);
    },
    removeEventListener: (type, handler) => listeners.get(type)?.delete(handler),
    emit(type, event = {}, { captureOnly = false } = {}) {
      for (const [handler, capture] of listeners.get(type) || []) if (!captureOnly || capture) handler(event);
    },
    count: () => [...listeners.values()].reduce((sum, list) => sum + list.size, 0),
  };
}

import assert from "node:assert/strict";
import { createConfirmationDialogController } from "../../assets/client/confirmation-dialog.mjs";
import {
  MANUAL_AI_USAGE_ACKNOWLEDGED,
  MANUAL_AI_USAGE_NOTICE_KEY,
  createManualAiUsageNoticeController,
} from "../../assets/client/manual-ai-usage-notice.mjs";

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  toggle(value, force) {
    if (force) this.values.add(value);
    else this.values.delete(value);
  }

  contains(value) {
    return this.values.has(value);
  }

  add(...values) {
    values.forEach((value) => this.values.add(value));
  }

  remove(...values) {
    values.forEach((value) => this.values.delete(value));
  }
}

class FakeControl extends EventTarget {
  constructor() {
    super();
    this.classList = new FakeClassList();
    this.focusCount = 0;
    this.isConnected = true;
    this.textContent = "";
  }

  focus() {
    this.focusCount += 1;
  }
}

class FakeDialog extends FakeControl {
  constructor() {
    super();
    this.open = false;
    this.showCount = 0;
    this.closeCount = 0;
  }

  showModal() {
    assert.equal(this.open, false, "the shared confirmation must not open a second modal");
    this.open = true;
    this.showCount += 1;
  }

  close() {
    this.open = false;
    this.closeCount += 1;
  }
}

function createHarness(initialValue = null, options = {}) {
  const dialog = new FakeDialog();
  const kicker = new FakeControl();
  const title = new FakeControl();
  const body = new FakeControl();
  const cancelButton = new FakeControl();
  const confirmButton = new FakeControl();
  const previousFocus = new FakeControl();
  const writes = [];
  let scheduledClose = null;
  let scheduledCloseDelay = null;
  let value = initialValue;
  const { confirmAction } = createConfirmationDialogController({
    dialog,
    kicker,
    title,
    body,
    cancelButton,
    confirmButton,
    activeElement: () => previousFocus,
    isReducedMotion: () => options.reducedMotion === true,
    scheduleClose: (callback, delay) => {
      scheduledCloseDelay = delay;
      if (options.deferClose) {
        scheduledClose = callback;
        return 1;
      }
      callback();
      return 0;
    },
  });
  const manual = createManualAiUsageNoticeController({
    confirmAction,
    readValue: (key) => key === MANUAL_AI_USAGE_NOTICE_KEY ? value : null,
    writeValue: (key, nextValue) => {
      writes.push([key, nextValue]);
      value = nextValue;
    },
    t: (key) => key,
  });
  return {
    manual, confirmAction, dialog, kicker, title, body, cancelButton, confirmButton,
    previousFocus, writes, value: () => value,
    scheduledCloseDelay: () => scheduledCloseDelay,
    flushClose: () => {
      const callback = scheduledClose;
      scheduledClose = null;
      callback?.();
    },
  };
}

const localSearch = createHarness();
assert.equal(await localSearch.manual.confirmManualAiUsage({ aiEnabled: false }), true);
assert.equal(localSearch.dialog.showCount, 0, "local Ampira search must bypass the shared confirmation when AI is disabled");

const usage = createHarness();
const cancelled = usage.manual.confirmManualAiUsage();
assert.equal(usage.dialog.showCount, 1);
assert.equal(usage.kicker.textContent, "manualAiUsage.kicker");
await Promise.resolve();
assert.equal(usage.cancelButton.focusCount, 1, "the safe action must receive default focus");
usage.cancelButton.dispatchEvent(new Event("click"));
assert.equal(await cancelled, false);
assert.deepEqual(usage.writes, [], "cancelling must not acknowledge the notice");
assert.equal(usage.previousFocus.focusCount, 1, "cancelling must restore the triggering control");

const firstContinued = usage.manual.confirmManualAiUsage();
const concurrentContinued = usage.manual.confirmManualAiUsage();
assert.strictEqual(concurrentContinued, firstContinued, "concurrent manual actions must share one pending notice");
assert.equal(usage.dialog.showCount, 2, "a cancelled notice must appear again on the next manual action");
usage.confirmButton.dispatchEvent(new Event("click"));
assert.equal(await firstContinued, true);
assert.equal(await concurrentContinued, true);
assert.deepEqual(usage.writes, [[MANUAL_AI_USAGE_NOTICE_KEY, MANUAL_AI_USAGE_ACKNOWLEDGED]]);
assert.equal(usage.value(), MANUAL_AI_USAGE_ACKNOWLEDGED);
assert.equal(await usage.manual.confirmManualAiUsage(), true);
assert.equal(usage.dialog.showCount, 2, "all later entry points must bypass the acknowledged notice");

const escaped = createHarness();
const escapeDecision = escaped.manual.confirmManualAiUsage();
const cancelEvent = new Event("cancel", { cancelable: true });
escaped.dialog.dispatchEvent(cancelEvent);
assert.equal(cancelEvent.defaultPrevented, true, "Escape must be handled without closing an underlying overlay");
assert.equal(await escapeDecision, false);
assert.deepEqual(escaped.writes, []);

const backdrop = createHarness();
const backdropDecision = backdrop.manual.confirmManualAiUsage();
backdrop.dialog.dispatchEvent(new Event("click"));
assert.equal(await backdropDecision, false, "clicking the native dialog backdrop must cancel the action");

const animatedClose = createHarness(null, { deferClose: true });
const animatedDecision = animatedClose.confirmAction({ title: "Animated close" });
animatedClose.cancelButton.dispatchEvent(new Event("click"));
assert.equal(animatedClose.dialog.open, true, "the native dialog must stay in the top layer while its close animation runs");
assert.equal(animatedClose.dialog.classList.contains("closing"), true);
assert.equal(animatedClose.dialog.closeCount, 0);
assert.equal(animatedClose.previousFocus.focusCount, 0, "focus must not move behind a still-visible modal");
assert.equal(animatedClose.scheduledCloseDelay(), 180, "the confirmation close must use the shared state duration");
animatedClose.flushClose();
assert.equal(await animatedDecision, false);
assert.equal(animatedClose.dialog.open, false);
assert.equal(animatedClose.dialog.classList.contains("closing"), false);
assert.equal(animatedClose.previousFocus.focusCount, 1);

const reducedMotion = createHarness(null, { reducedMotion: true, deferClose: true });
const reducedDecision = reducedMotion.confirmAction({ title: "Reduced motion" });
reducedMotion.cancelButton.dispatchEvent(new Event("click"));
assert.equal(await reducedDecision, false);
assert.equal(reducedMotion.dialog.open, false, "reduced motion must close the confirmation without a visual delay");
assert.equal(reducedMotion.scheduledCloseDelay(), null);

const standard = createHarness();
const dangerousDecision = standard.confirmAction({
  kicker: "RESET",
  title: "Clear records?",
  body: "This cannot be undone.",
  cancelLabel: "Cancel",
  confirmLabel: "Clear records",
  tone: "danger",
});
assert.equal(standard.title.textContent, "Clear records?");
assert.equal(standard.body.textContent, "This cannot be undone.");
assert.equal(standard.confirmButton.classList.contains("danger"), true);
assert.equal(standard.confirmButton.classList.contains("primary"), false);
standard.confirmButton.dispatchEvent(new Event("click"));
assert.equal(await dangerousDecision, true);

const restored = createHarness(MANUAL_AI_USAGE_ACKNOWLEDGED);
assert.equal(await restored.manual.confirmManualAiUsage(), true);
assert.equal(restored.dialog.showCount, 0, "a persisted acknowledgement must survive a new dashboard session");

console.log("manual AI usage notice tests passed");

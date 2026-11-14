import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import { animatePanelEntrance, enterFirstFrame, MOTION_DURATION } from "../../assets/client/motion.mjs";
import { createShellController } from "../../assets/client/shell-controller.mjs";

export async function runFirstFrameMotionTests() {
  const previous = Object.fromEntries(["document", "matchMedia", "innerHeight", "innerWidth"]
    .map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const document = events();
  const media = events();
  document.hidden = false;
  media.matches = false;
  Object.assign(globalThis, { document, matchMedia: () => media, innerHeight: 800, innerWidth: 1280 });
  try {
    const calls = [], operations = [];
    const panel = (id, top, left = 0, width = 200) => {
      const styles = new Map();
      return {
        styles,
        style: {
          setProperty(name, value) { operations.push("write"); styles.set(name, value); },
          removeProperty(name) { styles.delete(name); },
        },
        getBoundingClientRect() {
          operations.push("read");
          return { top, left, width, height: 120, bottom: top + 120, right: left + width };
        },
        children: [{ animate() { assert.fail("nested content must not repeat the panel entrance"); } }],
        animate(frames, timing) {
          const animation = events();
          animation.cancel = () => { animation.cancelled = true; animation.emit("cancel"); };
          calls.push({ id, frames, timing, animation });
          return animation;
        },
      };
    };
    const first = panel("first", 100, 0);
    const second = panel("second", 100, 260);
    const third = panel("third", 300);
    const fourth = panel("fourth", 450);
    const fifth = panel("fifth", 600);
    const targets = [fifth, third, second, first, fourth, panel("below", 900), panel("hidden", 0, 0, 0)];
    const animations = animatePanelEntrance(targets, { delay: 40 });
    assert.equal(animations.length, 10, "only visible panels receive movement and opacity effects");
    assert.deepEqual(calls.filter(call => call.frames[0].transform).map(call => call.id), ["first", "second", "third", "fourth", "fifth"], "stagger follows visible slot positions after reordering");
    assert.deepEqual(calls.filter(call => call.frames[0].transform).map(call => call.timing.delay), [40, 64, 88, 112, 112], "stagger is bounded for dense viewports");
    assert(operations.slice(operations.indexOf("write")).every(operation => operation !== "read"), "layout reads must finish before compositor writes");
    for (let index = 0; index < calls.length; index += 2) {
      const move = calls[index], fade = calls[index + 1];
      assert.equal(move.timing.duration, MOTION_DURATION.firstFrame);
      assert(fade.timing.duration < move.timing.duration, "content reaches full contrast before its movement ends");
      assert.equal(move.timing.delay, fade.timing.delay, "movement and fade start on the same frame");
      assert.deepEqual(fade.frames, [{ opacity: 0 }, { opacity: 1 }]);
      assert.equal(move.timing.fill, "backwards", "completed effects must release the resting style");
    }
    calls.filter(call => Object.hasOwn(call.frames[0], "opacity")).forEach(call => call.animation.emit("finish"));
    assert.equal(first.styles.get("will-change"), "transform, opacity", "layer promotion lasts through the movement tail");
    calls.filter(call => call.frames[0].transform).forEach(call => call.animation.emit("finish"));
    assert.equal(first.styles.size, 0);
    assert.equal(document.count(), 0, "completed groups release visibility listeners");
    assert.equal(media.count(), 0, "completed groups release preference listeners");

    calls.length = 0;
    animatePanelEntrance([first, second], { stagger: 0, maxStagger: 0, startedAt: performance.now() - 1000, targetDelay: 60 });
    assert(calls.every(call => call.timing.delay === 0), "late data must not wait for an expired shell schedule");
    document.hidden = true;
    document.emit("visibilitychange");
    assert(calls.every(call => call.animation.cancelled), "moving to the background ends every entrance effect");
    assert.equal(first.styles.size, 0);
    assert.equal(document.count(), 0);
    assert.equal(media.count(), 0);
    assert.deepEqual(animatePanelEntrance([first]), [], "background documents do not queue a delayed entrance");

    document.hidden = false;
    calls.length = 0;
    assert.equal(enterFirstFrame(first), true, "shortcut rails use the same entrance lifecycle");
    media.matches = true;
    media.emit("change");
    assert(calls.every(call => call.animation.cancelled), "changing reduced motion midway finishes immediately");
    assert.equal(document.count(), 0);
    assert.equal(media.count(), 0);
    assert.deepEqual(animatePanelEntrance([first]), []);
    assert.equal(enterFirstFrame(null), false);
  } finally {
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
  await testShellLifecycle();
  testBookmarkVisibilitySync();
}

async function testShellLifecycle() {
  const source = await fs.readFile(new URL("../../assets/client/theme-bootstrap.mjs", import.meta.url), "utf8");
  const boot = ({ hidden = false, reduced = false, hint = "off", shortcuts = "off", readSettings, storageUnavailable = false } = {}) => {
    const classes = new Set(), document = events(), media = events();
    const storage = new Map([
      ["ampira.headerCover", '{"enabled":false}'], ["ampira.websiteShortcutsLayout", shortcuts],
      ["ampira.bookmarkSectionEnabled", hint],
    ]);
    let now = 0;
    document.hidden = hidden;
    media.matches = reduced;
    document.documentElement = {
      dataset: {}, style: { setProperty() {} },
      classList: { add: name => classes.add(name), remove: name => classes.delete(name), toggle() {} },
    };
    const context = {
      document, location: { protocol: readSettings ? "chrome-extension:" : "http:" },
      chrome: { storage: { sync: { get: readSettings } } },
      localStorage: {
        getItem(key) {
          if (storageUnavailable && key === "ampira.bookmarkSectionEnabled") throw new Error("unavailable");
          return storage.get(key) ?? null;
        },
        setItem(key, value) {
          if (storageUnavailable) throw new Error("unavailable");
          storage.set(key, value);
        },
      },
      matchMedia: () => media, performance: { now: () => now },
      setTimeout() { assert.fail("shell motion must not expire on a timer started before styles load"); },
    };
    vm.runInNewContext(source, context);
    return { classes, document, context, media, storage, advance: value => { now = value; } };
  };
  const shell = boot();
  shell.advance(900);
  assert(shell.classes.has("has-first-frame-motion"), "a slow stylesheet must not consume the entrance before paint");
  shell.document.emit("animationstart", { animationName: "firstFrameNavIn", elapsedTime: 0 });
  assert.equal(shell.context.ampiraFirstFrameStartedAt, 900, "the shared clock starts at actual shell playback");
  shell.document.emit("animationend", { animationName: "firstFrameFadeIn" });
  assert(shell.classes.has("has-first-frame-motion"), "opacity completing must not cut off the movement tail");
  shell.document.emit("animationend", { animationName: "firstFrameDashboardHeaderIn" });
  assert(!shell.classes.has("has-first-frame-motion"));
  assert(shell.classes.has("has-nav-entrance"), "finishing the title must not truncate a later navigation entrance");
  shell.document.emit("animationend", { animationName: "firstFrameNavIn" });
  assert(!shell.classes.has("has-nav-entrance"));
  assert.equal(shell.document.count(), 0);
  assert.equal(shell.media.count(), 0);
  const hiddenShell = boot();
  hiddenShell.document.hidden = true;
  hiddenShell.document.emit("visibilitychange");
  assert.equal(hiddenShell.document.count(), 0);
  assert(!hiddenShell.classes.has("has-first-frame-motion"));
  assert(!hiddenShell.classes.has("has-nav-entrance"));
  const reducedShell = boot();
  reducedShell.media.matches = true;
  reducedShell.media.emit("change");
  assert.equal(reducedShell.classes.size, 0, "switching to reduced motion must release both shell animations");
  assert.equal(reducedShell.document.count() + reducedShell.media.count(), 0);
  for (const options of [{ hidden: true }, { reduced: true }]) {
    const disabled = boot(options);
    assert(!disabled.classes.has("has-first-frame-motion"));
    assert.equal(disabled.document.count(), 0);
  }

  for (const hint of ["on", "off"]) {
    const cached = boot({ hint, readSettings: () => assert.fail("known layout must not wait for storage") });
    assert.equal(cached.document.documentElement.dataset.bookmarkSection, hint, "cached visibility must apply synchronously before paint");
  }
  for (const [settings, expected] of [
    [{ bookmarkSectionEnabled: false, newsSourceMode: "bookmarks" }, "off"],
    [{ bookmarkSectionEnabled: true, newsSourceMode: "public" }, "on"],
    [{ newsSourceMode: "bookmarks" }, "on"], [{}, "off"],
  ]) {
    let resolveSettings, reads = 0;
    const cold = boot({ hint: null, shortcuts: null, readSettings: () => {
      reads++;
      return new Promise(resolve => { resolveSettings = resolve; });
    } });
    assert.equal(cold.document.documentElement.dataset.bookmarkSection, "pending");
    cold.advance(900);
    cold.document.emit("animationstart", { animationName: "firstFrameDashboardHeaderIn", elapsedTime: 0 });
    cold.document.emit("animationend", { animationName: "firstFrameDashboardHeaderIn" });
    assert(cold.classes.has("has-nav-entrance"), "slow settings must retain the unplayed navigation entrance");
    resolveSettings({ "ampira.settings.v1": settings });
    await Promise.all([cold.context.ampiraLayoutBootstrap.bookmarkSectionReady, cold.context.ampiraLayoutBootstrap.websiteShortcutsReady]);
    assert.equal(reads, 1, "cold layout hints share one settings storage read");
    assert.equal(cold.document.documentElement.dataset.bookmarkSection, expected);
    assert.equal(cold.storage.get("ampira.bookmarkSectionEnabled"), expected);
    cold.advance(1400);
    cold.document.emit("animationstart", { animationName: "firstFrameMobileNavIn", elapsedTime: 0 });
    assert.equal(cold.context.ampiraFirstFrameStartedAt, 900, "delayed navigation must not restart the card entrance clock");
    cold.document.emit("animationend", { animationName: "firstFrameMobileNavIn" });
    assert.equal(cold.document.count() + cold.media.count(), 0);
  }
  const unavailable = boot({ storageUnavailable: true, readSettings: async () => ({ "ampira.settings.v1": { bookmarkSectionEnabled: false } }) });
  await unavailable.context.ampiraLayoutBootstrap.bookmarkSectionReady;
  assert.equal(unavailable.document.documentElement.dataset.bookmarkSection, "off", "denied local hints must not prevent resolving the real setting");
  const failed = boot({ hint: "invalid", readSettings: async () => { throw new Error("unavailable"); } });
  await failed.context.ampiraLayoutBootstrap.bookmarkSectionReady;
  assert.equal(failed.document.documentElement.dataset.bookmarkSection, "pending", "a failed early read must defer to the settings workflow");
  let resolveLate;
  const stale = boot({ hint: null, readSettings: () => new Promise(resolve => { resolveLate = resolve; }) });
  stale.document.documentElement.dataset.bookmarkSection = "on";
  resolveLate({ "ampira.settings.v1": { bookmarkSectionEnabled: false } });
  await stale.context.ampiraLayoutBootstrap.bookmarkSectionReady;
  assert.equal(stale.document.documentElement.dataset.bookmarkSection, "on", "late bootstrap reads must not overwrite settings already applied by the app");
}

function testBookmarkVisibilitySync() {
  const previous = Object.fromEntries(["document", "localStorage"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const storage = new Map(), dataset = {};
  const els = { bookmarkNav: { classList: { contains: () => false } }, librarySection: {} };
  try {
    Object.defineProperty(globalThis, "document", { configurable: true, value: {
      documentElement: { dataset }, querySelector: () => null, querySelectorAll: () => [],
    } });
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { setItem: (key, value) => storage.set(key, value) } });
    const shell = createShellController({ els, state: {} });
    for (const visible of [false, true, false]) {
      shell.syncBookmarkSectionVisibility({ bookmarkSectionEnabled: visible });
      assert.equal(els.bookmarkNav.hidden, !visible);
      assert.equal(els.librarySection.hidden, !visible);
      assert.equal(dataset.bookmarkSection, visible ? "on" : "off");
      assert.equal(storage.get("ampira.bookmarkSectionEnabled"), dataset.bookmarkSection, "saving visibility must prepare the next tab's first frame");
    }
  } finally {
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

function events() {
  const listeners = new Map();
  return {
    addEventListener(type, listener, options) {
      if (!listeners.has(type)) listeners.set(type, new Map());
      listeners.get(type).set(listener, options?.once === true);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    emit(type, detail = {}) {
      for (const [listener, once] of [...(listeners.get(type) || [])]) {
        if (once) listeners.get(type).delete(listener);
        listener({ type, ...detail });
      }
    },
    count: () => [...listeners.values()].reduce((total, entries) => total + entries.size, 0),
  };
}

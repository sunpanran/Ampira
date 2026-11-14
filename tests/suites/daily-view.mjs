import assert from "node:assert/strict";
import { createDailyView } from "../../assets/client/daily-view.mjs";

const bookmarks = Array.from({ length: 24 }, (_, index) => ({ key: `item-${index}`, cardType: "inspiration", url: `https://example.com/${index}` }));
const state = { day: "2026-11-14", data: { bookmarks }, settings: { bookmarkConsentGranted: true }, seen: new Set(), variants: { inspiration: 1 } };
const calls = [];
const view = createDailyView({ state, t: key => key, cardTransition: {}, dashboardLayout: {},
  inspirationPreviews: { preload: async (items, options) => { calls.push({ items, options }); return items; } },
});
await view.preloadDailyInspiration(75);
assert.equal(new Set(calls[0].items.map(item => item.key)).size, 15, "preload covers three five-card inspiration batches");
assert.equal(calls[0].items.length, 20, "current five-card batch is prioritized before the pool");
assert.equal(calls[0].options.timeoutMs, 75);
state.settings.bookmarkConsentGranted = false;
await view.preloadDailyInspiration();
assert.equal(calls.length, 1, "preloading requires local bookmark consent");
state.settings.bookmarkConsentGranted = true;
state.data.bookmarks = bookmarks.map(item => ({ ...item, sourceKind: "preset", categoryKey: "art", coverAsset: "assets/presets/inspiration/art-chroma-01.webp" }));
await view.preloadDailyInspiration();
assert.equal(calls.length, 1, "packaged preset covers never enter the preview service");
console.log("Daily view preload tests passed");

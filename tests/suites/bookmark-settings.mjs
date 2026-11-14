import assert from "node:assert/strict";
import { createBookmarkSettingsController } from "../../assets/client/bookmark-settings-controller.mjs";
import { newsBookmarkValue } from "../../assets/client/news-source-selection.mjs";

const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
const createNode = () => ({
  append() {}, replaceChildren() {}, setAttribute() {}, closest() { return this; },
});
Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: createNode } });
try {
  const state = { settings: { newsSourceMode: "bookmarks", newsBookmarkFolder: "Reading", bookmarkSectionEnabled: true } };
  const els = Object.fromEntries([
    "newsBookmarkFolderSelect", "inspirationBookmarkFolderSelect", "bookmarkSectionEnabledInput",
    "bookmarkOnlyFolderSelect", "addBookmarkOnlyFolder", "bookmarkExtraCount", "bookmarkExtraDetails",
    "bookmarkOnlyFolderList", "publicFeedSupplementEnabledInput",
  ].map(name => [name, createNode()]));
  els.inspirationBookmarkFolderSelect.value = "preset";
  els.bookmarkSectionEnabledInput.checked = true;
  els.bookmarkSectionEnabledInput.disabled = false;
  const controller = createBookmarkSettingsController({ state, els, t: key => key, renderSettingsStatus() {}, setIconLabel() {} });
  const selectNews = value => {
    els.newsBookmarkFolderSelect.value = value;
    controller.setNewsSourceSelection(value);
  };

  selectNews(newsBookmarkValue("Science"));
  assert.equal(els.bookmarkSectionEnabledInput.checked, true, "switching between personal folders must preserve bookmark visibility");
  selectNews("public");
  assert.equal(state.settings.newsSourceMode, "public");
  assert.equal(els.bookmarkSectionEnabledInput.checked, false, "switching to public sources must default the home bookmark switch off");
  assert.equal(els.bookmarkSectionEnabledInput.disabled, false, "public sources must leave the bookmark switch editable");

  els.bookmarkSectionEnabledInput.checked = true;
  controller.syncPublicFeedSupplementControl(true);
  controller.syncPublicFeedSupplementControl(false);
  selectNews("public");
  assert.equal(els.bookmarkSectionEnabledInput.checked, true, "an explicit public-source opt-in must survive control resynchronization");

  els.bookmarkSectionEnabledInput.checked = false;
  selectNews(newsBookmarkValue("Reading"));
  assert.equal(els.bookmarkSectionEnabledInput.checked, false, "selecting a personal folder must preserve a manual opt-out");
  els.bookmarkSectionEnabledInput.checked = true;
  selectNews("public");
  assert.equal(els.bookmarkSectionEnabledInput.checked, false, "each actual transition to public sources must offer the same default");
} finally {
  if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
  else delete globalThis.document;
}

console.log("Bookmark source visibility settings tests passed.");

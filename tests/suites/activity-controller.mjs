import assert from "node:assert/strict";
import { createActivityController } from "../../assets/client/activity-controller.mjs";

export async function runActivityControllerTests() {
  await testReadAllCompletesBeforePreferenceSaveAndRejectsReentry();
}

async function testReadAllCompletesBeforePreferenceSaveAndRejectsReentry() {
  const previousWindow = globalThis.window;
  let releaseSettingsSave;
  const settingsSave = new Promise((resolve) => { releaseSettingsSave = resolve; });
  const opened = [];
  const feedback = [];
  let confirmCount = 0;
  const state = {
    settings: { readingQueueReadAllPrompted: false, readingQueueOpenOnReadAll: true },
    readingQueue: new Set(["news-1"]),
    readingQueueMeta: new Map(),
    seen: new Set(),
    seenMeta: new Map(),
    opened: new Set(),
    openedMeta: new Map(),
    dismissed: new Set(),
    dismissedMeta: new Map(),
    day: "2026-07-15",
  };
  globalThis.window = {
    confirm() {
      confirmCount += 1;
      return true;
    },
  };
  try {
    const controller = createActivityController({
      state,
      itemUrl: (item) => item.url,
      openExternalWindow: (url) => opened.push(url),
      openExternal() {},
      renderAll() {},
      renderEfficiencyPanel() {},
      newsSummaryItems: () => [],
      hostFromUrl: () => "",
      t: (key) => key,
      newsSectionName: () => "",
      newsCardType: "news",
      findNewsItemReference() {},
      isNewsCard: () => true,
      displaySummaryTitle: (item) => item.title,
      displayTitle: (item) => item.title,
      displayBookmarkTitle: (item) => item.title,
      summaryText: () => "",
      createThemedIcon() {},
      srOnly() {},
      writeJson() {},
      readJson: (_key, fallback) => fallback,
      apiPost: (url) => {
        if (url === "/api/settings") return settingsSave.then(() => state.settings);
        feedback.push(url);
        return Promise.resolve({});
      },
    });
    const items = [{
      key: "news-1",
      url: "https://example.com/story",
      title: "Story",
      sourceKey: "source-1",
      feedItem: { articleId: "article-1" },
    }];

    const first = controller.openAndMarkReadingQueue(items);
    assert.deepEqual(opened, ["https://example.com/story"], "read-all must open URLs before waiting for preference persistence");
    assert.deepEqual([...state.readingQueue], [], "read-all must commit the queue mutation in the user gesture");
    assert.deepEqual(feedback, ["/api/feedback"]);

    const second = controller.openAndMarkReadingQueue(items);
    assert.deepEqual(opened, ["https://example.com/story"], "a pending read-all action must reject reentry");
    assert.deepEqual(feedback, ["/api/feedback"], "reentry must not submit duplicate feedback");
    assert.equal(confirmCount, 1);

    releaseSettingsSave();
    await Promise.all([first, second]);
    assert.deepEqual(opened, ["https://example.com/story"]);
    assert.deepEqual(feedback, ["/api/feedback"]);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
}

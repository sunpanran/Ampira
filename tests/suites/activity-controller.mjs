import assert from "node:assert/strict";
import { createActivityController } from "../../assets/client/activity-controller.mjs";

export async function runActivityControllerTests() {
  await testReadAllCompletesBeforePreferenceSaveAndRejectsReentry();
  await testReadAllCanMarkWithoutOpeningWebsites();
}

async function testReadAllCompletesBeforePreferenceSaveAndRejectsReentry() {
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
  const confirmAction = async () => {
    confirmCount += 1;
    return true;
  };
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
    confirmAction,
  });
  const items = [{
    key: "news-1",
    url: "https://example.com/story",
    title: "Story",
    sourceKey: "source-1",
    feedItem: { articleId: "article-1" },
  }];

  const first = controller.openAndMarkReadingQueue(items);
  await Promise.resolve();
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
}

async function testReadAllCanMarkWithoutOpeningWebsites() {
  const opened = [];
  const saved = [];
  const state = {
    settings: { readingQueueReadAllPrompted: false, readingQueueOpenOnReadAll: true },
    readingQueue: new Set(["bookmark-1"]),
    readingQueueMeta: new Map(),
    seen: new Set(),
    seenMeta: new Map(),
    opened: new Set(),
    openedMeta: new Map(),
    dismissed: new Set(),
    dismissedMeta: new Map(),
    day: "2026-07-15",
  };
  const controller = createActivityController({
    state,
    itemUrl: (item) => item.url,
    openExternalWindow: (url) => opened.push(url),
    openExternal() {},
    renderAll() {},
    renderEfficiencyPanel() {},
    newsSummaryItems: () => [],
    hostFromUrl: () => "",
    t: (key, params) => `${key}:${params?.count || ""}`,
    newsSectionName: () => "",
    newsCardType: "news",
    findNewsItemReference() {},
    isNewsCard: () => false,
    displaySummaryTitle: (item) => item.title,
    displayTitle: (item) => item.title,
    displayBookmarkTitle: (item) => item.title,
    summaryText: () => "",
    createThemedIcon() {},
    srOnly() {},
    writeJson() {},
    readJson: (_key, fallback) => fallback,
    apiPost: async (url, payload) => {
      if (url === "/api/settings") saved.push(payload);
      return state.settings;
    },
    confirmAction: async (content) => {
      assert.equal(content.kicker, "confirmation.readAll.kicker:");
      assert.equal(content.body, "confirmation.readAll.body:1");
      return false;
    },
  });

  await controller.openAndMarkReadingQueue([{
    key: "bookmark-1",
    url: "https://example.com/bookmark",
    title: "Bookmark",
  }]);

  assert.deepEqual(opened, [], "the secondary choice must mark items without opening websites");
  assert.deepEqual([...state.readingQueue], []);
  assert.deepEqual(saved, [{
    readingQueueOpenOnReadAll: false,
    readingQueueReadAllPrompted: true,
  }], "the first-use choice must persist for later read-all actions");
}

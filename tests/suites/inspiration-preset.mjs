import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import {
  INSPIRATION_PRESET_CATEGORIES,
  INSPIRATION_PRESET_SITES,
  applyInspirationSource,
  buildInspirationPreset,
} from "../../extension/core/inspiration-preset.mjs";
import { buildBookmarkModel, inspirationPreviewSourceUrls } from "../../extension/core/bookmarks.mjs";
import { normalizeSettings } from "../../extension/core/settings.mjs";
import { seededShuffle } from "../../assets/client/dashboard-model.mjs";
import { orderPresetInspiration } from "../../assets/client/inspiration-preset-selection.mjs";
import {
  INSPIRATION_COVER_ASSETS,
  inspirationFallbackCoverAsset,
  resolveInspirationCoverUrl,
} from "../../assets/client/inspiration-cover.mjs";
import { localizedCategory } from "../../assets/client/localized-labels.mjs";
import { recoverInspirationImage } from "../../assets/client/inspiration-image-recovery.mjs";
import { createInspirationPreviewController } from "../../assets/client/inspiration-preview-controller.mjs";
import { belongsInArchiveIndex } from "../../assets/client/bookmarks-view.mjs";
import en from "../../assets/client/locales/en.mjs";
import zhCN from "../../assets/client/locales/zh-CN.mjs";
import zhHant from "../../assets/client/locales/zh-Hant.mjs";
import {
  inspirationBookmarkValue,
  inspirationSelectionValue,
  parseInspirationSelection,
} from "../../assets/client/inspiration-source-selection.mjs";

export async function runInspirationPresetTests() {
  assert.deepEqual(
    [en, zhCN, zhHant].map((messages) => [
      messages["settings.bookmarks.presetTitle"],
      messages["settings.bookmarks.publicFeedTitle"],
    ]),
    [
      ["Inspiration preset (Ampira)", "Public Feed (Ampira)"],
      ["灵感预设（Ampira）", "公共 Feed（Ampira）"],
      ["靈感預設（Ampira）", "公共 Feed（Ampira）"],
    ],
    "built-in bookmark source options must visibly identify Ampira in every locale",
  );
  const sourceNameRules = [
    {
      locale: "en",
      messages: en,
      presetName: "Inspiration preset (Ampira)",
      publicFeedName: "Public Feed (Ampira)",
    },
    {
      locale: "zh-CN",
      messages: zhCN,
      presetName: "灵感预设（Ampira）",
      publicFeedName: "公共 Feed（Ampira）",
    },
    {
      locale: "zh-Hant",
      messages: zhHant,
      presetName: "靈感預設（Ampira）",
      publicFeedName: "公共 Feed（Ampira）",
    },
  ];
  const presetReferenceKeys = [
    "settings.bookmarks.presetTitle",
    "inspirationPreset.section",
  ];
  const publicFeedReferenceKeys = [
    "settings.bookmarks.publicFeedTitle",
    "settings.cache.publicFeed",
  ];
  for (const rule of sourceNameRules) {
    for (const key of presetReferenceKeys) {
      assert(
        rule.messages[key].includes(rule.presetName),
        `${rule.locale} ${key} must use the canonical built-in inspiration source name`,
      );
    }
    for (const key of publicFeedReferenceKeys) {
      assert(
        rule.messages[key].includes(rule.publicFeedName),
        `${rule.locale} ${key} must use the canonical built-in public Feed source name`,
      );
    }
  }
  assert.equal(INSPIRATION_PRESET_SITES.length, 48, "the v1 preset must contain exactly 48 websites");
  assert.equal(new Set(INSPIRATION_PRESET_SITES.map((item) => item.id)).size, 48, "preset IDs must be unique");
  assert.equal(new Set(INSPIRATION_PRESET_SITES.map((item) => item.url)).size, 48, "preset URLs must be unique");
  assert.equal(INSPIRATION_PRESET_SITES.filter((item) => item.editorial).length, 14, "the preset must keep the reviewed 14/34 editorial-to-independent mix");

  const expectedQuotas = Object.fromEntries(INSPIRATION_PRESET_CATEGORIES.map(({ key, quota }) => [key, quota]));
  const actualQuotas = {};
  const covers = new Map();
  for (const item of INSPIRATION_PRESET_SITES) {
    const url = new URL(item.url);
    assert.equal(url.protocol, "https:", `${item.id} must use HTTPS`);
    assert.equal(url.username, "", `${item.id} must not include credentials`);
    assert.equal(url.password, "", `${item.id} must not include credentials`);
    assert.equal(url.search, "", `${item.id} must not include a query`);
    assert.equal(url.hash, "", `${item.id} must not include a fragment`);
    assert(!["localhost", "127.0.0.1", "::1"].includes(url.hostname), `${item.id} must be public`);
    actualQuotas[item.categoryKey] = (actualQuotas[item.categoryKey] || 0) + 1;
    if (!covers.has(item.coverKey)) covers.set(item.coverKey, []);
    covers.get(item.coverKey).push(item);
  }
  assert.deepEqual(actualQuotas, expectedQuotas, "preset category quotas must match the approved plan");
  assert.equal(covers.size, 24, "the preset must use exactly 24 cover keys");
  for (const [coverKey, items] of covers) {
    assert.equal(items.length, 2, `${coverKey} must be referenced exactly twice`);
    assert.equal(new Set(items.map((item) => item.categoryKey)).size, 1, `${coverKey} must not cross categories`);
  }

  const coverDirectory = new URL("../../assets/presets/inspiration/", import.meta.url);
  const coverFiles = readdirSync(coverDirectory).filter((name) => name.endsWith(".webp")).sort();
  assert.equal(coverFiles.length, 24, "the packaged preset must contain exactly 24 WebP covers");
  assert.deepEqual(
    coverFiles.map((name) => basename(name, ".webp")),
    [...covers.keys()].sort(),
    "packaged cover filenames must match the 24 preset cover keys",
  );
  let totalCoverBytes = 0;
  for (const name of coverFiles) {
    const url = new URL(name, coverDirectory);
    const size = statSync(url).size;
    totalCoverBytes += size;
    assert(size <= 200 * 1024, `${name} must not exceed 200 KiB`);
    assert.deepEqual(readWebpDimensions(readFileSync(url)), { width: 960, height: 600 }, `${name} must be 960×600`);
  }
  assert(totalCoverBytes <= 3.5 * 1024 * 1024, "all preset covers together must not exceed 3.5 MiB");
  assert.deepEqual(
    INSPIRATION_COVER_ASSETS.map((asset) => basename(asset, ".webp")).sort(),
    [...covers.keys()].sort(),
    "client fallback covers must stay aligned with every packaged preset cover",
  );
  assert.equal(
    resolveInspirationCoverUrl("assets/presets/inspiration/web-signal-01.webp", "chrome-extension://ampira/dashboard.html"),
    "chrome-extension://ampira/assets/presets/inspiration/web-signal-01.webp",
    "preset covers must resolve inside the extension rather than against a web origin",
  );
  assert.equal(
    resolveInspirationCoverUrl("../private.webp", "chrome-extension://ampira/dashboard.html"),
    "",
    "preset cover resolution must reject paths outside the packaged cover directory",
  );
  const fallbackCover = inspirationFallbackCoverAsset({
    key: "bookmark-synthetic",
    categoryKey: "bookmark:e5a3767d",
    category: "Motion references",
    url: "https://example.com/",
  });
  assert(INSPIRATION_COVER_ASSETS.includes(fallbackCover), "personal inspiration fallbacks must use a packaged local cover");
  assert.equal(
    fallbackCover,
    inspirationFallbackCoverAsset({
      key: "bookmark-synthetic",
      categoryKey: "bookmark:e5a3767d",
      category: "Motion references",
      url: "https://example.com/",
    }),
    "personal inspiration fallback selection must be deterministic",
  );

  const preset = buildInspirationPreset("en");
  assert.equal(preset.bookmarks.length, 48);
  assert.equal(belongsInArchiveIndex(preset.section), false, "the built-in inspiration preset section must stay out of Archive Index");
  assert(preset.bookmarks.every((item) => !belongsInArchiveIndex(item)), "built-in inspiration preset links must stay out of Archive Index");
  assert.equal(belongsInArchiveIndex({
    sectionKey: "bookmark-inspiration",
    sourceKind: "bookmark",
    cardType: "inspiration",
  }), true, "personal inspiration bookmarks must remain available in Archive Index");
  assert(preset.bookmarks.every((item) => (
    item.sourceKind === "preset"
    && item.sectionKey === "inspirationPreset"
    && item.categoryKey
    && item.coverAsset.endsWith(".webp")
  )), "preset dashboard entries must expose stable source, section, category, and cover fields");
  assert.deepEqual(inspirationPreviewSourceUrls(preset.bookmarks), [], "local preset covers must never enter remote preview permissions");
  assert.deepEqual(
    ["en", "zh-CN", "zh-Hant"].map((locale) => buildInspirationPreset(locale).section.categories.map((item) => item.name)),
    [
      ["Web & interaction", "Brand & identity", "Typography & editorial", "Motion & 3D", "Architecture & space", "Art & illustration", "Photography & film", "Objects & materials"],
      ["网页与交互", "品牌与识别", "字体与编辑", "动效与 3D", "建筑与空间", "艺术与插画", "摄影与影像", "器物与材料"],
      ["網頁與互動", "品牌與識別", "字體與編輯", "動效與 3D", "建築與空間", "藝術與插畫", "攝影與影像", "器物與材料"],
    ],
    "all eight preset categories must have reviewed English, Simplified Chinese, and Traditional Chinese labels",
  );
  assert.equal(
    localizedCategory({ sourceKind: "bookmark", categoryKey: "bookmark:e5a3767d", category: "Motion references" }),
    "Motion references",
    "personal bookmark category IDs must never leak into visible labels",
  );
  assert.equal(
    localizedCategory({ categoryKey: "unknown-category", category: "Editorial references" }),
    "Editorial references",
    "unknown category translation keys must fall back to the supplied visible label",
  );
  let currentImage = "failed";
  let renderedNext = "";
  let renderedFallback = false;
  const replacedResult = await recoverInspirationImage({
    failedUrl: "https://images.example/first.webp",
    isCurrent: () => currentImage === "failed",
    reject: async () => {
      currentImage = "replacement";
      return { imageUrl: "https://images.example/second.webp" };
    },
    renderNext: (url) => { renderedNext = url; },
    renderFallback: () => { renderedFallback = true; },
  });
  assert.equal(replacedResult, "replaced", "a controller-rendered replacement must make the old image error stale");
  assert.equal(renderedNext, "", "stale image errors must not render over the controller replacement");
  assert.equal(renderedFallback, false, "stale image errors must not restore the fallback over a replacement");

  currentImage = "failed";
  const nextResult = await recoverInspirationImage({
    failedUrl: "https://images.example/first.webp",
    isCurrent: () => currentImage === "failed",
    reject: async () => ({ imageUrl: "https://images.example/second.webp" }),
    renderNext: (url) => { renderedNext = url; },
    renderFallback: () => { renderedFallback = true; },
  });
  assert.equal(nextResult, "next", "a surviving failed node must advance to the next image candidate");
  assert.equal(renderedNext, "https://images.example/second.webp");
  assert.equal(renderedFallback, false);

  const previewItem = { key: "transient-preview", url: "https://example.com/", title: "Transient preview" };
  const renderedPreviewImages = [];
  let transientRequestCount = 0;
  const transientController = createInspirationPreviewController(previewControllerOptions({
    retryDelaysMs: [0],
    apiGet: async () => {
      transientRequestCount += 1;
      if (transientRequestCount === 1) throw new Error("temporary message failure");
      return {
        imageUrl: "https://images.example/recovered.webp",
        imageUrls: ["https://images.example/recovered.webp"],
        source: "origin",
      };
    },
    onImage: (_item, imageUrl) => renderedPreviewImages.push(imageUrl),
  }));
  assert.equal(await transientController.request(previewItem), null, "a transient message failure must not become a definitive preview");
  assert.equal(transientController.get(previewItem), null, "a transient message failure must not poison the preview cache");
  await waitFor(() => transientRequestCount === 2 && transientController.get(previewItem)?.imageUrl, "transient preview retry");
  assert.equal(transientController.get(previewItem).imageUrl, "https://images.example/recovered.webp");
  assert.deepEqual(renderedPreviewImages, ["https://images.example/recovered.webp"], "an automatic retry must render the recovered original image once");

  let originErrorRequestCount = 0;
  const originErrorController = createInspirationPreviewController(previewControllerOptions({
    retryDelaysMs: [0],
    apiGet: async () => {
      originErrorRequestCount += 1;
      return originErrorRequestCount === 1
        ? { imageUrl: "", imageUrls: [], originalStatus: "error" }
        : { imageUrl: "https://images.example/origin-recovered.webp", source: "origin" };
    },
  }));
  const originErrorPreview = await originErrorController.request(previewItem);
  assert.equal(originErrorPreview.originalStatus, "error");
  assert.equal(originErrorController.get(previewItem), null, "a failed origin fetch must remain retryable instead of entering the negative cache");
  await waitFor(() => originErrorRequestCount === 2 && originErrorController.get(previewItem)?.imageUrl, "origin metadata retry");
  assert.equal(originErrorController.get(previewItem).imageUrl, "https://images.example/origin-recovered.webp");

  let definitiveRequestCount = 0;
  let definitiveFailure = true;
  const definitiveController = createInspirationPreviewController(previewControllerOptions({
    retryDelaysMs: [0],
    apiGet: async () => {
      definitiveRequestCount += 1;
      if (!definitiveFailure) {
        return { imageUrl: "https://images.example/after-source-switch.webp", source: "origin" };
      }
      const error = new Error("permission denied");
      error.retryable = false;
      throw error;
    },
  }));
  await definitiveController.request(previewItem);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(definitiveRequestCount, 1, "explicitly non-retryable failures must not loop");
  assert.equal(definitiveController.get(previewItem)?.imageUrl, "", "definitive failures may keep the normal negative cache");
  definitiveFailure = false;
  definitiveController.invalidate();
  await definitiveController.request(previewItem);
  assert.equal(definitiveRequestCount, 2, "a source switch must make a previously negative preview requestable again");
  assert.equal(definitiveController.get(previewItem)?.imageUrl, "https://images.example/after-source-switch.webp");

  let boundedRequestCount = 0;
  const boundedController = createInspirationPreviewController(previewControllerOptions({
    retryDelaysMs: [0, 0],
    apiGet: async () => {
      boundedRequestCount += 1;
      throw new Error("still unavailable");
    },
  }));
  await boundedController.request(previewItem);
  await waitFor(() => boundedRequestCount === 3, "bounded preview retries");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(boundedRequestCount, 3, "transient failures must stop after the configured retry budget");
  assert.equal(boundedController.get(previewItem), null, "an exhausted transient retry budget must remain eligible for a later user request");

  const originalModel = {
    folderOptions: [{ name: "News" }, { name: "Inspiration" }],
    sections: [
      { name: "News", cardType: "news" },
      { name: "Inspiration", cardType: "inspiration", missing: true },
    ],
    bookmarks: [
      { key: "news", cardType: "news" },
      { key: "personal", cardType: "inspiration" },
    ],
    availableNewsFolders: [],
    missingFolders: ["Inspiration"],
  };
  const composed = applyInspirationSource(originalModel, { inspirationSourceMode: "preset" }, "en");
  assert.equal(composed.bookmarks.filter((item) => item.cardType === "inspiration").length, 48);
  assert(!composed.bookmarks.some((item) => item.key === "personal"), "preset mode must replace only the active inspiration source");
  assert(composed.bookmarks.some((item) => item.key === "news"), "preset mode must retain news and additional bookmarks");
  assert.deepEqual(composed.missingFolders, [], "a dormant personal inspiration folder must not block preset mode");
  assert.equal(applyInspirationSource(originalModel, { inspirationSourceMode: "bookmarks" }, "en"), originalModel, "bookmark mode must retain the personal model unchanged");

  assert.equal(normalizeSettings({}).inspirationSourceMode, "preset", "new installations must default to the preset");
  assert.equal(normalizeSettings({ schemaVersion: 1 }).inspirationSourceMode, "bookmarks", "legacy settings without the field must retain personal bookmarks");
  assert.equal(normalizeSettings({ schemaVersion: 1, inspirationSourceMode: "preset" }).inspirationSourceMode, "preset");
  const presetWithExtraFolder = normalizeSettings({
    schemaVersion: 1,
    newsSourceMode: "public",
    inspirationSourceMode: "preset",
    inspirationBookmarkFolder: "Work",
    bookmarkOnlyFolders: ["Work"],
  });
  const extraFolderModel = applyInspirationSource(buildBookmarkModel([{
    children: [{
      children: [{
        id: "work",
        title: "Work",
        children: [{ id: "link", title: "Example", url: "https://example.com/" }],
      }],
    }],
  }], presetWithExtraFolder), presetWithExtraFolder, "en");
  assert(extraFolderModel.bookmarks.some((item) => item.section === "Work" && item.cardType === "bookmark"), "preset mode must retain the dormant personal inspiration folder when it is selected as an extra bookmark section");

  assert.equal(inspirationSelectionValue("preset", "Inspiration"), "preset", "preset mode must use the fixed first-option value");
  assert.equal(inspirationBookmarkValue("preset"), "bookmark:preset", "a personal folder named preset must not collide with the preset value");
  const encodedFolder = inspirationBookmarkValue("灵感 / Type & Motion");
  assert.equal(encodedFolder, "bookmark:%E7%81%B5%E6%84%9F%20%2F%20Type%20%26%20Motion");
  assert.deepEqual(
    parseInspirationSelection(encodedFolder, "Previous folder"),
    { mode: "bookmarks", folder: "灵感 / Type & Motion" },
    "personal folder values must round-trip through the collision-safe encoding",
  );
  assert.deepEqual(
    parseInspirationSelection("preset", "Previous folder"),
    { mode: "preset", folder: "Previous folder" },
    "switching to the preset must preserve the previous personal folder",
  );
  assert.deepEqual(
    parseInspirationSelection("bookmark:%E0%A4%A", "Previous folder"),
    { mode: "preset", folder: "Previous folder" },
    "malformed folder values must fail closed to the preset without erasing the saved folder",
  );

  const ordered = orderPresetInspiration(preset.bookmarks, { seed: "2026-07-14", shuffle: seededShuffle });
  assert.equal(new Set(ordered.slice(0, 15).map((item) => item.key)).size, 15, "the first three batches must contain 15 websites");
  assert.equal(new Set(ordered.slice(0, 15).map((item) => item.coverAsset)).size, 15, "the first three batches must contain 15 covers");
  for (let index = 0; index < ordered.length; index += 5) {
    const page = ordered.slice(index, index + 5);
    assert.equal(new Set(page.map((item) => item.coverAsset)).size, page.length, `batch ${index / 5 + 1} must not repeat a cover`);
    if (index < 15) assert.equal(new Set(page.map((item) => item.categoryKey)).size, 5, `batch ${index / 5 + 1} should prioritize five categories`);
  }
}

function previewControllerOptions(overrides = {}) {
  return {
    normalizeUrl: (value) => String(value || "").trim(),
    isHttpUrl: (value) => /^https?:\/\//i.test(String(value || "")),
    isEnabled: () => true,
    isCurrent: () => true,
    canFallback: () => false,
    preloadImage: async () => true,
    onImage: () => {},
    ...overrides,
  };
}

async function waitFor(predicate, label, timeoutMs = 500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`${label} did not complete within ${timeoutMs}ms`);
}

function readWebpDimensions(buffer) {
  assert.equal(buffer.toString("ascii", 0, 4), "RIFF", "cover must be a RIFF file");
  assert.equal(buffer.toString("ascii", 8, 12), "WEBP", "cover must be WebP");
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const type = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const data = offset + 8;
    if (type === "VP8 ") {
      assert.equal(buffer.toString("hex", data + 3, data + 6), "9d012a", "VP8 frame header must be valid");
      return {
        width: buffer.readUInt16LE(data + 6) & 0x3fff,
        height: buffer.readUInt16LE(data + 8) & 0x3fff,
      };
    }
    if (type === "VP8X") {
      return {
        width: buffer.readUIntLE(data + 4, 3) + 1,
        height: buffer.readUIntLE(data + 7, 3) + 1,
      };
    }
    if (type === "VP8L") {
      assert.equal(buffer[data], 0x2f, "VP8L frame header must be valid");
      return {
        width: 1 + buffer[data + 1] + ((buffer[data + 2] & 0x3f) << 8),
        height: 1 + ((buffer[data + 2] & 0xc0) >> 6) + (buffer[data + 3] << 2) + ((buffer[data + 4] & 0x0f) << 10),
      };
    }
    offset = data + size + (size % 2);
  }
  assert.fail("cover has no supported WebP image chunk");
}

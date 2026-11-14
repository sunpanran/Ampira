import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_SETTINGS } from "../../extension/core/constants.mjs";
import { normalizeSettings } from "../../extension/core/settings.mjs";
import { textLength, truncateText } from "../../assets/client/text.mjs";
import { cleanGeneratedSummaryLine, extractGeneratedSummaryTitle, hasStructuralSummaryPrefix, limitGeneratedSummaryLines, normalizeSummaryMarkup, parseGeneratedDailyDigest } from "../../extension/core/summary-text.mjs";
import { cleanAiAnswerMarkup, parseAiAnswer } from "../../assets/client/ai-answer-format.mjs";
import {
  exactPermissionOrigins, newlyRequiredUngrantedOrigins, permissionRowCounts, requiredUngrantedOrigins,
} from "../../assets/client/permission-ui-model.mjs";
import {
  DEFAULT_LOCALE, SUPPORTED_LOCALES, defaultBookmarkFoldersForLocale,
  detectSupportedLocale, formatListForLocale, localeMessages, normalizeLocale,
  translate, translateCount,
} from "../helpers/full-i18n.mjs";
import {
  runtimeLocaleMessages,
  translate as translateRuntime,
} from "../../extension/core/runtime-i18n.mjs";
import allTranslationMessages from "../../assets/client/locales/all-translations.mjs";
import popupMessages from "../../assets/client/locales/popup.mjs";
import { ALL_TRANSLATION_KEYS, POPUP_LOCALE_KEYS } from "../../scripts/client-locale-policy.mjs";
import { isRuntimeLocaleKey } from "../../scripts/runtime-locale-policy.mjs";

export async function runManifestSecurityTests(root) {
const manifest = JSON.parse(await fs.readFile(path.join(root, "manifest.json"), "utf8"));
const dashboardHtml = await fs.readFile(path.join(root, "dashboard.html"), "utf8");
const logoSource = await fs.readFile(path.join(root, "assets", "icons", "ampira-logo.svg"), "utf8");
const toolbarIcon16Png = await fs.readFile(path.join(root, "extension", "icons", "icon-16.png"));
const toolbarIcon24Png = await fs.readFile(path.join(root, "extension", "icons", "icon-24.png"));
const toolbarIcon32Png = await fs.readFile(path.join(root, "extension", "icons", "icon-32.png"));
const storeIconPng = await fs.readFile(path.join(root, "extension", "icons", "icon-128.png"));
const managerIconPng = await fs.readFile(path.join(root, "extension", "icons", "icon-48.png"));
const shellControllerSource = await fs.readFile(path.join(root, "assets", "client", "shell-controller.mjs"), "utf8");
const settingsWorkflowSource = await fs.readFile(path.join(root, "extension", "runtime", "settings-workflow.mjs"), "utf8");
const aiSearchRuntimeSource = await fs.readFile(path.join(root, "extension", "runtime", "ai-search-service.mjs"), "utf8");
const refreshRuntimeSource = await fs.readFile(path.join(root, "extension", "runtime", "refresh-service.mjs"), "utf8");
const extensionRuntimeSource = await fs.readFile(path.join(root, "extension", "runtime", "extension-runtime.mjs"), "utf8");
const dashboardContentRuntimeSource = await fs.readFile(path.join(root, "extension", "runtime", "dashboard-content-service.mjs"), "utf8");

assert.equal(manifest.manifest_version, 3);
assert(dashboardHtml.includes('<span class="about-version" id="aboutVersion"></span>'), "the About panel must reserve a version output without hard-coding a release");
assert(/<img class="about-logo" src="\/assets\/icons\/ampira-logo\.svg(?:\?[^\"]*)?"/.test(dashboardHtml), "the About panel must render the canonical vector logo");
assert(!dashboardHtml.slice(dashboardHtml.indexOf('<div class="about-brand">'), dashboardHtml.indexOf('<div class="about-links">')).includes("logo-purple.svg"), "the About panel must not retain the legacy purple-only logo");
await assert.rejects(fs.access(path.join(root, "assets", "logo-purple.svg")), /ENOENT/, "the legacy purple-only logo must be removed");
await assert.rejects(fs.access(path.join(root, "store", "assets", "ampira-store-icon.svg")), /ENOENT/, "the blurred store-only vector must be removed");
await assert.rejects(fs.access(path.join(root, "store", "assets", "ampira-logo.svg")), /ENOENT/, "the store directory must not retain a duplicate editable logo source");
const versionDashboardAppSource = await fs.readFile(path.join(root, "assets", "client", "dashboard-app.mjs"), "utf8");
assert(versionDashboardAppSource.includes("globalThis.chrome?.runtime?.getManifest?.()")
  && versionDashboardAppSource.includes('document.querySelector("#aboutVersion")')
  && versionDashboardAppSource.includes("aboutVersion.textContent = `v${runtimeAppVersion}`")
  && versionDashboardAppSource.includes('new URL("../../manifest.json", import.meta.url)')
  && versionDashboardAppSource.includes("els.aboutVersion.textContent = `v${appVersion}`"), "the About panel version must come from the runtime manifest with a local-preview manifest fallback");
assert(!dashboardHtml.includes(manifest.version), "dashboard HTML must not hard-code the manifest version");
assert.equal(manifest.chrome_url_overrides.newtab, "dashboard.html");
assert(logoSource.includes('viewBox="0 0 128 128"')
  && logoSource.includes('fill="#06B6D4"')
  && logoSource.includes('fill="#F4FBFD"')
  && !/(?:linear|radial)Gradient|filter=/.test(logoSource), "the canonical logo must use the reviewed flat, crisp geometry and Ampira palette");
assert.deepEqual([storeIconPng.readUInt32BE(16), storeIconPng.readUInt32BE(20)], [128, 128], "the Chrome Web Store icon must remain 128x128");
assert.deepEqual([managerIconPng.readUInt32BE(16), managerIconPng.readUInt32BE(20)], [48, 48], "the extension-management icon must remain 48x48");
assert.deepEqual([toolbarIcon16Png.readUInt32BE(16), toolbarIcon16Png.readUInt32BE(20)], [16, 16], "the compact toolbar icon must remain 16x16");
assert.deepEqual([toolbarIcon24Png.readUInt32BE(16), toolbarIcon24Png.readUInt32BE(20)], [24, 24], "the toolbar icon at 150% display scaling must be 24x24");
assert.equal(manifest.action.default_icon["24"], "extension/icons/icon-24.png", "the toolbar must select its native 150% raster");
assert.deepEqual([toolbarIcon32Png.readUInt32BE(16), toolbarIcon32Png.readUInt32BE(20)], [32, 32], "the high-density toolbar icon must remain 32x32");
assert.equal(manifest.action.default_popup, "action-popup.html", "the toolbar action must open a visible capture confirmation popup");
assert.deepEqual(manifest.permissions.sort(), ["activeTab", "alarms", "bookmarks", "storage"]);
assert.deepEqual([...(manifest.optional_permissions || [])].sort(), ["favicon", "history", "search"], "website icons, local history lookup and browser search must remain optional permissions");
for (const forbidden of ["tabs", "history", "scripting", "webRequest", "management", "unlimitedStorage"]) {
  assert(!manifest.permissions.includes(forbidden), `manifest must not request ${forbidden}`);
}
assert.deepEqual([...manifest.optional_host_permissions].sort(), ["http://127.0.0.1/*", "http://localhost/*", "https://*/*"], "optional origins must stay on the reviewed allowlist");
assert(!manifest.host_permissions, "host permissions must remain optional");
const extensionCsp = manifest.content_security_policy?.extension_pages || "";
assert(extensionCsp.includes("script-src 'self'"), "extension CSP must only execute packaged scripts");
assert(extensionCsp.includes("object-src 'none'"), "extension CSP must disable plugin objects");
assert(extensionCsp.includes("base-uri 'none'"), "extension CSP must disable remote base URLs");
assert(!/unsafe-(?:eval|inline)/.test(extensionCsp), "extension CSP must not allow unsafe script execution");
const cspDirectives = new Map(extensionCsp.split(";").map((directive) => directive.trim().split(/\s+/)).filter((parts) => parts[0]).map(([name, ...values]) => [name, values]));
assert.deepEqual(cspDirectives.get("script-src"), ["'self'"], "extension scripts must only come from the package");
assert(cspDirectives.get("img-src")?.includes("'self'"), "the native favicon endpoint must remain available as a same-extension image");

const actionPopupHtml = await fs.readFile(path.join(root, "action-popup.html"), "utf8");
const actionPopupSource = await fs.readFile(path.join(root, "assets/client/action-popup.mjs"), "utf8");
assert(actionPopupHtml.includes('src="assets/icons/ampira-logo.svg"') && !actionPopupHtml.includes("logo-purple.svg"), "the toolbar popup must reuse the canonical vector logo");
assert(actionPopupHtml.includes('role="status"') && actionPopupHtml.includes('aria-live="polite"'), "the capture popup must announce its result accessibly");
assert(actionPopupHtml.includes('src="assets/client/action-popup.mjs"'), "the capture popup must execute only its packaged module");
assert(actionPopupSource.includes("chrome.tabs.query({ active: true, currentWindow: true })"), "the popup must read only the actively invoked tab");
assert(actionPopupSource.includes('request({ type: "settings:get" })'), "the popup must follow Ampira's saved locale and color mode");
assert(actionPopupSource.includes('type: "reading-queue:capture-current"'), "the popup must route captures through the service worker");
assert(actionPopupSource.includes('from "./popup-i18n.mjs"')
  && actionPopupSource.includes('from "./runtime-client.mjs"')
  && !actionPopupSource.includes('from "./i18n.mjs"')
  && !actionPopupSource.includes('from "./api.mjs"'),
"the popup must use its generated micro-catalog and direct runtime port instead of the full dashboard dependency graph");
assert(actionPopupSource.includes('import { createThemedIcon } from "./icons.mjs"') && actionPopupSource.includes('icon: "check"') && actionPopupSource.includes('icon: "info-circle"'), "popup controls and states must use the shared local icon library");
assert(actionPopupSource.includes("textContent") && !actionPopupSource.includes("innerHTML"), "captured page metadata must remain inert text");

assert.equal(DEFAULT_LOCALE, "zh-CN");
assert.deepEqual(SUPPORTED_LOCALES, ["en", "zh-CN", "zh-Hant"]);
assert.equal(normalizeLocale("en-US"), "en");
assert.equal(normalizeLocale("zh_TW"), "zh-Hant");
assert.equal(normalizeLocale("zh-HK"), "zh-Hant");
assert.equal(normalizeLocale("zh-Hans-SG"), "zh-CN");
assert.equal(detectSupportedLocale(["fr-FR", "en-GB"]), "en");
assert.equal(detectSupportedLocale(["fr-FR"]), "zh-CN");
assert.equal(translate("en", "context.openAll", { count: 3 }), "Open all in new tabs (3)");
assert.equal(translate("zh-CN", "context.explainArticle"), "解释文章");
assert.equal(translate("zh-CN", "context.hideBookmarkCategory"), "隐藏此分类");
assert.equal(translate("zh-Hant", "settings.bookmarks.restoreAll"), "全部恢復");
assert.equal(translate("en", "empty.hiddenCategories.title"), "All categories are hidden");
const englishAiDisclosure = translate("en", "settings.service.consent");
const chineseAiDisclosure = translate("zh-CN", "settings.service.consent");
assert(englishAiDisclosure.includes("content you submit or select")
  && englishAiDisclosure.includes("context needed")
  && englishAiDisclosure.includes("configured provider"),
"the prominent AI disclosure must identify user-directed content, required context, and the configured provider");
assert(chineseAiDisclosure.includes("提交或选择的内容")
  && chineseAiDisclosure.includes("所需的上下文")
  && chineseAiDisclosure.includes("配置的服务商"),
"the Chinese AI disclosure must identify user-directed content, required context, and the configured provider");
assert.equal(translate("en", "onboarding.sources.title"), "Choose your sources");
assert.equal(translate("zh-CN", "onboarding.sources.title"), "选择内容来源");
assert.equal(translate("zh-CN", "onboarding.sources.consent"), "仅在本机读取书签标题、网址和文件夹，不修改书签。");
assert.equal(translateCount("en", "unit.entries", 1), "1 entry");
assert.equal(translateCount("en", "unit.entries", 2), "2 entries");
assert.equal(formatListForLocale("en", ["News", "Design"]), "News and Design");
assert.deepEqual(defaultBookmarkFoldersForLocale("en"), { news: "News", inspiration: "Inspiration" });
assert.deepEqual(defaultBookmarkFoldersForLocale("zh-Hant"), { news: "資訊", inspiration: "審美" });
assert.equal(translate("en", "settings.bookmarks.folderOption", { name: "Design", count: 5 }), "Design (5)");
assert.equal(DEFAULT_SETTINGS.newsBookmarkFolder, "");
assert.equal(DEFAULT_SETTINGS.inspirationBookmarkFolder, "");
assert.equal(DEFAULT_SETTINGS.colorMode, "system", "appearance must follow the system preference by default");
assert.equal(DEFAULT_SETTINGS.dashboardGlassBlurEnabled, true, "dashboard glass blur must stay enabled unless the user turns it off");
assert.equal(DEFAULT_SETTINGS.headerImageEnabled, true, "the header image must be enabled by default");
assert.equal(DEFAULT_SETTINGS.headerImageBlurEnabled, false, "header-image blur must be opt-in");
assert.equal(DEFAULT_SETTINGS.headerImageBlurAmount, 12, "header-image blur must remember a useful default amount");
assert.equal(DEFAULT_SETTINGS.headerImageHeightScale, 100, "header-image height must preserve the existing responsive default");
assert.equal(DEFAULT_SETTINGS.bookmarkSectionEnabled, false, "public sources must hide bookmark navigation and the main bookmark section by default");
assert.equal(truncateText("标题", 4), "标题");
assert.equal(truncateText("这是一个过长标题", 5), "这是一个…");
assert.equal(textLength(truncateText("😀😀😀😀", 3)), 3, "text caps must count Unicode characters without splitting emoji");
assert.equal(normalizeSummaryMarkup("### **核心内容**"), "核心内容");
assert.equal(cleanGeneratedSummaryLine("**核心内容**：这是一段摘要。"), "这是一段摘要。");
assert.equal(cleanGeneratedSummaryLine("核心内容：第一点。 **重要性**：第二点。"), "第一点。 第二点。");
assert.equal(cleanGeneratedSummaryLine("核心事实：规则今天生效。"), "规则今天生效。");
assert.equal(cleanGeneratedSummaryLine("实际影响：服务需要调整流程。"), "服务需要调整流程。");
assert.equal(cleanGeneratedSummaryLine("后续关注：等待实施细则。"), "等待实施细则。");
assert.equal(cleanGeneratedSummaryLine("信息边界：摘录未提供处罚案例。"), "摘录未提供处罚案例。");
assert.equal(cleanGeneratedSummaryLine("Practical impact: Services must update their flows."), "Services must update their flows.");
assert.equal(cleanGeneratedSummaryLine("### 核心内容"), "");
assert.equal(cleanGeneratedSummaryLine("- **行动建议**：继续观察。"), "继续观察。");
assert.equal(hasStructuralSummaryPrefix("**核心内容**：正文"), false, "prefix checks run after Markdown normalization");
assert.equal(hasStructuralSummaryPrefix(normalizeSummaryMarkup("**核心内容**：正文")), true);
assert.equal(extractGeneratedSummaryTitle("**标题：AI 精炼标题**"), "AI 精炼标题");
assert.equal(extractGeneratedSummaryTitle(`标题：${"长".repeat(80)}`).length, 64, "generated card titles must be capped before caching");
assert.equal(cleanGeneratedSummaryLine("标题：AI 精炼标题"), "", "generated title rows must not leak into summary text");
assert(aiSearchRuntimeSource.includes("for (let attempt = 0; attempt < 2; attempt += 1)")
  && aiSearchRuntimeSource.includes('typedError("AI_LOCALE_CHANGED"')
  && aiSearchRuntimeSource.includes("aiOutputMatchesLocale(cached.answer, locale)"), "AI search must retry language once, reject locale races, and distrust cached prose");
assert((refreshRuntimeSource.match(/expectedLocale: locale/g) || []).length >= 3
  && refreshRuntimeSource.includes("cardSummaryOutputMatchesLocale")
  && refreshRuntimeSource.includes("dailyDigestOutputMatchesLocale"), "card summaries and daily briefs must use structured locale validators");
assert(extensionRuntimeSource.includes("outputValidator: readerTranslationMatchesLocale")
  && extensionRuntimeSource.includes("shouldReleaseAutomaticAiQuota(error)"), "Reader translation must enforce its locale and automatic language failures must retain one task quota");
assert(dashboardContentRuntimeSource.includes("aiOutputPartsMatchLocale(generatedParts, settingsLocale(settings))"), "cached AI daily briefs must be revalidated before presentation");
const boundedCardSummary = limitGeneratedSummaryLines(["甲".repeat(120), "乙".repeat(120), "丙".repeat(120), "丁".repeat(20)], 280, 3);
assert.equal(boundedCardSummary.length, 3, "card summaries must retain at most three information-dense paragraphs");
assert.equal([...boundedCardSummary.join("")].length, 280, "card summaries must enforce the 280-character cache boundary");
assert(boundedCardSummary[2].endsWith("…"), "overlong card summaries must end with a visible truncation marker");
const generatedDigest = parseGeneratedDailyDigest("OVERVIEW: 第一段。\nOVERVIEW: 第二段。\nEVENT 1: AI 事件标题\nEVENT 2: 第二个标题", 3);
assert.deepEqual(generatedDigest.overview, ["第一段。", "第二段。"]);
assert.deepEqual(generatedDigest.eventTitles, ["AI 事件标题", "第二个标题", ""]);
assert.equal(parseGeneratedDailyDigest(`EVENT 1: ${"长".repeat(80)}`, 1).eventTitles[0].length, 64, "daily event AI titles must be capped at 64 characters");
assert.equal(cleanAiAnswerMarkup("## **核心判断**\n- 第一条"), "核心判断\n• 第一条", "AI search must not expose Markdown markers");
const structuredAiAnswer = parseAiAnswer("核心判断：直接结论。\n关键信息：\n- 事实一\n- 事实二");
assert.deepEqual(structuredAiAnswer.sections.map(({ title }) => title), ["核心判断", "关键信息"]);
assert(structuredAiAnswer.sections[1].body.includes("• 事实一"), "AI search bullets must remain semantic after Markdown cleanup");
assert.equal(
  parseAiAnswer("直接回答：你好，需要我帮你找什么？\n本地依据：没有匹配内容。\n补充判断：这是社交性开场。\n建议动作：等待用户继续输入。").sections[0].body,
  "你好，需要我帮你找什么？",
  "legacy structured answers must preserve each section's user-facing text",
);
assert.equal(DEFAULT_SETTINGS.floatingWebOpenEnabled, false, "in-app reading must be opt-in by default");
assert.equal(DEFAULT_SETTINGS.retainSeenArchive, false, "viewed archive retention must be opt-in by default");
assert.equal(normalizeSettings({}).retainSeenArchive, false, "missing archive retention settings must use daily cleanup");
assert.equal(normalizeSettings({ retainSeenArchive: true }).retainSeenArchive, true, "an explicit archive retention opt-in must be preserved");
assert.equal(normalizeSettings({ retainSeenArchive: false }).retainSeenArchive, false, "an explicit archive retention opt-out must be preserved");
assert.equal(DEFAULT_SETTINGS.personalizedRankingEnabled, false, "personalized ranking must be opt-in by default");

const permissionUiRows = [
  { origin: "https://allowed.example/*", granted: true },
  { origin: "https://pending.example/*", granted: false },
];
assert.deepEqual(permissionRowCounts(permissionUiRows), {
  required: 2,
  granted: 1,
  pending: 1,
});
assert.deepEqual(requiredUngrantedOrigins(permissionUiRows), ["https://pending.example/*"]);
assert.deepEqual(newlyRequiredUngrantedOrigins(permissionUiRows, [permissionUiRows[0]]), ["https://pending.example/*"]);
assert.deepEqual(exactPermissionOrigins(["https://pending.example/path", "http://unsafe.example/", "https://*/*"]), ["https://pending.example/*"]);
assert.equal(permissionRowCounts(permissionUiRows.map((row) => ({ ...row, granted: true }))).pending, 0, "fully granted rows must not leave an active bulk action");

const localeKeys = Object.keys(localeMessages(DEFAULT_LOCALE)).sort();
const defaultMessages = localeMessages(DEFAULT_LOCALE);
const reviewedBrandTaglines = {
  en: "Get news from bookmarked sites, then let AI organize and explain it.",
  "zh-CN": "从书签里的网站获取新资讯，再用 AI 整理和解读。",
  "zh-Hant": "從書籤裡的網站取得新資訊，再用 AI 整理與解讀。",
};
const reviewedAiServiceTitles = {
  en: "AI summaries & analysis",
  "zh-CN": "AI 整理与解读",
  "zh-Hant": "AI 整理與解讀",
};
const reviewedOnboardingTitles = {
  en: "Choose your sources",
  "zh-CN": "选择内容来源",
  "zh-Hant": "選擇內容來源",
};
const reviewedPainOpenings = {
  en: "Bookmarks are easy to save and easy to forget. The sites you follow are scattered across the web, and checking each one every day takes time. Ampira reads the bookmarks you choose, brings saved pages and new posts from those sites into one New Tab page, and sorts them by time or importance. Optional AI creates card summaries and a daily brief. It can also read an article and answer follow-up questions.",
  "zh-CN": "收藏夹里有不少以后想看的网页，真正再打开的并不多。关注的网站也散在不同地方，很难每天逐个查看。Ampira 读取你选择的书签，把保存的网页和这些网站的新内容放进新标签页，并按时间或重要性整理。需要时，AI 会生成卡片摘要和今日简报，也能读取正文并继续回答问题。",
  "zh-Hant": "收藏夾裡存了不少打算以後再看的網頁，真正回頭開啟的卻不多。關注的網站也散在不同地方，很難每天逐一查看。Ampira 讀取你選擇的書籤，把保存的網頁和這些網站的新內容放進新分頁，再依時間或重要性整理。需要時，AI 會產生卡片摘要與今日簡報，也能讀取內文並繼續回答問題。",
};
const reviewedProfessionalUseCases = {
  en: "If you track an industry or research topic over time, put the sources you follow in one bookmark folder. Ampira keeps their updates together, sorts them by importance, and uses AI to create a daily brief. Open any article to ask follow-up questions.",
  "zh-CN": "如果你需要长期跟踪一个行业或研究主题，可以把常看的来源放进同一个书签文件夹。Ampira 会集中更新，按重要性排序，再用 AI 整理成今日简报。遇到值得继续看的内容，也可以打开正文追问。",
  "zh-Hant": "如果你需要長期追蹤一個產業或研究主題，可以把常看的來源放進同一個書籤資料夾。Ampira 會集中更新，依重要性排序，再用 AI 整理成今日簡報。遇到值得繼續看的內容，也可以開啟內文追問。",
};
const futureMarketingPattern = /\b(?:Pro|price|pricing|paid subscriptions?|subscription (?:plans?|fees?)|subscribe now|coming soon)\b|付费|付費|路线图|路線圖|未来功能|未來功能|专题雷达|專題雷達|简报工作室|簡報工作室|研究项目|研究項目/i;
assert(!futureMarketingPattern.test("RSS subscription / RSS 订阅 / RSS 訂閱"), "feed subscriptions are a supported source feature");
assert(futureMarketingPattern.test("paid subscription"), "paid plans remain outside the published product scope");
for (const locale of SUPPORTED_LOCALES) {
  const messages = localeMessages(locale);
  const runtimeMessages = runtimeLocaleMessages(locale);
  const expectedRuntimeKeys = localeKeys.filter(isRuntimeLocaleKey);
  assert.deepEqual(Object.keys(messages).sort(), localeKeys, `${locale} catalog keys must match ${DEFAULT_LOCALE}`);
  assert.deepEqual(Object.keys(runtimeMessages).sort(), expectedRuntimeKeys, `${locale} runtime catalog must contain exactly the policy-selected keys`);
  assert(Object.keys(runtimeMessages).length < localeKeys.length / 4, `${locale} runtime catalog must stay below one quarter of the client catalog`);
  assert.equal(messages["settings.about.tagline"], reviewedBrandTaglines[locale], `${locale} must use the reviewed About tagline`);
  assert.equal(messages["settings.service.title"], reviewedAiServiceTitles[locale], `${locale} must use the reviewed AI settings title`);
  assert.equal(messages["onboarding.sources.title"], reviewedOnboardingTitles[locale], `${locale} must use the reviewed source-selection title`);
  for (const key of localeKeys) {
    const expected = [...String(defaultMessages[key]).matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((match) => match[1]).sort();
    const actual = [...String(messages[key]).matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((match) => match[1]).sort();
    assert.deepEqual(actual, expected, `${locale} placeholders must match ${DEFAULT_LOCALE} for ${key}`);
  }
  for (const key of expectedRuntimeKeys) {
    assert.equal(runtimeMessages[key], messages[key], `${locale} runtime translation must match the client catalog for ${key}`);
  }
}
assert.deepEqual(Object.keys(allTranslationMessages), [...ALL_TRANSLATION_KEYS], "the cross-locale client subset must contain exactly the reviewed keys");
for (const [index, locale] of SUPPORTED_LOCALES.entries()) {
  const messages = localeMessages(locale);
  assert.deepEqual(Object.keys(popupMessages[locale] || {}), [...POPUP_LOCALE_KEYS], `${locale} popup catalog must contain exactly the reviewed keys`);
  for (const key of ALL_TRANSLATION_KEYS) {
    assert.equal(allTranslationMessages[key]?.[index], messages[key], `${locale} cross-locale message must match the full catalog for ${key}`);
  }
  for (const key of POPUP_LOCALE_KEYS) {
    assert.equal(popupMessages[locale]?.[key], messages[key], `${locale} popup message must match the full catalog for ${key}`);
  }
}
const clientModuleFiles = await listModuleFiles(path.join(root, "assets", "client"));
const allTranslationCalls = [];
for (const file of clientModuleFiles.filter((file) => !file.endsWith(`${path.sep}i18n.mjs`))) {
  const source = await fs.readFile(file, "utf8");
  const literalCalls = [...source.matchAll(/\ballTranslations\(\s*["']([^"']+)["']/g)];
  assert.equal((source.match(/\ballTranslations\s*\(/g) || []).length, literalCalls.length, `${path.relative(root, file)} must call allTranslations with literal keys`);
  allTranslationCalls.push(...literalCalls.map((match) => match[1]));
}
assert.deepEqual([...new Set(allTranslationCalls)].sort(), [...ALL_TRANSLATION_KEYS].sort(), "the cross-locale subset policy must cover every client call exactly");
const popupTranslationCalls = [...actionPopupSource.matchAll(/\bt\(\s*["']([^"']+)["']/g)].map((match) => match[1]);
assert.deepEqual([...new Set(popupTranslationCalls)].sort(), [...POPUP_LOCALE_KEYS].sort(), "the popup subset policy must cover every popup translation call exactly");
assert.equal(translateRuntime("en", "background.error.weatherPermission"), translate("en", "background.error.weatherPermission"));
assert.equal(translateRuntime("zh-Hant", "reader.error.genericBody"), translate("zh-Hant", "reader.error.genericBody"));
assert.equal(translateRuntime("en", "settings.about.tagline"), "settings.about.tagline", "runtime i18n must not silently reintroduce client-only messages");
const defaultRuntimeMessages = runtimeLocaleMessages(DEFAULT_LOCALE);
for (const file of await listModuleFiles(path.join(root, "extension"))) {
  const source = await fs.readFile(file, "utf8");
  for (const match of source.matchAll(/["'`](background\.[A-Za-z0-9_.-]+|reader\.[A-Za-z0-9_.-]+|action\.capture[A-Za-z0-9_.-]*|bookmarkFolder\.default[A-Za-z0-9_.-]*|inspirationPreset\.[A-Za-z0-9_.-]+|summary\.status\.noContent|settings\.transfer\.error\.[A-Za-z0-9_.-]+)["'`]/g)) {
    assert(Object.hasOwn(defaultRuntimeMessages, match[1]), `${path.relative(root, file)} runtime translation key must exist: ${match[1]}`);
  }
}
for (const file of ["en.mjs", "zh-CN.mjs", "zh-Hant.mjs"]) {
  const source = await fs.readFile(path.join(root, "assets", "client", "locales", file), "utf8");
  const declaredKeys = [...source.matchAll(/^\s*"([^"]+)"\s*:/gm)].map((match) => match[1]);
  assert.equal(new Set(declaredKeys).size, declaredKeys.length, `${file} must not declare duplicate translation keys`);
}

const manifestMessageKeys = [];
const manifestDescriptions = [];
for (const locale of ["en", "zh_CN", "zh_TW"]) {
  const rawMessages = await fs.readFile(path.join(root, "_locales", locale, "messages.json"), "utf8");
  const declaredKeys = [...rawMessages.matchAll(/^\s{2}"([^"]+)"\s*:/gm)].map((match) => match[1]);
  assert.equal(new Set(declaredKeys).size, declaredKeys.length, `${locale} manifest messages must not declare duplicate keys`);
  const messages = JSON.parse(rawMessages);
  const keys = Object.keys(messages).sort();
  if (!manifestMessageKeys.length) manifestMessageKeys.push(...keys);
  assert.deepEqual(keys, manifestMessageKeys, `${locale} manifest messages must have matching keys`);
  manifestDescriptions.push(messages.appDescription?.message);
}
assert.deepEqual(manifestDescriptions, [
  reviewedBrandTaglines.en,
  reviewedBrandTaglines["zh-CN"],
  reviewedBrandTaglines["zh-Hant"],
], "all packaged locales must use the reviewed brand tagline on the browser extensions page");
const storeSummaries = [
  "News from your bookmarks, sorted by time or importance. Optional AI summarizes and answers questions. Local by default. No sign-up.",
  "从书签里的网站获取新资讯，按时间或重要性查看。AI 功能可选，可生成摘要和今日简报，也能结合正文继续解读。数据默认保存在本地，不用注册账号。",
  "從書籤裡的網站取得新資訊，依時間或重要性查看。AI 功能可選，可產生摘要與今日簡報，也能讀取內文並繼續解讀。資料預設留在本機，不用註冊帳號。",
];
for (const summary of storeSummaries) assert(summary.length <= 132, "store summaries must stay within the Chrome Web Store limit");
for (const [language, locale, summary] of [
  ["en", "en", storeSummaries[0]],
  ["zh-CN", "zh-CN", storeSummaries[1]],
  ["zh-TW", "zh-Hant", storeSummaries[2]],
]) {
  for (const directory of ["listing", "edge-listing"]) {
    const shortFile = `${language}-short.txt`;
    const descriptionFile = `${language}-description.txt`;
    const shortDescription = await fs.readFile(path.join(root, "store", directory, shortFile), "utf8");
    const listing = await fs.readFile(path.join(root, "store", directory, descriptionFile), "utf8");
    assert.equal(shortDescription.trim(), summary, `${directory}/${shortFile} must match the reviewed localized summary`);
    assert(listing.startsWith(reviewedPainOpenings[locale]), `${directory}/${descriptionFile} must open with the reviewed user problem and solution`);
    assert(listing.includes(reviewedProfessionalUseCases[locale]), `${directory}/${descriptionFile} must include the reviewed current professional use case`);
    assert(!/^(?:#{1,6}\s|- )/m.test(listing), `${directory}/${descriptionFile} must be directly pasteable plain text without Markdown headings or list markers`);
    assert(!/\[[^\]]+\]\([^)]+\)/.test(listing), `${directory}/${descriptionFile} must not contain Markdown links`);
    assert(!futureMarketingPattern.test(listing), `${directory}/${descriptionFile} must not promise paid or future features`);
  }
}

const dashboardSource = await fs.readFile(path.join(root, "dashboard.html"), "utf8");
assert(dashboardSource.includes(`<div class="about-meta" data-i18n="settings.about.tagline">${reviewedBrandTaglines["zh-CN"]}</div>`), "the static About fallback must match the reviewed Simplified Chinese tagline");
assert(dashboardSource.includes(`<h3 data-i18n="settings.service.title">${reviewedAiServiceTitles["zh-CN"]}</h3>`), "the static AI settings title must match the reviewed Simplified Chinese copy");
assert(dashboardSource.includes('data-i18n="onboarding.sources.title" tabindex="-1">选择内容来源</h1>'), "the source-selection step must match its localized title and receive reading focus");
const settingsCssSource = await fs.readFile(path.join(root, "assets", "styles", "settings.css"), "utf8");
const tokensCssSource = await fs.readFile(path.join(root, "assets", "styles", "tokens.css"), "utf8");
const settingsResponsiveCssSource = await fs.readFile(path.join(root, "assets", "styles", "motion-responsive.css"), "utf8");
const contentSyncSettingsSource = await fs.readFile(path.join(root, "assets", "client", "content-sync-settings.mjs"), "utf8");
const settingsControllerSource = await fs.readFile(path.join(root, "assets", "client", "settings-controller.mjs"), "utf8");
const dashboardAppSource = await fs.readFile(path.join(root, "assets", "client", "dashboard-app.mjs"), "utf8");
const dashboardI18nKeys = [...dashboardSource.matchAll(/(?:data-i18n(?:-[\w-]+)?|data-dynamic-i18n)="([^"]+)"/g)].map((match) => match[1]);
for (const key of dashboardI18nKeys) assert(localeKeys.includes(key), `dashboard translation key must exist: ${key}`);
const untranslatedDashboardLines = dashboardSource.split(/\r?\n/).filter((line) => (
  /[\u3400-\u9fff]/u.test(line)
  && !line.includes("data-i18n")
  && !line.includes("data-dynamic-i18n")
  && !/<option value="zh-(?:CN|Hant)">/.test(line)
  && !/id="currentUiLanguage"/.test(line)
));
assert.deepEqual(untranslatedDashboardLines, [], "dashboard-owned Chinese copy must be marked for translation");
const settingsTabNames = [...dashboardSource.matchAll(/data-settings-tab="([^"]+)"/g)].map((match) => match[1]).sort();
const settingsPanelNames = [...dashboardSource.matchAll(/data-settings-panel="([^"]+)"/g)].map((match) => match[1]).sort();
assert.deepEqual(settingsTabNames, settingsPanelNames, "every settings tab must map to exactly one settings panel");
assert.deepEqual(settingsTabNames, ["about", "appearance", "bookmarks", "bot", "browser", "cache", "exclusions", "service"], "settings must retain the seven existing sections and add a dedicated Bot board page");
for (const id of [
  "sourceCoverageDetails", "cacheAdvancedDetails",
  "bookmarkExtraDetails", "bookmarkHiddenDetails", "sourcePermissionDetails", "exclusionDetails",
  "sourceSuggestionDetails",
]) assert(dashboardSource.includes(`id="${id}"`), `settings must preserve the compact disclosure: ${id}`);
assert(tokensCssSource.includes("--settings-panel-bg:")
  && tokensCssSource.includes("--settings-panel-backdrop: blur(28px)")
  && tokensCssSource.includes("--settings-overlay-backdrop: blur(14px)")
  && settingsCssSource.includes("#settingsModal .modal")
  && settingsCssSource.includes("var(--settings-panel-fallback-bg)")
  && settingsCssSource.includes("@media (forced-colors: active)"), "settings glass must use dedicated theme tokens with solid and forced-color fallbacks");
assert(settingsCssSource.includes('.settings-status[data-state="ready"]')
  && dashboardSource.includes('id="settingsStatus" role="status" aria-live="polite" data-state="loading"'), "the settings footer must hide passive ready copy while retaining live loading and change feedback");
assert(contentSyncSettingsSource.includes("els.contentSyncDetails.hidden = !els.contentSyncEnabledInput.checked"), "enabled content sync must reveal only its dependent settings");
const quotaStatusIndex = dashboardSource.indexOf('id="settingsQuotaStatus"');
const cacheStatusIndex = dashboardSource.indexOf('id="settingsCacheOverviewStatus"');
const autoStatusIndex = dashboardSource.indexOf('id="settingsAutoAiStatus"');
assert(autoStatusIndex > 0 && autoStatusIndex < quotaStatusIndex && quotaStatusIndex < cacheStatusIndex, "AI settings must group automatic organization with its quota before the independent cache status");
assert(dashboardSource.includes('id="settingsQuotaMeter" role="meter" aria-labelledby="settingsQuotaLabel"')
  && settingsResponsiveCssSource.includes("border-block-start: 1px solid var(--line-faint)"), "the grouped runtime overview must expose a labeled usage meter and separate stacked cache status on narrow screens");
for (const removedRuntimeDetail of ["settingsRuntimeDetails", "settingsRuntimeSummaryStatus", "settings-runtime-details", "settings-runtime-detail-grid", "settings-overview-metric"]) {
  assert(!dashboardSource.includes(removedRuntimeDetail) && !settingsCssSource.includes(removedRuntimeDetail), `the persistent runtime status band must not retain obsolete disclosure code: ${removedRuntimeDetail}`);
}
for (const removedRuntimeKey of ["settings.overview.runtimeDetails", "settings.overview.runtimeDetailsHelp", "settings.overview.runtimeSummary"]) {
  assert(!localeKeys.includes(removedRuntimeKey), `obsolete runtime disclosure locale key must stay removed: ${removedRuntimeKey}`);
}
assert(dashboardAppSource.includes('button.active")?.scrollIntoView({')
  && dashboardAppSource.includes('inline: "nearest"')
  && settingsControllerSource.includes("window.requestAnimationFrame(revealActiveSettingsTab)")
  && dashboardAppSource.includes("window.requestAnimationFrame(revealActiveSettingsTab)"), "the active settings tab must remain visible when a narrow horizontal rail is selected or resized");
const dashboardIds = [...dashboardSource.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
for (const id of [
  "settingsOverviewTitle",
  "settingsStatus",
  "apiBaseUrlInput",
  "apiKeyInput",
  "sourcePermissionSummary",
  "headerImageBlurAmountInput",
  "headerImageHeightInput",
  "headerImageLocalInput",
  "headerImageFullscreenInput",
  "saveSettings",
]) {
  assert.equal(dashboardIds.filter((value) => value === id).length, 1, `settings control id must remain unique: ${id}`);
}
const servicePanelStart = dashboardSource.indexOf('data-settings-panel="service"');
const cachePanelStart = dashboardSource.indexOf('<div class="settings-panel" data-settings-panel="cache">');
const servicePanelSource = dashboardSource.slice(servicePanelStart, cachePanelStart);
assert(servicePanelSource.includes('id="settingsOverviewTitle"'), "the AI runtime overview must live inside the AI settings panel");
assert(!dashboardSource.slice(0, servicePanelStart).includes('id="settingsOverviewTitle"'), "the AI runtime overview must not remain global above every settings panel");
const browserPanelStart = dashboardSource.indexOf('<div class="settings-panel" data-settings-panel="browser">');
const exclusionsPanelStart = dashboardSource.indexOf('<div class="settings-panel" data-settings-panel="exclusions">');
const browserPanelSource = dashboardSource.slice(browserPanelStart, exclusionsPanelStart);
const bookmarksPanelStart = dashboardSource.indexOf('data-settings-panel="bookmarks"');
const appearancePanelStart = dashboardSource.indexOf('<div class="settings-panel" data-settings-panel="appearance">');
const aboutPanelStart = dashboardSource.indexOf('<div class="settings-panel" data-settings-panel="about">');
const settingsFooterStart = dashboardSource.indexOf('<div class="modal-actions">', aboutPanelStart);
const bookmarksPanelSource = dashboardSource.slice(bookmarksPanelStart, appearancePanelStart);
const cacheFetchStart = dashboardSource.indexOf('aria-labelledby="cacheFetchTitle"');
const sourceCoverageStart = dashboardSource.indexOf('aria-labelledby="sourceCoverageTitle"');
const cacheAdvancedStart = dashboardSource.indexOf('aria-labelledby="cacheAdvancedTitle"');
const cacheFetchSource = dashboardSource.slice(cacheFetchStart, sourceCoverageStart);
const cacheAdvancedSource = dashboardSource.slice(cacheAdvancedStart, bookmarksPanelStart);
assert(!/<input[^>]+(?:id|name)="[^"]*(?:new.?tab|override)[^"]*"/i.test(browserPanelSource), "browser integration must not expose a fake writable new-tab toggle");
assert(bookmarksPanelSource.includes('<input id="bookmarkSectionEnabledInput" type="checkbox">'), "bookmark settings must expose a default-off home-section switch for public sources");
assert(!browserPanelSource.includes('id="bookmarkSectionEnabledInput"'), "bookmark-section visibility must remain in bookmark settings");
assert(bookmarksPanelSource.includes('id="websiteShortcutsEnabledInput"'), "bookmark settings must expose the quick-bookmark module switch explicitly");
assert(!browserPanelSource.includes('id="websiteShortcutsEnabledInput"'), "browser settings must not retain quick-bookmark management");
assert(dashboardSource.indexOf('data-i18n="settings.support.label"', aboutPanelStart) < settingsFooterStart
  && !dashboardSource.slice(settingsFooterStart, dashboardSource.indexOf('id="aiSearchOverlay"')).includes('settings.support.label'), "developer support must live in About instead of the persistent settings footer");
assert(dashboardSource.includes('id="bookmarkNav"') && dashboardSource.includes('<section id="library"'), "bookmark visibility must target the existing navigation entry and main library section");
const navMainSource = dashboardSource.slice(dashboardSource.indexOf('<div class="nav-main">'), dashboardSource.indexOf('</div>', dashboardSource.indexOf('<div class="nav-main">')));
const navEntryMarkers = ['data-scroll="daily"', 'data-scroll="news"', 'id="bookmarkNav"', 'id="aiSearchNav"', 'id="settingsNav"'];
assert.equal((navMainSource.match(/class="nav-btn(?: active)?"/g) || []).length, 5, "the primary navigation must retain exactly five entries");
assert(navEntryMarkers.every((marker, index) => navMainSource.indexOf(marker) >= 0
  && (index === 0 || navMainSource.indexOf(marker) > navMainSource.indexOf(navEntryMarkers[index - 1]))), "the five primary navigation entries must retain their order");
assert(shellControllerSource.includes("els.bookmarkNav.hidden = !visible")
  && shellControllerSource.includes("els.librarySection.hidden = !visible")
  && shellControllerSource.includes('.filter((button) => !button.hidden)')
  && shellControllerSource.includes("entry.section.hidden !== true"), "hidden bookmark surfaces must be removed from navigation sizing and scroll selection");
assert(shellControllerSource.includes('sidebar.querySelectorAll(".nav-logo")')
  && shellControllerSource.includes("Math.max(labelSlotMin, maxLabelWidth)")
  && shellControllerSource.includes("iconRight + gap + labelSlotWidth + paddingRight + 2"), "expanded navigation must fit the longest localized label or brand name with explicit right padding");
assert(!shellControllerSource.includes('    ".nav-btn",'), "navigation must not remain registered for the removed pointer glow");
assert(shellControllerSource.includes("new IntersectionObserver(syncNavToCurrentSection")
  && shellControllerSource.includes("scrollObserver.observe(entry.section)")
  && !shellControllerSource.includes('window.addEventListener("scroll"')
  && shellControllerSource.includes("if (activeNavButton === nextActiveButton) return;"),
  "navigation scroll selection must observe section crossings and avoid per-frame layout reads or unchanged active-state writes");
const navClickBindingSource = dashboardAppSource.slice(dashboardAppSource.indexOf('document.querySelector("#navLogo")'), dashboardAppSource.indexOf("els.settingsNav.addEventListener"));
assert(!navClickBindingSource.includes("setActiveNavButton("), "section click bindings must delegate selection to the shell controller");
assert(settingsWorkflowSource.includes('"bookmarkSectionEnabled", "websiteShortcutsEnabled"'), "the runtime settings workflow must accept bookmark-section visibility without treating it as a source change");
assert(!cacheFetchSource.includes('id="personalizedRankingEnabledInput"'), "fetch settings must not expose the advanced personalization switch");
assert(cacheAdvancedSource.includes('<input id="personalizedRankingEnabledInput" type="checkbox">'), "advanced settings must expose personalized ranking with an unchecked first-frame default");
assert(cacheAdvancedSource.indexOf('id="newsPerCategoryInput"') < cacheAdvancedSource.indexOf('id="readingQueueOpenOnReadAllInput"')
  && cacheAdvancedSource.indexOf('id="readingQueueOpenOnReadAllInput"') < cacheAdvancedSource.indexOf('id="personalizedRankingEnabledInput"'), "advanced switches must follow the three numeric settings");
assert(dashboardSource.includes('id="sourcePermissionSummary"'), "website access must expose a visible settings-page status");
assert(dashboardSource.includes('id="sourceCoverageSummary"') && dashboardSource.includes('id="sourceCoverageList"'), "news settings must expose source coverage and per-source diagnostics");
assert(!dashboardSource.includes('id="sourceCoverageStatus"') && !dashboardSource.includes('id="bookmarkSourceStatus"'), "settings must not repeat source summaries beside the controls that already show them");
assert(!dashboardSource.includes("IndexedDB") && !dashboardSource.includes("Manifest V3"), "settings and onboarding must not expose storage or extension implementation details");
assert(dashboardSource.includes('data-i18n="onboarding.sources.consent"')
  && dashboardSource.includes('data-i18n="settings.sync.security"'), "copy cleanup must retain bookmark and secret-storage consequences");
const sourceCoverageControllerSource = await fs.readFile(path.join(root, "assets", "client", "source-coverage-controller.mjs"), "utf8");
assert(!sourceCoverageControllerSource.includes("settings.sources.method."), "source status rows must not expose internal extraction methods");
assert(sourceCoverageControllerSource.includes("await requestOrigins([pattern])"), "cross-origin Feed discovery must require a direct user-gesture permission request through the shared permission client");

const refreshServiceSource = await fs.readFile(path.join(root, "extension", "runtime", "refresh-service.mjs"), "utf8");
assert(/return\s*\{[\s\S]{0,160}\brefreshSource\b/.test(refreshServiceSource), "the refresh service factory must expose the scoped source refresh route");
assert(servicePanelSource.includes('class="credential-panel ai-image-layout"')
  && !servicePanelSource.includes('id="toggleBrowserSearchPermission"')
  && browserPanelSource.includes('id="toggleBrowserSearchPermission"')
  && browserPanelSource.includes('id="toggleHistorySearchPermission"'), "optional image search must remain in AI settings while browser and history search stay independently manageable in browser settings");
assert(!dashboardSource.includes('id="aiFeedAccessGroup"') && !dashboardSource.includes('id="grantAiFeedOrigins"'), "cross-language Feed domains must use the existing initial source-permission flow");
assert(dashboardSource.includes('class="credential-panel ai-image-layout"') && /class="[^"]*\bai-image-actions\b[^"]*"/.test(dashboardSource), "optional image-search controls must use a grouped credential layout with responsive actions");
assert(!dashboardSource.includes('id="refreshPermissionStatus"'), "website access must sync automatically without a no-op refresh button");
assert(dashboardSource.includes('id="toggleFaviconPermission"'), "existing users must be able to manage the optional favicon permission in settings");
assert(dashboardSource.includes('data-i18n="onboarding.sites.favicon"'), "onboarding must disclose the bundled browser-provided website icons");
assert.equal((dashboardSource.match(/data-onboarding-step="\d"/g) || []).length, 3, "onboarding must contain welcome, source and access steps");
assert(dashboardSource.includes('id="onboardingProgress" role="progressbar"')
  && dashboardSource.includes('aria-valuemin="1" aria-valuemax="3" aria-valuenow="1"'), "onboarding progress must expose its three-step range to assistive technology");
assert(dashboardSource.includes('data-i18n="onboarding.sources.title"')
  && !dashboardSource.includes('class="onboarding-step-icon"')
  && !dashboardSource.includes('class="onboarding-feature-copy"'), "onboarding must keep the simplified copy-first presentation without decorative feature cards");
assert(dashboardSource.includes('id="onboardingNewsFolder"') && dashboardSource.includes('id="onboardingInspirationFolder"'), "onboarding must let users choose bookmark folders in place");
assert(dashboardSource.includes('id="inspirationBookmarkFolderSelect"'), "settings must keep inspiration source selection inside the compact folder row");
assert(!dashboardSource.includes('id="inspirationSourceModeGroup"') && !dashboardSource.includes('id="onboardingInspirationSourceMode"'), "settings and onboarding must not restore the large inspiration-source card selectors");
assert(!dashboardSource.includes('name="inspirationSourceMode"') && !dashboardSource.includes('name="onboardingInspirationSource"'), "inspiration mode must be represented by the folder selects rather than parallel radio groups");
assert(dashboardSource.indexOf('id="onboardingNewsFolder"') < dashboardSource.indexOf('id="onboardingGrantSources"'), "folder selection must precede exact-origin permission calculation");
assert(!dashboardSource.includes('id="onboardingConfigureAi"'), "AI setup must be deferred to its existing settings entry");
assert(!dashboardSource.includes('id="onboardingApiKey"') && !dashboardSource.includes('id="finishOnboarding"'), "AI credentials and redundant completion controls must stay out of onboarding");
assert(!dashboardSource.includes('id="onboardingSkipFolders"') && !dashboardSource.includes('id="onboardingSkipPermissions"'), "first-time setup must require authorization instead of offering a skip action");
assert(dashboardSource.includes('id="onboardingPermissionStatus" aria-live="polite"'), "authorization and completion failures must have a live status region");
const permissionUiSource = await fs.readFile(path.join(root, "assets", "client", "extension-ui.mjs"), "utf8");
const onboardingSource = await fs.readFile(path.join(root, "assets", "client", "onboarding-controller.mjs"), "utf8");
assert(permissionUiSource.includes('requestPermissions(["search"])')
  && permissionUiSource.includes('removePermissions(["search"])'), "browser search must be enabled and revoked only through the optional-permission control");
assert(!permissionUiSource.includes('createIcon("key-01", "source-permission-icon")'), "website permission rows must not repeat the section key icon for every origin");
assert(onboardingSource.includes('request("settings:save", patch)'), "onboarding selections must use the settings boundary");
assert(onboardingSource.includes('fillSelect(inspiration, INSPIRATION_PRESET_VALUE'), "onboarding must retain its packaged inspiration option");
const bookmarkSettingsSource = await fs.readFile(path.join(root, "assets", "client", "bookmark-settings-controller.mjs"), "utf8");
const bookmarksViewSource = await fs.readFile(path.join(root, "assets", "client", "bookmarks-view.mjs"), "utf8");
assert(bookmarksViewSource.includes('emptyKind === "noEntries" ? t("action.openSettings") : ""')
  && bookmarksViewSource.includes("hasAction ? openBookmarkSettings : undefined"), "an empty bookmark index must guide the user directly to Bookmark settings");
assert(bookmarkSettingsSource.includes('const optionNodes = [createFolderOption(INSPIRATION_PRESET_VALUE'), "settings must place the Ampira preset first in the inspiration folder select");
assert(onboardingSource.includes('fillSelect(news, PUBLIC_FEED_VALUE')
  && bookmarkSettingsSource.includes('const optionNodes = [createFolderOption(PUBLIC_FEED_VALUE'), "onboarding and settings must place Public Feed first in the news source select");
assert(bookmarkSettingsSource.includes('t("settings.bookmarks.notFound"'), "settings must retain a visible missing option for a removed personal folder");
assert(!onboardingSource.includes('openaiApiKey'), "onboarding must never handle AI credentials");
assert(onboardingSource.includes('await requestPermissionDetails(details)')
  && onboardingSource.includes('supportsNativeFavicon()'), "onboarding must bundle source access and supported browser icons in one permission request");
assert(permissionUiSource.includes('microsoftEdge ? "edge://extensions/"'), "the extension manager action must use Edge's internal management page in Microsoft Edge");
assert(onboardingSource.includes('writeValue(PROGRESS_KEY, "permissions")'), "onboarding must resume at the access step after saving sources");
assert(onboardingSource.includes('request("onboarding:complete")') && onboardingSource.includes('if (busy || step !== 2 || !permissionReady) return;'), "completion must prevent duplicate requests and require the ready authorization step");
assert(permissionUiSource.includes('event.detail?.type === "settings.changed"'), "website access must react to extension permission updates");
assert(permissionUiSource.includes('"visibilitychange"'), "website access must recheck when the page becomes visible");
const aiFieldsetStart = dashboardSource.indexOf('<fieldset class="ai-provider-fields"');
const aiFieldsetEnd = dashboardSource.indexOf("</fieldset>", aiFieldsetStart);
assert(aiFieldsetStart > 0 && aiFieldsetEnd > aiFieldsetStart, "AI provider controls must use a semantic fieldset");
assert(dashboardSource.slice(aiFieldsetStart, aiFieldsetEnd).includes(" disabled"), "AI provider fields must start locked before permission state hydrates");
assert(dashboardSource.slice(aiFieldsetStart, aiFieldsetEnd).includes(" hidden"), "AI provider fields must stay hidden before permission state hydrates");
assert(dashboardSource.slice(aiFieldsetStart, aiFieldsetEnd).includes('aria-describedby="aiFormAccessStatus"'), "locked AI fields must reference the live setup status");
const aiPermissionControllerSource = await fs.readFile(path.join(root, "assets", "client", "ai-permission-controller.mjs"), "utf8");
assert(aiPermissionControllerSource.includes("els.aiProviderFields.hidden = !aiSetupState.formUnlocked"), "AI provider fields must become visible only after the current provider origin is authorized");
assert(dashboardSource.includes('id="aiFormAccessStatus" data-stage="needs-consent" aria-live="polite" hidden'),
  "the initial AI consent stage must not reserve a redundant visible status row");
assert(aiPermissionControllerSource.includes("els.aiFormAccessStatus.hidden = !statusKey")
  && !aiPermissionControllerSource.includes("settings.service.aiFormNeedsConsent"),
"the consent stage must stay visually silent while actionable AI setup states remain available");
assert(dashboardSource.indexOf('id="apiBaseUrlInput"') < aiFieldsetStart, "the provider URL must remain available before the gated AI fields");
assert(dashboardSource.indexOf('id="clearKey"') < aiFieldsetStart, "credential removal must remain available outside the gated AI fields");
assert(dashboardSource.indexOf('id="testKey"') < dashboardSource.indexOf('id="clearKey"'), "connection testing must sit immediately before credential removal in the visible provider actions");
assert(aiPermissionControllerSource.includes("els.testKey.disabled = busy || !readyToTest"), "connection testing outside the gated fieldset must require an authorized provider, credential policy, and model");
assert(dashboardSource.indexOf('id="grantBraveOrigin"') > aiFieldsetEnd, "Brave authorization must remain independent of the AI provider gate");
assert(dashboardSource.includes('id="imageSearchStrategy" hidden')
  && settingsControllerSource.includes("els.imageSearchStrategy.hidden = !els.webImageSearchEnabledInput.checked"),
"fallback image-search credentials must collapse when image search is disabled and stay independent from conversational web search");

for (const file of ["assets/client/api.mjs", "assets/client/extension-ui.mjs"]) {
  const text = await fs.readFile(path.join(root, file), "utf8");
  assert(!/[\u3400-\u9fff]/u.test(text), `${file} must not hardcode Chinese UI copy`);
}

for (const file of ["extension/service-worker.mjs", "extension/core/feed.mjs", "extension/core/secrets.mjs", "extension/core/db.mjs"]) {
  const text = await fs.readFile(path.join(root, file), "utf8");
  for (const match of text.matchAll(/["'](background\.[\w.]+)["']/g)) {
    assert(localeKeys.includes(match[1]), `${file} background translation key must exist: ${match[1]}`);
  }
}

const docsLogoSource = await fs.readFile(path.join(root, "docs", "assets", "ampira-logo.svg"), "utf8");
const extensionLogoSource = await fs.readFile(path.join(root, "assets", "icons", "ampira-logo.svg"), "utf8");
assert.equal(docsLogoSource, extensionLogoSource, "the website must reuse the packaged Ampira logo");
const docsStylesSource = await fs.readFile(path.join(root, "docs", "styles.css"), "utf8");
assert(
  docsStylesSource.includes("min-height: 44px")
    && docsStylesSource.includes(".store-link:focus-visible"),
  "the website store link must retain its minimum target size and visible keyboard focus",
);
const chromeWebStoreUrl = "https://chromewebstore.google.com/detail/oifmohbnghkaadoeghlemkllegajdajc?utm_source=item-share-cb";
for (const [file, expectedLang, locale, tagline, summary, logoPath, storeLabel] of [
  ["docs/index.html", "zh-CN", "zh-CN", reviewedBrandTaglines["zh-CN"], storeSummaries[1], "assets/ampira-logo.svg", "从 Chrome 应用商店安装"],
  ["docs/en/index.html", "en", "en", reviewedBrandTaglines.en, storeSummaries[0], "../assets/ampira-logo.svg", "Install from the Chrome Web Store"],
  ["docs/zh-TW/index.html", "zh-Hant", "zh-Hant", reviewedBrandTaglines["zh-Hant"], storeSummaries[2], "../assets/ampira-logo.svg", "從 Chrome 線上應用程式商店安裝"],
]) {
  const text = await fs.readFile(path.join(root, file), "utf8");
  assert(text.includes(`<html lang="${expectedLang}">`), `${file} must declare ${expectedLang}`);
  const docsLogoReference = text.match(/<img class="mark-logo" src="([^"]+)" width="48" height="48" alt="Ampira">/)?.[1];
  assert.equal(docsLogoReference?.split(/[?#]/, 1)[0], logoPath, `${file} must show the packaged Ampira logo`);
  assert(text.includes(`<a class="store-link" href="${chromeWebStoreUrl}" target="_blank" rel="noopener noreferrer">${storeLabel}`), `${file} must show the localized Chrome Web Store link`);
  assert(text.includes(`<h1>${tagline}</h1>`), `${file} must use the reviewed brand tagline`);
  assert(text.includes(`<meta name="description" content="${summary}">`), `${file} must use the reviewed localized summary`);
  assert(text.includes(`<p>${reviewedProfessionalUseCases[locale]}</p>`), `${file} must include the reviewed current professional use case`);
  assert(!futureMarketingPattern.test(text), `${file} must not promise paid or future features`);
  for (const hreflang of ["zh-CN", "zh-TW", "en"]) assert(text.includes(`hreflang="${hreflang}"`), `${file} must link ${hreflang}`);
}

const readmeSource = await fs.readFile(path.join(root, "README.md"), "utf8");
for (const tagline of Object.values(reviewedBrandTaglines)) {
  assert(readmeSource.includes(`> ${tagline}`), `README must include the reviewed localized tagline: ${tagline}`);
}
for (const useCase of Object.values(reviewedProfessionalUseCases)) {
  assert(readmeSource.includes(useCase), `README must include the reviewed current professional use case: ${useCase}`);
}
for (const storeLabel of ["Chrome 应用商店", "Chrome 線上應用程式商店", "Chrome Web Store"]) {
  assert(readmeSource.includes(`[${storeLabel}](${chromeWebStoreUrl})`), `README must include the localized Chrome Web Store link: ${storeLabel}`);
}
assert(!futureMarketingPattern.test(readmeSource), "README must not promise paid or future features");

const copyGuidelinesSource = await fs.readFile(path.join(root, "copy-guidelines.md"), "utf8");
for (const copy of [
  ...Object.values(reviewedBrandTaglines),
  ...Object.values(reviewedAiServiceTitles),
  ...Object.values(reviewedOnboardingTitles),
  ...Object.values(reviewedPainOpenings),
  ...Object.values(reviewedProfessionalUseCases),
  ...manifestDescriptions,
  ...storeSummaries,
]) {
  assert(copyGuidelinesSource.includes(copy), `copy guidelines must include the reviewed copy: ${copy}`);
}
assert(copyGuidelinesSource.includes(chromeWebStoreUrl), "copy guidelines must include the current Chrome Web Store URL");

return { dashboardSource, localeKeys };
}

async function listModuleFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return listModuleFiles(absolute);
    return entry.name.endsWith(".mjs") ? [absolute] : [];
  }));
  return nested.flat();
}

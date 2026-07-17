import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_SETTINGS } from "../../extension/core/constants.mjs";
import { textLength, truncateText } from "../../assets/client/text.mjs";
import { cleanGeneratedSummaryLine, extractGeneratedSummaryTitle, hasStructuralSummaryPrefix, limitGeneratedSummaryLines, normalizeSummaryMarkup, parseGeneratedDailyDigest } from "../../extension/core/summary-text.mjs";
import { cleanAiAnswerMarkup, extractDirectAnswer, parseAiAnswer } from "../../assets/client/ai-answer-format.mjs";
import {
  exactPermissionOrigins, newlyRequiredUngrantedOrigins, permissionRowCounts, requiredUngrantedOrigins,
} from "../../assets/client/permission-ui-model.mjs";
import {
  DEFAULT_LOCALE, SUPPORTED_LOCALES, defaultBookmarkFoldersForLocale,
  detectSupportedLocale, formatListForLocale, localeMessages, normalizeLocale,
  translate, translateCount,
} from "../../extension/core/i18n.mjs";

export async function runManifestSecurityTests(root) {
const manifest = JSON.parse(await fs.readFile(path.join(root, "manifest.json"), "utf8"));
const dashboardHtml = await fs.readFile(path.join(root, "dashboard.html"), "utf8");
const shellControllerSource = await fs.readFile(path.join(root, "assets", "client", "shell-controller.mjs"), "utf8");
const settingsWorkflowSource = await fs.readFile(path.join(root, "extension", "runtime", "settings-workflow.mjs"), "utf8");
const aiSearchRuntimeSource = await fs.readFile(path.join(root, "extension", "runtime", "ai-search-service.mjs"), "utf8");
const refreshRuntimeSource = await fs.readFile(path.join(root, "extension", "runtime", "refresh-service.mjs"), "utf8");
const extensionRuntimeSource = await fs.readFile(path.join(root, "extension", "runtime", "extension-runtime.mjs"), "utf8");
const dashboardContentRuntimeSource = await fs.readFile(path.join(root, "extension", "runtime", "dashboard-content-service.mjs"), "utf8");

assert.equal(manifest.manifest_version, 3);
assert(dashboardHtml.includes('<span class="about-version" id="aboutVersion"></span>'), "the About panel must reserve a version output without hard-coding a release");
const versionDashboardAppSource = await fs.readFile(path.join(root, "assets", "client", "dashboard-app.mjs"), "utf8");
assert(versionDashboardAppSource.includes("chrome?.runtime?.getManifest?.().version")
  && versionDashboardAppSource.includes('new URL("../../manifest.json", import.meta.url)')
  && versionDashboardAppSource.includes("els.aboutVersion.textContent = `v${appVersion}`"), "the About panel version must come from the runtime manifest with a local-preview manifest fallback");
assert(!dashboardHtml.includes(manifest.version), "dashboard HTML must not hard-code the manifest version");
assert.equal(manifest.chrome_url_overrides.newtab, "dashboard.html");
assert.equal(manifest.action.default_popup, "action-popup.html", "the toolbar action must open a visible capture confirmation popup");
assert.deepEqual(manifest.permissions.sort(), ["activeTab", "alarms", "bookmarks", "storage"]);
assert.deepEqual([...(manifest.optional_permissions || [])].sort(), ["favicon", "search"], "website icons and browser search must use optional named permissions so upgrades do not disable existing installs");
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
const actionPopupCss = await fs.readFile(path.join(root, "assets/styles/action-popup.css"), "utf8");
assert(actionPopupHtml.includes('role="status"') && actionPopupHtml.includes('aria-live="polite"'), "the capture popup must announce its result accessibly");
assert(actionPopupHtml.includes('src="assets/client/action-popup.mjs"'), "the capture popup must execute only its packaged module");
assert(actionPopupSource.includes("chrome.tabs.query({ active: true, currentWindow: true })"), "the popup must read only the actively invoked tab");
assert(actionPopupSource.includes('sendExtensionRequest({ type: "settings:get" })'), "the popup must follow Ampira's saved locale and color mode");
assert(actionPopupSource.includes('type: "reading-queue:capture-current"'), "the popup must route captures through the service worker");
assert(actionPopupSource.includes('import { createThemedIcon } from "./icons.mjs"') && actionPopupSource.includes('icon: "check"') && actionPopupSource.includes('icon: "info-circle"'), "popup controls and states must use the shared local icon library");
assert(actionPopupSource.includes("textContent") && !actionPopupSource.includes("innerHTML"), "captured page metadata must remain inert text");
assert(actionPopupCss.includes("--popup-warning: #F4C95D") && !actionPopupCss.includes("var(--red)"), "popup warnings must use the reviewed amber state instead of red");

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
assert(translate("en", "settings.service.consent").includes("article URLs used for context"), "the prominent AI disclosure must include context article URLs");
assert(translate("zh-CN", "settings.service.consent").includes("文章网址"), "the Chinese AI disclosure must include context article URLs");
assert.equal(translate("en", "onboarding.step4.searchTitle"), "Content insights", "English onboarding must describe the content interpretation capability concisely");
assert.equal(translate("zh-CN", "onboarding.step4.searchTitle"), "内容解读", "Chinese onboarding must retain the concise content interpretation label");
assert.equal(translate("zh-CN", "onboarding.step1.body"), "把资讯和灵感整理进一个新标签页。", "onboarding must use the reviewed concise product introduction");
assert.equal(translateCount("en", "unit.entries", 1), "1 entry");
assert.equal(translateCount("en", "unit.entries", 2), "2 entries");
assert.equal(formatListForLocale("en", ["News", "Design"]), "News and Design");
assert.deepEqual(defaultBookmarkFoldersForLocale("en"), { news: "News", inspiration: "Inspiration" });
assert.deepEqual(defaultBookmarkFoldersForLocale("zh-Hant"), { news: "資訊", inspiration: "審美" });
assert.equal(translate("en", "settings.bookmarks.folderOption", { name: "Design", count: 5 }), "Design (5)");
assert.equal(DEFAULT_SETTINGS.newsBookmarkFolder, "");
assert.equal(DEFAULT_SETTINGS.inspirationBookmarkFolder, "");
assert.equal(DEFAULT_SETTINGS.colorMode, "dark", "appearance must default to dark mode");
assert.equal(DEFAULT_SETTINGS.headerImageEnabled, true, "the header image must be enabled by default");
assert.equal(DEFAULT_SETTINGS.headerImageBlurEnabled, false, "header-image blur must be opt-in");
assert.equal(DEFAULT_SETTINGS.headerImageBlurAmount, 12, "header-image blur must remember a useful default amount");
assert.equal(DEFAULT_SETTINGS.headerImageHeightScale, 100, "header-image height must preserve the existing responsive default");
assert.equal(DEFAULT_SETTINGS.bookmarkSectionEnabled, true, "bookmark navigation and the main bookmark section must remain enabled by default");
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
  extractDirectAnswer("直接回答：你好，需要我帮你找什么？\n本地依据：没有匹配内容。\n补充判断：这是社交性开场。\n建议动作：等待用户继续输入。"),
  "你好，需要我帮你找什么？",
  "dashboard questions must expose only the user-facing answer from legacy structured responses",
);
assert.equal(DEFAULT_SETTINGS.floatingWebOpenEnabled, false, "in-app reading must be opt-in by default");
assert.equal(DEFAULT_SETTINGS.retainSeenArchive, true, "viewed items must remain archived by default");
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
for (const locale of SUPPORTED_LOCALES) {
  const messages = localeMessages(locale);
  assert.deepEqual(Object.keys(messages).sort(), localeKeys, `${locale} catalog keys must match ${DEFAULT_LOCALE}`);
  for (const key of localeKeys) {
    const expected = [...String(defaultMessages[key]).matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((match) => match[1]).sort();
    const actual = [...String(messages[key]).matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((match) => match[1]).sort();
    assert.deepEqual(actual, expected, `${locale} placeholders must match ${DEFAULT_LOCALE} for ${key}`);
  }
}
for (const file of ["en.mjs", "zh-CN.mjs", "zh-Hant.mjs"]) {
  const source = await fs.readFile(path.join(root, "assets", "client", "locales", file), "utf8");
  const declaredKeys = [...source.matchAll(/^\s*"([^"]+)"\s*:/gm)].map((match) => match[1]);
  assert.equal(new Set(declaredKeys).size, declaredKeys.length, `${file} must not declare duplicate translation keys`);
}

const manifestMessageKeys = [];
for (const locale of ["en", "zh_CN", "zh_TW"]) {
  const rawMessages = await fs.readFile(path.join(root, "_locales", locale, "messages.json"), "utf8");
  const declaredKeys = [...rawMessages.matchAll(/^\s{2}"([^"]+)"\s*:/gm)].map((match) => match[1]);
  assert.equal(new Set(declaredKeys).size, declaredKeys.length, `${locale} manifest messages must not declare duplicate keys`);
  const messages = JSON.parse(rawMessages);
  const keys = Object.keys(messages).sort();
  if (!manifestMessageKeys.length) manifestMessageKeys.push(...keys);
  assert.deepEqual(keys, manifestMessageKeys, `${locale} manifest messages must have matching keys`);
}

const dashboardSource = await fs.readFile(path.join(root, "dashboard.html"), "utf8");
const settingsCssSource = await fs.readFile(path.join(root, "assets", "styles", "settings.css"), "utf8");
const tokensCssSource = await fs.readFile(path.join(root, "assets", "styles", "tokens.css"), "utf8");
const settingsResponsiveCssSource = await fs.readFile(path.join(root, "assets", "styles", "motion-responsive.css"), "utf8");
const dashboardSectionsCssSource = await fs.readFile(path.join(root, "assets", "styles", "dashboard-sections.css"), "utf8");
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
assert.equal(settingsTabNames.length, 7, "settings must retain the seven existing sections");
for (const id of [
  "sourceCoverageDetails", "cacheAdvancedDetails", "cacheMaintenanceDetails",
  "bookmarkExtraDetails", "bookmarkHiddenDetails", "sourcePermissionDetails", "exclusionDetails",
  "sourceSuggestionDetails", "settingsTransferDetails",
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
assert(quotaStatusIndex > 0 && quotaStatusIndex < cacheStatusIndex && cacheStatusIndex < autoStatusIndex, "AI settings must keep quota, cache, and automatic organization visible in one ordered status band");
assert(!settingsCssSource.includes(".settings-overview .settings-overview-item + .settings-overview-item")
  && settingsResponsiveCssSource.includes("border-block-start: 1px solid var(--line-faint)"), "the runtime status band must omit desktop column separators while retaining narrow-screen row separators");
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
const servicePanelStart = dashboardSource.indexOf('<div class="settings-panel active" data-settings-panel="service">');
const cachePanelStart = dashboardSource.indexOf('<div class="settings-panel" data-settings-panel="cache">');
const servicePanelSource = dashboardSource.slice(servicePanelStart, cachePanelStart);
assert(servicePanelSource.includes('id="settingsOverviewTitle"'), "the AI runtime overview must live inside the AI settings panel");
assert(!dashboardSource.slice(0, servicePanelStart).includes('id="settingsOverviewTitle"'), "the AI runtime overview must not remain global above every settings panel");
const browserPanelStart = dashboardSource.indexOf('<div class="settings-panel" data-settings-panel="browser">');
const exclusionsPanelStart = dashboardSource.indexOf('<div class="settings-panel" data-settings-panel="exclusions">');
const browserPanelSource = dashboardSource.slice(browserPanelStart, exclusionsPanelStart);
const bookmarksPanelStart = dashboardSource.indexOf('<div class="settings-panel" data-settings-panel="bookmarks">');
const appearancePanelStart = dashboardSource.indexOf('<div class="settings-panel" data-settings-panel="appearance">');
const aboutPanelStart = dashboardSource.indexOf('<div class="settings-panel" data-settings-panel="about">');
const settingsFooterStart = dashboardSource.indexOf('<div class="modal-actions">', aboutPanelStart);
const bookmarksPanelSource = dashboardSource.slice(bookmarksPanelStart, appearancePanelStart);
const cacheFetchStart = dashboardSource.indexOf('aria-labelledby="cacheFetchTitle"');
const sourceCoverageStart = dashboardSource.indexOf('aria-labelledby="sourceCoverageTitle"');
const cacheAdvancedStart = dashboardSource.indexOf('aria-labelledby="cacheAdvancedTitle"');
const cacheMaintenanceStart = dashboardSource.indexOf('aria-labelledby="cacheMaintenanceTitle"');
const cacheFetchSource = dashboardSource.slice(cacheFetchStart, sourceCoverageStart);
const cacheAdvancedSource = dashboardSource.slice(cacheAdvancedStart, cacheMaintenanceStart);
assert(!/<input[^>]+(?:id|name)="[^"]*(?:new.?tab|override)[^"]*"/i.test(browserPanelSource), "browser integration must not expose a fake writable new-tab toggle");
assert(bookmarksPanelSource.includes('<input id="bookmarkSectionEnabledInput" type="checkbox" checked>'), "bookmark settings must expose an enabled-by-default home-section switch");
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
  && shellControllerSource.includes("document.getElementById(button.dataset.scroll)?.hidden !== true"), "hidden bookmark surfaces must be removed from navigation sizing and scroll selection");
assert(shellControllerSource.includes("maxLabelWidth + 16"), "expanded navigation width must leave a language-safe label inset");
assert(!shellControllerSource.includes('    ".nav-btn",'), "navigation must not remain registered for the removed pointer glow");
assert(settingsWorkflowSource.includes('"bookmarkSectionEnabled", "websiteShortcutsEnabled"'), "the runtime settings workflow must accept bookmark-section visibility without treating it as a source change");
assert(!cacheFetchSource.includes('id="personalizedRankingEnabledInput"'), "fetch settings must not expose the advanced personalization switch");
assert(cacheAdvancedSource.includes('<input id="personalizedRankingEnabledInput" type="checkbox">'), "advanced settings must expose personalized ranking with an unchecked first-frame default");
assert(cacheAdvancedSource.indexOf('id="newsPerCategoryInput"') < cacheAdvancedSource.indexOf('id="readingQueueOpenOnReadAllInput"')
  && cacheAdvancedSource.indexOf('id="readingQueueOpenOnReadAllInput"') < cacheAdvancedSource.indexOf('id="personalizedRankingEnabledInput"'), "advanced switches must follow the three numeric settings");
assert(dashboardSource.includes('id="sourcePermissionSummary"'), "website access must expose a visible settings-page status");
assert(dashboardSource.includes('id="sourceCoverageSummary"') && dashboardSource.includes('id="sourceCoverageList"'), "news settings must expose source coverage and per-source diagnostics");
assert(!dashboardSource.includes('id="sourceCoverageStatus"') && !dashboardSource.includes('id="bookmarkSourceStatus"'), "settings must not repeat source summaries beside the controls that already show them");
assert(!dashboardSource.includes("IndexedDB") && !dashboardSource.includes("Manifest V3"), "settings and onboarding must not expose storage or extension implementation details");
assert(dashboardSource.includes('data-i18n="settings.cache.clearHelp"')
  && dashboardSource.includes('data-i18n="settings.bookmarks.inspirationFolderHelp"')
  && dashboardSource.includes('data-i18n="settings.sync.security"'), "copy cleanup must retain cache, bookmark, and secret-storage consequences");
const sourceCoverageControllerSource = await fs.readFile(path.join(root, "assets", "client", "source-coverage-controller.mjs"), "utf8");
assert(!sourceCoverageControllerSource.includes("settings.sources.method."), "source status rows must not expose internal extraction methods");
assert(sourceCoverageControllerSource.includes("await requestOrigins([pattern])"), "cross-origin Feed discovery must require a direct user-gesture permission request through the shared permission client");
assert(sourceCoverageControllerSource.includes('apiPost("/api/feed/source/refresh", { sourceKey })'), "source diagnostics must support a scoped source retry");
const refreshServiceSource = await fs.readFile(path.join(root, "extension", "runtime", "refresh-service.mjs"), "utf8");
assert(/return\s*\{[\s\S]{0,160}\brefreshSource\b/.test(refreshServiceSource), "the refresh service factory must expose the scoped source refresh route");
assert.equal((dashboardSource.match(/class="ai-service-group"/g) || []).length, 3, "AI settings must separate provider configuration, optional image search, and top search without adding a second Feed permission path");
assert(!dashboardSource.includes('id="aiFeedAccessGroup"') && !dashboardSource.includes('id="grantAiFeedOrigins"'), "cross-language Feed domains must use the existing initial source-permission flow");
assert(dashboardSource.includes('class="credential-panel ai-image-layout"') && dashboardSource.includes('class="ai-image-actions"'), "optional image-search controls must use a grouped credential layout with responsive actions");
assert(!dashboardSource.includes('id="refreshPermissionStatus"'), "website access must sync automatically without a no-op refresh button");
assert(dashboardSource.includes('id="toggleFaviconPermission"'), "existing users must be able to manage the optional favicon permission in settings");
assert(dashboardSource.includes('id="toggleBrowserSearchPermission"'), "browser search must be explicitly manageable from AI settings");
assert(!dashboardSource.includes('data-permission="favicon"'), "onboarding must not duplicate the favicon permission action beside the combined primary action");
assert.equal((dashboardSource.match(/data-onboarding-step="\d"/g) || []).length, 4, "onboarding must use the four-step product, folder, permission, and AI setup flow");
assert.equal((dashboardSource.match(/<div class="onboarding-progress"[\s\S]*?<\/div>/)?.[0].match(/<span/g) || []).length, 4, "onboarding progress must expose four visual steps");
assert(dashboardSource.includes('data-i18n="onboarding.step1.body"')
  && !dashboardSource.includes('class="onboarding-step-icon"')
  && !dashboardSource.includes('class="onboarding-feature-copy"'), "onboarding must keep the simplified copy-first presentation without decorative feature cards");
assert(dashboardSource.includes('id="onboardingNewsFolder"') && dashboardSource.includes('id="onboardingInspirationFolder"'), "onboarding must let users choose bookmark folders in place");
assert(dashboardSource.includes('id="inspirationBookmarkFolderSelect"'), "settings must keep inspiration source selection inside the compact folder row");
assert(!dashboardSource.includes('id="inspirationSourceModeGroup"') && !dashboardSource.includes('id="onboardingInspirationSourceMode"'), "settings and onboarding must not restore the large inspiration-source card selectors");
assert(!dashboardSource.includes('name="inspirationSourceMode"') && !dashboardSource.includes('name="onboardingInspirationSource"'), "inspiration mode must be represented by the folder selects rather than parallel radio groups");
assert(dashboardSource.indexOf('id="onboardingNewsFolder"') < dashboardSource.indexOf('id="onboardingGrantSources"'), "folder selection must precede exact-origin permission calculation");
assert(dashboardSource.indexOf('id="onboardingGrantSources"') < dashboardSource.indexOf('id="onboardingConfigureAi"'), "website access must precede the optional AI setup handoff");
assert(!dashboardSource.includes('id="onboardingApiKey"') && !dashboardSource.includes('id="finishOnboarding"'), "AI credentials and redundant completion controls must stay out of onboarding");
assert(dashboardSource.includes('id="onboardingSkipFolders"') && dashboardSource.includes('id="onboardingSkipPermissions"'), "folder selection and optional website access must both remain skippable");
assert(dashboardSource.includes('id="onboardingConfigureAi"') && dashboardSource.includes('id="onboardingSkipAi"'), "the final AI step must support immediate or deferred setup");
assert(dashboardSource.includes('id="onboardingAiStatus" aria-live="polite"'), "AI setup completion failures must have a visible live status region");
assert.equal((dashboardSource.match(/data-i18n="onboarding\.step4\.(?:localization|digest|summary|search)Title"/g) || []).length, 4, "onboarding must explain the four reviewed AI capabilities");
const permissionUiSource = await fs.readFile(path.join(root, "assets", "client", "extension-ui.mjs"), "utf8");
assert(permissionUiSource.includes('requestPermissions(["search"])')
  && permissionUiSource.includes('removePermissions(["search"])'), "browser search must be enabled and revoked only through the optional-permission control");
assert(!permissionUiSource.includes('createIcon("key-01", "source-permission-icon")'), "website permission rows must not repeat the section key icon for every origin");
assert(permissionUiSource.includes("newsSourceMode,")
  && permissionUiSource.includes("inspirationSourceMode,"), "onboarding news and inspiration source choices must persist through the settings boundary");
assert(permissionUiSource.includes('publicFeedSupplementEnabled: newsSourceMode === "public"'),
  "onboarding must disable Public Feed coverage when a new user selects a personal news folder");
assert(permissionUiSource.includes('INSPIRATION_PRESET_VALUE') && permissionUiSource.includes('inspirationBookmarkValue(item.name)'), "onboarding must build the fixed preset option before encoded personal-folder options");
const bookmarkSettingsSource = await fs.readFile(path.join(root, "assets", "client", "bookmark-settings-controller.mjs"), "utf8");
const bookmarksViewSource = await fs.readFile(path.join(root, "assets", "client", "bookmarks-view.mjs"), "utf8");
assert(bookmarksViewSource.includes('emptyKind === "noEntries" ? t("action.openSettings") : ""')
  && bookmarksViewSource.includes("hasAction ? openBookmarkSettings : undefined"), "an empty bookmark index must guide the user directly to Bookmark settings");
assert(bookmarkSettingsSource.includes('const optionNodes = [createFolderOption(INSPIRATION_PRESET_VALUE'), "settings must place the Ampira preset first in the inspiration folder select");
assert(permissionUiSource.includes('const optionNodes = [createOption(PUBLIC_FEED_VALUE')
  && bookmarkSettingsSource.includes('const optionNodes = [createFolderOption(PUBLIC_FEED_VALUE'), "onboarding and settings must place Public Feed first in the news source select");
assert(bookmarkSettingsSource.includes('t("settings.bookmarks.notFound"'), "settings must retain a visible missing option for a removed personal folder");
assert(!permissionUiSource.includes('request("settings:save", { openaiApiKey, aiDisclosureAccepted: true })'), "AI credentials must be configured progressively from Settings rather than onboarding");
assert(permissionUiSource.includes('permissions: nativeFaviconSupported ? ["favicon"] : []'), "the onboarding primary action must request website icons only where the browser supports its native favicon service");
assert(permissionUiSource.includes('nativeFaviconSupported ? "onboarding.step2.grant" : "onboarding.step2.grantSites"'), "onboarding must not promise website icons on browsers that do not support the native favicon service");
assert(permissionUiSource.includes('microsoftEdge ? "edge://extensions/"'), "the extension manager action must use Edge's internal management page in Microsoft Edge");
assert(permissionUiSource.includes('writeValue(ONBOARDING_PROGRESS_KEY, "permissions")'), "onboarding must resume at the permission step after folder activation");
assert(permissionUiSource.includes('writeValue(ONBOARDING_PROGRESS_KEY, "ai")')
  && permissionUiSource.includes('progress === "ai"'), "onboarding must persist and restore the final AI step");
assert(permissionUiSource.includes('onGranted: showOnboardingAi')
  && permissionUiSource.includes('els.skipPermissions?.addEventListener("click", showOnboardingAi)'), "granting or skipping website access must advance to AI setup without completing onboarding");
assert(permissionUiSource.includes('request("onboarding:complete")')
  && permissionUiSource.includes('{ openAiSettings: true }'), "only the final AI actions may complete onboarding and optionally hand off to settings");
assert(permissionUiSource.includes('targetUrl.searchParams.set("open", "ai-settings")')
  && permissionUiSource.includes("setOnboardingCompletionBusy(true)"), "AI setup handoff must be one-shot and prevent duplicate completion requests");
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
assert(dashboardSource.indexOf('id="apiBaseUrlInput"') < aiFieldsetStart, "the provider URL must remain available before the gated AI fields");
assert(dashboardSource.indexOf('id="clearKey"') < aiFieldsetStart, "credential removal must remain available outside the gated AI fields");
assert(dashboardSource.indexOf('id="testKey"') < dashboardSource.indexOf('id="clearKey"'), "connection testing must sit immediately before credential removal in the visible provider actions");
assert(aiPermissionControllerSource.includes("els.testKey.disabled = busy || !readyToTest"), "connection testing outside the gated fieldset must require an authorized provider, credential policy, and model");
assert(dashboardSource.indexOf('id="grantBraveOrigin"') > aiFieldsetEnd, "Brave authorization must remain independent of the AI provider gate");

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

for (const [file, expectedLang] of [
  ["docs/index.html", "zh-CN"],
  ["docs/en/index.html", "en"],
  ["docs/zh-TW/index.html", "zh-Hant"],
]) {
  const text = await fs.readFile(path.join(root, file), "utf8");
  assert(text.includes(`<html lang="${expectedLang}">`), `${file} must declare ${expectedLang}`);
  for (const hreflang of ["zh-CN", "zh-TW", "en"]) assert(text.includes(`hreflang="${hreflang}"`), `${file} must link ${hreflang}`);
}

return { dashboardSource, localeKeys };
}

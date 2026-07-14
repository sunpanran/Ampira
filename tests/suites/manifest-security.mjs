import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_SETTINGS } from "../../extension/core/constants.mjs";
import { textLength, truncateText } from "../../assets/client/text.mjs";
import { CARD_SUMMARY_POLICY_VERSION, cleanGeneratedSummaryLine, extractGeneratedSummaryTitle, hasStructuralSummaryPrefix, limitGeneratedSummaryLines, normalizeSummaryMarkup, parseGeneratedDailyDigest } from "../../extension/core/summary-text.mjs";
import { cleanAiAnswerMarkup, extractDirectAnswer, parseAiAnswer } from "../../assets/client/ai-answer-format.mjs";
import { permissionRowCounts, requiredUngrantedOrigins } from "../../assets/client/permission-ui-model.mjs";
import {
  DEFAULT_LOCALE, SUPPORTED_LOCALES, defaultBookmarkFoldersForLocale,
  detectSupportedLocale, formatListForLocale, localeMessages, normalizeLocale,
  translate, translateCount,
} from "../../extension/core/i18n.mjs";

export async function runManifestSecurityTests(root) {
const manifest = JSON.parse(await fs.readFile(path.join(root, "manifest.json"), "utf8"));

assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.chrome_url_overrides.newtab, "dashboard.html");
assert.deepEqual(manifest.permissions.sort(), ["alarms", "bookmarks", "storage"]);
assert.deepEqual([...(manifest.optional_permissions || [])].sort(), ["favicon"], "website icons must use an optional named permission so upgrades do not disable existing installs");
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
assert(translate("en", "settings.service.consent").includes("article URLs used for context"), "the prominent AI disclosure must include context article URLs");
assert(translate("zh-CN", "settings.service.consent").includes("文章网址"), "the Chinese AI disclosure must include context article URLs");
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
assert.equal(CARD_SUMMARY_POLICY_VERSION, 2);
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

const permissionUiRows = [
  { origin: "https://allowed.example/*", required: true, granted: true },
  { origin: "https://pending.example/*", required: true, granted: false },
  { origin: "https://legacy.example/*", required: false, granted: true, legacy: true },
];
assert.deepEqual(permissionRowCounts(permissionUiRows), {
  required: 2,
  granted: 1,
  pending: 1,
  legacy: 1,
  broadRequired: 0,
});
assert.deepEqual(requiredUngrantedOrigins(permissionUiRows), ["https://pending.example/*"]);
assert.equal(permissionRowCounts(permissionUiRows.map((row) => ({ ...row, granted: true }))).pending, 0, "fully granted rows must not leave an active bulk action");
assert.equal(permissionRowCounts(permissionUiRows.filter((row) => row.legacy)).pending, 0, "legacy-only rows must not enable bulk authorization");

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
const dashboardIds = [...dashboardSource.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
for (const id of [
  "settingsOverviewTitle",
  "settingsStatus",
  "apiBaseUrlInput",
  "apiKeyInput",
  "sourcePermissionSummary",
  "headerImageBlurEnabledInput",
  "headerImageBlurAmountInput",
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
assert(!/<input[^>]+(?:id|name)="[^"]*(?:new.?tab|override)[^"]*"/i.test(browserPanelSource), "browser integration must not expose a fake writable new-tab toggle");
assert(browserPanelSource.includes('id="websiteShortcutsEnabledInput"'), "browser settings must expose the website-shortcut module switch explicitly");
assert(dashboardSource.includes('id="sourcePermissionSummary"'), "website access must expose a visible settings-page status");
assert(dashboardSource.includes('id="sourceCoverageSummary"') && dashboardSource.includes('id="sourceCoverageList"'), "news settings must expose source coverage and per-source diagnostics");
const sourceCoverageControllerSource = await fs.readFile(path.join(root, "assets", "client", "source-coverage-controller.mjs"), "utf8");
assert(sourceCoverageControllerSource.includes('chrome.permissions.request({ origins: [pattern] })'), "cross-origin Feed discovery must require a direct user-gesture permission request");
assert(sourceCoverageControllerSource.includes('apiPost("/api/feed/source/refresh", { sourceKey })'), "source diagnostics must support a scoped source retry");
const refreshServiceSource = await fs.readFile(path.join(root, "extension", "runtime", "refresh-service.mjs"), "utf8");
assert(/return\s*\{[\s\S]{0,160}\brefreshSource\b/.test(refreshServiceSource), "the refresh service factory must expose the scoped source refresh route");
assert.equal((dashboardSource.match(/class="ai-service-group"/g) || []).length, 2, "AI settings must separate provider configuration from optional image search");
assert(dashboardSource.includes('class="ai-image-layout"') && dashboardSource.includes('class="ai-image-controls"'), "optional image-search controls must have a dedicated responsive layout");
assert(!dashboardSource.includes('id="refreshPermissionStatus"'), "website access must sync automatically without a no-op refresh button");
assert(dashboardSource.includes('id="toggleFaviconPermission"'), "existing users must be able to manage the optional favicon permission in settings");
assert(!dashboardSource.includes('data-permission="favicon"'), "onboarding must not duplicate the favicon permission action beside the combined primary action");
assert.equal((dashboardSource.match(/data-onboarding-step="\d"/g) || []).length, 3, "onboarding must use the three-step product, folder, and permission activation flow");
assert(dashboardSource.includes('id="onboardingNewsFolder"') && dashboardSource.includes('id="onboardingInspirationFolder"'), "onboarding must let users choose bookmark folders in place");
assert(dashboardSource.indexOf('id="onboardingNewsFolder"') < dashboardSource.indexOf('id="onboardingGrantSources"'), "folder selection must precede exact-origin permission calculation");
assert(!dashboardSource.includes('id="onboardingApiKey"') && !dashboardSource.includes('id="finishOnboarding"'), "AI credentials and the redundant summary screen must stay out of onboarding");
assert(dashboardSource.includes('id="onboardingSkipFolders"') && dashboardSource.includes('id="onboardingSkipPermissions"'), "folder selection and optional website access must both remain skippable");
const permissionUiSource = await fs.readFile(path.join(root, "assets", "client", "extension-ui.mjs"), "utf8");
assert(permissionUiSource.includes('request("settings:save", { newsBookmarkFolder, inspirationBookmarkFolder })'), "onboarding folder choices must persist through the settings boundary");
assert(!permissionUiSource.includes('request("settings:save", { openaiApiKey, aiDisclosureAccepted: true })'), "AI credentials must be configured progressively from Settings rather than onboarding");
assert(permissionUiSource.includes('permissions: ["favicon"]'), "the onboarding primary permission action must also request website icons from its user gesture");
assert(permissionUiSource.includes('writeValue(ONBOARDING_PROGRESS_KEY, "permissions")'), "onboarding must resume at the final permission step after folder activation");
assert(permissionUiSource.includes('request("onboarding:complete")'), "granting or skipping optional access must complete onboarding without a separate summary screen");
assert(permissionUiSource.includes('finish: true'), "the primary permission action must finish activation after a successful Chrome grant");
assert(permissionUiSource.includes('event.detail?.type === "settings.changed"'), "website access must react to extension permission updates");
assert(permissionUiSource.includes('"visibilitychange"'), "website access must recheck when the page becomes visible");
const aiFieldsetStart = dashboardSource.indexOf('<fieldset class="ai-provider-fields"');
const aiFieldsetEnd = dashboardSource.indexOf("</fieldset>", aiFieldsetStart);
assert(aiFieldsetStart > 0 && aiFieldsetEnd > aiFieldsetStart, "AI provider controls must use a semantic fieldset");
assert(dashboardSource.slice(aiFieldsetStart, aiFieldsetEnd).includes(" disabled"), "AI provider fields must start locked before permission state hydrates");
assert(dashboardSource.slice(aiFieldsetStart, aiFieldsetEnd).includes('aria-describedby="aiFormAccessStatus"'), "locked AI fields must reference the live setup status");
assert(dashboardSource.indexOf('id="apiBaseUrlInput"') < aiFieldsetStart, "the provider URL must remain available before the gated AI fields");
assert(dashboardSource.indexOf('id="clearKey"') < aiFieldsetStart, "credential removal must remain available outside the gated AI fields");
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

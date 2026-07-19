import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createMessageRouter } from "../../extension/runtime/message-router.mjs";
import { createRuntimeSettingsService } from "../../extension/runtime/settings-service.mjs";
import { createRuntimeStatusStore } from "../../extension/runtime/status-store.mjs";
import { createPermissionGateway } from "../../extension/runtime/permission-gateway.mjs";
import { createExtensionRuntime } from "../../extension/runtime/extension-runtime.mjs";

export async function runArchitectureTests(root) {
  const appEntry = await fs.readFile(path.join(root, "assets/client/app.mjs"), "utf8");
  const workerEntry = await fs.readFile(path.join(root, "extension/service-worker.mjs"), "utf8");
  assert(appEntry.split(/\r?\n/).length <= 40, "the dashboard entry must remain a composition root");
  assert(workerEntry.split(/\r?\n/).length <= 20, "the worker entry must remain a composition root");
  assert.deepEqual(importSpecifiers(appEntry), ["./dashboard-app.mjs"], "the dashboard entry may only assemble the dashboard app");
  assert.deepEqual(importSpecifiers(workerEntry), ["./runtime/extension-runtime.mjs"], "the worker entry may only assemble the extension runtime");
  const workerGraph = await localModuleGraph(path.join(root, "extension/service-worker.mjs"));
  const workerGraphRelative = new Set([...workerGraph].map((file) => path.relative(root, file).replaceAll("\\", "/")));
  const workerGraphBytes = (await Promise.all([...workerGraph].map(async (file) => (await fs.stat(file)).size)))
    .reduce((total, size) => total + size, 0);
  assert(workerGraphBytes <= 640 * 1024, `the service worker static graph must stay within its 640 KiB startup budget (found ${workerGraphBytes} bytes)`);
  assert(!workerGraphRelative.has("extension/core/i18n.mjs"), "the service worker must not load the full client translation catalog");
  assert(![...workerGraphRelative].some((file) => file.startsWith("assets/client/locales/")), "the service worker graph must exclude client locale modules");
  assert(!workerGraphRelative.has("extension/core/china-location-data.mjs"), "the service worker graph must exclude the eager China location module");
  assert(workerGraphRelative.has("extension/core/runtime-i18n.mjs")
    && workerGraphRelative.has("extension/core/runtime-locales/en.mjs")
    && workerGraphRelative.has("extension/core/runtime-locales/zh-CN.mjs")
    && workerGraphRelative.has("extension/core/runtime-locales/zh-Hant.mjs"),
  "the service worker must use the generated runtime locale catalogs");

  const dashboardGraph = new Set([
    ...await localModuleGraph(path.join(root, "assets/client/app.mjs")),
    ...await localModuleGraph(path.join(root, "assets/client/extension-ui.mjs")),
  ]);
  const dashboardGraphRelative = new Set([...dashboardGraph].map((file) => path.relative(root, file).replaceAll("\\", "/")));
  const dashboardGraphBytes = (await Promise.all([...dashboardGraph].map(async (file) => (await fs.stat(file)).size)))
    .reduce((total, size) => total + size, 0);
  assert(dashboardGraphBytes <= 760 * 1024, `the dashboard static graph must stay within its 760 KiB startup budget (found ${dashboardGraphBytes} bytes)`);
  assert(dashboardGraphRelative.has("assets/client/locales/all-translations.mjs"), "the dashboard graph must include the generated cross-locale subset");
  assert(!dashboardGraphRelative.has("extension/core/i18n.mjs"), "the dashboard must not eagerly load the full-catalog i18n adapter");
  for (const locale of ["en", "zh-CN", "zh-Hant"]) {
    assert(!dashboardGraphRelative.has(`assets/client/locales/${locale}.mjs`), `the dashboard must load ${locale} only on demand`);
  }
  const dashboardI18nSource = await fs.readFile(path.join(root, "assets/client/i18n.mjs"), "utf8");
  for (const locale of ["en", "zh-CN", "zh-Hant"]) {
    assert(dashboardI18nSource.includes(`() => import("./locales/${locale}.mjs")`), `the dashboard must use a literal dynamic import for ${locale}`);
  }

  const popupGraph = await localModuleGraph(path.join(root, "assets/client/action-popup.mjs"));
  const popupGraphRelative = new Set([...popupGraph].map((file) => path.relative(root, file).replaceAll("\\", "/")));
  const popupGraphBytes = (await Promise.all([...popupGraph].map(async (file) => (await fs.stat(file)).size)))
    .reduce((total, size) => total + size, 0);
  assert(popupGraphBytes <= 40 * 1024, `the action popup static graph must stay within its 40 KiB startup budget (found ${popupGraphBytes} bytes)`);
  assert(popupGraphRelative.has("assets/client/locales/popup.mjs"), "the action popup must include its generated micro-catalog");
  assert(!popupGraphRelative.has("assets/client/api.mjs")
    && !popupGraphRelative.has("assets/client/i18n.mjs")
    && !popupGraphRelative.has("extension/core/i18n.mjs"),
  "the action popup must exclude the dashboard API and full-catalog i18n graph");
  for (const locale of ["en", "zh-CN", "zh-Hant"]) {
    assert(!popupGraphRelative.has(`assets/client/locales/${locale}.mjs`), `the action popup must exclude the full ${locale} catalog`);
  }

  const coreFiles = await listFiles(path.join(root, "extension/core"), ".mjs");
  for (const file of coreFiles) {
    const source = await fs.readFile(file, "utf8");
    assert(!source.includes("../runtime/"), `${path.basename(file)} must not depend on runtime services`);
  }

  const clientFiles = await listFiles(path.join(root, "assets/client"), ".mjs");
  const elementsSource = await fs.readFile(path.join(root, "assets/client/elements.mjs"), "utf8");
  const dashboardAppSource = await fs.readFile(path.join(root, "assets/client/dashboard-app.mjs"), "utf8");
  const extensionRuntimeSource = await fs.readFile(path.join(root, "extension/runtime/extension-runtime.mjs"), "utf8");
  const actionPopupSource = await fs.readFile(path.join(root, "assets/client/action-popup.mjs"), "utf8");
  const sourceSettingsSource = await fs.readFile(path.join(root, "assets/client/source-settings-controller.mjs"), "utf8");
  const settingsControllerSource = await fs.readFile(path.join(root, "assets/client/settings-controller.mjs"), "utf8");
  const summaryViewSource = await fs.readFile(path.join(root, "assets/client/summary-view.mjs"), "utf8");
  const efficiencyViewSource = await fs.readFile(path.join(root, "assets/client/efficiency-view.mjs"), "utf8");
  const aiSearchUiSource = await fs.readFile(path.join(root, "assets/client/ai-search-ui.mjs"), "utf8");
  const readerUiSource = await fs.readFile(path.join(root, "assets/client/reader-ui.mjs"), "utf8");
  const aiConnectionTestSource = await fs.readFile(path.join(root, "assets/client/ai-connection-test.mjs"), "utf8");
  const manualAiUsageNoticeSource = await fs.readFile(path.join(root, "assets/client/manual-ai-usage-notice.mjs"), "utf8");
  const confirmationDialogSource = await fs.readFile(path.join(root, "assets/client/confirmation-dialog.mjs"), "utf8");
  const activityControllerSource = await fs.readFile(path.join(root, "assets/client/activity-controller.mjs"), "utf8");
  const settingsTransferSource = await fs.readFile(path.join(root, "assets/client/settings-transfer-controller.mjs"), "utf8");
  const dashboardHtml = await fs.readFile(path.join(root, "dashboard.html"), "utf8");
  const dailyViewSource = await fs.readFile(path.join(root, "assets/client/daily-view.mjs"), "utf8");
  const dailyCardViewSource = await fs.readFile(path.join(root, "assets/client/daily-card-view.mjs"), "utf8");
  const bookmarksViewSource = await fs.readFile(path.join(root, "assets/client/bookmarks-view.mjs"), "utf8");
  const cardTransitionSource = await fs.readFile(path.join(root, "assets/client/card-transition.mjs"), "utf8");
  const motionSource = await fs.readFile(path.join(root, "assets/client/motion.mjs"), "utf8");
  const motionTokensSource = await fs.readFile(path.join(root, "assets/styles/tokens.css"), "utf8");
  const dashboardSectionsCssSource = await fs.readFile(path.join(root, "assets/styles/dashboard-sections.css"), "utf8");
  const motionResponsiveCssSource = await fs.readFile(path.join(root, "assets/styles/motion-responsive.css"), "utf8");
  const primitivesCssSource = await fs.readFile(path.join(root, "assets/styles/primitives.css"), "utf8");
  const permissionClientSource = await fs.readFile(path.join(root, "assets/client/permission-client.mjs"), "utf8");
  const runtimeClientSource = await fs.readFile(path.join(root, "assets/client/runtime-client.mjs"), "utf8");
  for (const group of ["shell", "dashboard", "settings", "overlay"]) {
    assert(elementsSource.includes(`${group}: pick(elements,`), `elements must expose the ${group} group`);
  }
  assert(dashboardAppSource.includes("getElementGroups()") && !dashboardAppSource.includes("getElements()"), "dashboard assembly must use scoped element groups");
  assert(dashboardAppSource.includes("export async function createDashboardApp()")
    && appEntry.includes("await createDashboardApp()"), "dashboard hydration and controller assembly must begin from an explicit async factory");
  assert(dashboardAppSource.indexOf("export async function createDashboardApp()") < dashboardAppSource.indexOf("await hydrateStorage()"), "storage hydration must not run as an import side effect");
  assert(dashboardAppSource.includes("createActionPort(")
    && dashboardAppSource.includes("activityActions.bind(activityController)")
    && dashboardAppSource.includes("readerActions.bind(readerController)")
    && dashboardAppSource.includes("summaryActions.bind(summaryView)"), "cyclic dashboard actions must use explicit ports and binding points");
  assert(!/activityController\.(?:matchesQuery|openDailyItem|toggleSeen)|readerController\.(?:openExternal|openExternalWindow)|summaryView\.(?:newsSummaryItems|createNewsRanker)/.test(dashboardAppSource), "views must not capture mutable forward controller references for cyclic actions");
  assert(dailyViewSource.includes("cardTransition") && !dailyViewSource.includes("function animateCardsOut"), "daily and summary views must share the card transition primitive");
  const dailyReshuffleSource = dailyViewSource.slice(
    dailyViewSource.indexOf("function reshuffleDailyColumn"),
    dailyViewSource.indexOf("function clearSeenArchive"),
  );
  assert(dailyReshuffleSource.includes("renderDailyColumn(columnId, { animateAction: true });")
    && dailyReshuffleSource.indexOf("renderDailyColumn(columnId, { animateAction: true });") < dailyReshuffleSource.indexOf("preloadDailyInspiration")
    && !dailyReshuffleSource.includes("await preloadDailyInspiration"), "daily reshuffle must paint the selected column before warming inspiration previews");
  const renderDailyColumnSource = dailyViewSource.slice(
    dailyViewSource.indexOf("function renderDailyColumn"),
    dailyViewSource.indexOf("function renderDailyBoard"),
  );
  assert(renderDailyColumnSource.includes("syncDailyBoardColumn(currentColumn, createBoardColumn(column), token, { immediate: true })")
    && renderDailyColumnSource.includes("cancelDailyColumnTransition(columnId)")
    && !renderDailyColumnSource.includes("++dailyBoardRenderToken"), "daily reshuffle must replace only the selected batch without waiting for or invalidating other column transitions");
  assert(dailyViewSource.includes("restoreActionFocus") && dailyViewSource.includes("focus({ preventScroll: true })"), "daily reshuffle must preserve keyboard focus when its column header is replaced");
  assert(summaryViewSource.includes('els.summaryBatch.querySelector(".btn-label")')
    && !summaryViewSource.includes("els.summaryBatch.textContent ="), "summary batch labels must update without removing the button icon");
  assert(summaryViewSource.slice(0, 1800).includes("createThemedIcon, srOnly,")
    && dashboardAppSource.includes("createThemedIcon, srOnly,\n    createReadingActions"),
  "summary loading controls must receive the screen-reader label factory through explicit dependencies");
  const refreshProgressHandler = dashboardAppSource.slice(
    dashboardAppSource.indexOf('detail?.type === "refresh.progress"'),
    dashboardAppSource.indexOf("function handleFaviconPermissionChanged"),
  );
  assert(refreshProgressHandler.includes("renderStatus();") && refreshProgressHandler.includes("renderDaily();"), "refresh progress must update both controls and the visible daily news caching state");
  assert(dailyViewSource.includes('state.data?.status?.running === true') && dailyViewSource.includes('role", "progressbar"'), "an empty news column must expose live background cache progress");
  assert(cardTransitionSource.includes("function animateCardsOut") && cardTransitionSource.includes("function setCardItemIdentity"), "card transition behavior must remain centralized");
  assert(summaryViewSource.includes('createReadingActions(item, { source: "news", compact: true })')
    && !summaryViewSource.includes("includeRead: false"),
  "summary news cards must expose the viewed-state action");
  assert(dashboardSectionsCssSource.includes(".action-toggle.viewed-toggle.is-active,")
    && bookmarksViewSource.includes('className: "viewed-toggle"'),
  "viewed action toggles must use the accent color when active");
  assert(bookmarksViewSource.includes("playActionFeedback(button);")
    && !bookmarksViewSource.includes("window.setTimeout(onClick, 360);")
    && !dashboardSectionsCssSource.includes("is-subtle-elastic"),
  "summary actions must update immediately and use one non-conflicting feedback animation");
  assert(primitivesCssSource.includes(".action-toggle-icon.is-loading-icon {")
    && !primitivesCssSource.includes(".is-loading .action-toggle-icon {")
    && bookmarksViewSource.includes('"is-loading-icon"'),
  "only explicitly marked loading action icons may spin");
  assert(!/\.summary-card-actions[^{\n]*\.action-toggle[^{\n]*:hover/.test(dashboardSectionsCssSource)
    && dashboardSectionsCssSource.includes(".seen-toggle:hover,\n.action-toggle:hover {\n  background: transparent;\n  color: var(--text);\n}")
    && !motionResponsiveCssSource.includes("@keyframes cardActionHoverSpring"),
  "all summary card actions must use the same color-only hover without a manual-summary background or scale");
  for (const token of [
    "--motion-ease-standard: cubic-bezier(.2, 0, 0, 1)",
    "--motion-ease-enter: cubic-bezier(.16, 1, .3, 1)",
    "--motion-ease-exit: cubic-bezier(.4, 0, 1, 1)",
    "--motion-ease-move: cubic-bezier(.22, .8, .3, 1)",
    "--motion-ease-ambient: cubic-bezier(.37, 0, .63, 1)",
    "--motion-ease-brand: cubic-bezier(.34, 1.16, .64, 1)",
  ]) assert(motionTokensSource.includes(token), `motion tokens must define ${token}`);
  assert(motionTokensSource.includes('--font-mono: "Cascadia Mono"'), "technical labels must use a local monospace font stack");
  assert(motionSource.includes("export const MOTION_EASING")
    && motionSource.includes("createLoadingPhaseController")
    && motionSource.includes("animateKeyedLayout")
    && motionSource.includes("setDisclosureVisibility"), "client motion must centralize easing, loading phases, keyed layout, and disclosures");
  assert(aiSearchUiSource.includes('setAiSearchMeta(t(isFollowup')
    && aiSearchUiSource.includes("createAiLoadingState")
    && !aiSearchUiSource.includes('els.aiAnswer.textContent = t("aiSearch.analyzing")'), "AI search processing states must share the accessible loading skeleton and live status treatment");
  assert(efficiencyViewSource.includes('meta?.setAttribute("aria-live", "polite")')
    && efficiencyViewSource.includes("createAiLoadingState"), "the daily brief must expose a live processing label and share the AI loading skeleton");
  assert(summaryViewSource.includes('card.setAttribute("aria-busy", "true")')
    && summaryViewSource.includes("createLoadingSurfaceController(card)")
    && summaryViewSource.includes("finishManualSummaryLoadingMotion(item.key)"), "manual card summaries must expose and clean up the shared loading state");
  for (const file of clientFiles.filter((name) => path.basename(name) !== "motion.mjs")) {
    const source = await fs.readFile(file, "utf8");
    assert(!source.includes("cubic-bezier("), `${path.basename(file)} must use named motion curves instead of anonymous cubic-bezier values`);
  }

  const cssFiles = await listFiles(path.join(root, "assets"), ".css");
  for (const file of cssFiles.filter((name) => path.basename(name) !== "tokens.css")) {
    const lines = (await fs.readFile(file, "utf8")).split(/\r?\n/);
    for (const line of lines.filter((value) => /\b(?:animation|transition)(?:-[a-z-]+)?\s*:/.test(value))) {
      const declaration = line.replace(/var\(--motion-ease-[^)]+\)/g, "");
      assert(!declaration.includes("cubic-bezier("), `${path.basename(file)} motion declarations must reference semantic curve tokens`);
      assert(!/(?:^|[\s:,])ease(?:-in|-out|-in-out)?(?=[\s,;]|$)/.test(declaration), `${path.basename(file)} must not use anonymous ease keywords`);
      if (/\blinear\b/.test(declaration)) {
        assert(/animation:\s*(?:spin|skeletonSweep)\b/.test(declaration), `${path.basename(file)} may use linear only for spinner or skeleton sweep motion`);
      }
    }
  }
  assert(runtimeClientSource.includes("sendRuntimeRequest") && permissionClientSource.includes("requestOrigins"), "browser runtime and permission access must remain behind client gateways");
  assert(extensionRuntimeSource.includes('"reading-queue:capture-current": (payload) => handleActionClicked(payload.tab || {})'), "the toolbar popup must reuse the atomic reading-queue capture service");
  assert(extensionRuntimeSource.includes('"browser:search": (payload, sender) => browserSearchService.search(payload, sender)')
    && extensionRuntimeSource.includes("return routeMessage(request, sender)"), "browser search must stay runtime-scoped and target the requesting tab");
  assert(extensionRuntimeSource.includes('details.reason === "install"')
    && extensionRuntimeSource.includes('chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") })'), "first installation must open Ampira for onboarding without reopening it after updates");
  assert(actionPopupSource.includes("settings.onboardingCompleted !== true")
    && actionPopupSource.indexOf("settings.onboardingCompleted !== true") < actionPopupSource.indexOf("await captureCurrentPage()"), "the toolbar popup must open onboarding before reading or capturing the active tab");
  assert(extensionRuntimeSource.includes("chrome.tabs.onUpdated.addListener(handleTabUpdated)"), "tab navigation must reset per-tab capture feedback");
  assert(!/let\s+(?:refreshService|permissionWorkflow|aiSearchService)\b/.test(extensionRuntimeSource), "runtime services must not rely on forward mutable service bindings");
  assert(extensionRuntimeSource.includes("refreshCoordinator.setRun(refreshService.runRefresh)"), "refresh coordination must bind its runner explicitly after service construction");
  for (const leakedBinding of ["NEWS_CARD_TYPE"]) {
    assert(!sourceSettingsSource.includes(leakedBinding), `source settings must receive ${leakedBinding} through explicit dependencies`);
  }
  for (const dependency of ["allTranslations", "newsCardType", "newsSectionName"]) {
    assert(sourceSettingsSource.slice(0, 600).includes(dependency), `source settings must declare the ${dependency} dependency`);
    assert(dashboardAppSource.includes(`${dependency}:`) || dashboardAppSource.includes(`  ${dependency},`), `dashboard composition must provide ${dependency}`);
  }
  assert(!summaryViewSource.includes("SUMMARY_DETAIL_MAX_LENGTH"), "summary view must receive its detail-length policy through dependencies");
  assert(summaryViewSource.slice(0, 1800).includes("summaryDetailMaxLength"), "summary view must declare its detail-length dependency");
  assert(summaryViewSource.includes("node.title = fullDetailText"), "summary text hover must reveal the untruncated summary instead of inheriting the card title");
  assert(dashboardAppSource.includes("summaryDetailMaxLength: SUMMARY_DETAIL_MAX_LENGTH"), "dashboard composition must provide the summary detail length");
  assert(dashboardHtml.includes('<dialog class="confirmation-dialog" id="confirmationDialog"')
    && dashboardHtml.includes('id="confirmationCancel" type="button" autofocus')
    && dashboardHtml.includes('id="confirmationConfirm" type="button"'), "all confirmations must use one accessible native dialog with a safe default action");
  assert(confirmationDialogSource.includes("if (pendingPromise) return pendingPromise")
    && confirmationDialogSource.includes('content.tone === "danger"')
    && confirmationDialogSource.includes("focusTarget.focus({ preventScroll: true })"), "the shared confirmation must deduplicate opens, support destructive actions, and restore focus");
  assert(manualAiUsageNoticeSource.includes('MANUAL_AI_USAGE_NOTICE_KEY = "dash.ai.manual-token-notice.v1"')
    && manualAiUsageNoticeSource.includes("if (pendingPromise) return pendingPromise")
    && manualAiUsageNoticeSource.includes("writeValue(MANUAL_AI_USAGE_NOTICE_KEY, MANUAL_AI_USAGE_ACKNOWLEDGED)"), "manual AI acknowledgement must be device-local, shared, and written only by the continue action");
  for (const [name, source, key] of [
    ["read all", activityControllerSource, "confirmation.readAll.title"],
    ["unsaved settings", settingsControllerSource, "confirmation.unsaved.title"],
    ["settings import", settingsTransferSource, "confirmation.import.title"],
    ["clear source statistics", sourceSettingsSource, "confirmation.clearSuggestions.title"],
    ["block suggested sources", sourceSettingsSource, "confirmation.blockAll.title"],
  ]) assert(source.includes("await confirmAction({") && source.includes(key), `${name} must use the shared confirmation dialog`);
  for (const file of clientFiles) {
    const source = await fs.readFile(file, "utf8");
    assert(!source.includes("window.confirm("), `${path.basename(file)} must not bypass the shared confirmation dialog`);
  }
  for (const [name, source, route] of [
    ["single summary", summaryViewSource, 'apiPost("/api/summary/refresh"'],
    ["daily brief", efficiencyViewSource, 'apiPost("/api/daily-summary/refresh"'],
    ["AI search", aiSearchUiSource, 'apiPost("/api/ai/search"'],
    ["Reader translation", readerUiSource, 'apiPost("/api/reader/translate"'],
    ["AI connection test", aiConnectionTestSource, 'apiPost("/api/settings/test"'],
  ]) {
    const guardIndex = source.indexOf("await confirmManualAiUsage");
    const requestIndex = source.indexOf(route);
    assert(guardIndex >= 0 && requestIndex > guardIndex, `${name} must allow cancellation before entering its manual AI request`);
  }
  assert(aiSearchUiSource.includes("confirmManualAiUsage({ aiEnabled: state.data?.ai?.enabled === true })"), "Ampira local search must bypass the token notice when AI is unavailable");
  assert(dashboardAppSource.includes("createConfirmationDialogController")
    && dashboardAppSource.includes("createManualAiUsageNoticeController")
    && (dashboardAppSource.match(/confirmManualAiUsage/g) || []).length >= 6, "dashboard composition must share one manual AI notice across all five entry points");
  assert(efficiencyViewSource.slice(0, 1200).includes("openAiSettings"), "efficiency view must declare its AI settings action dependency");
  assert(dashboardAppSource.includes("  openAiSettings,"), "dashboard composition must provide the AI settings action");
  assert(appEntry.includes('launchUrl.searchParams.get("open") === "ai-settings"')
    && appEntry.includes('history.replaceState(null, ""')
    && appEntry.includes("await app.openAiSettings()"), "the onboarding AI handoff must open existing settings once and remove its launch parameter");
  assert(/return\s*\{[\s\S]{0,160}handleFaviconPermissionChanged,[\s\S]{0,80}openAiSettings,/.test(dashboardAppSource), "the dashboard app interface must expose the existing AI settings action to its entry point");
  assert(settingsControllerSource.includes("const providerChoice = !els.aiProviderEditor.hidden && !els.aiProviderCatalog.hidden")
    && settingsControllerSource.includes("const target = providerChoice ||"), "AI settings handoff must focus the first provider choice before locked credential fields");
  const settingsReleaseIndex = settingsControllerSource.indexOf('els.settingsModal.classList.remove("open", "closing");');
  const settingsNavSyncIndex = settingsControllerSource.indexOf("syncNavToCurrentSection();", settingsReleaseIndex);
  assert(settingsReleaseIndex >= 0 && settingsNavSyncIndex > settingsReleaseIndex && settingsNavSyncIndex - settingsReleaseIndex < 160, "closing settings must restore the active navigation item after the modal stops blocking scroll synchronization");
  const inspirationPreviewCapabilities = new Set(
    [...dailyViewSource.matchAll(/\binspirationPreviews\.([A-Za-z_$][\w$]*)/g), ...dailyCardViewSource.matchAll(/\binspirationPreviews\.([A-Za-z_$][\w$]*)/g)]
      .map((match) => match[1]),
  );
  const inspirationPreviewProxy = dashboardAppSource.match(/inspirationPreviews:\s*\{([\s\S]*?)\n\s*\},\n\s*apiGet/)?.[1] || "";
  for (const capability of inspirationPreviewCapabilities) {
    assert(inspirationPreviewProxy.includes(`${capability}:`), `dashboard composition must proxy inspirationPreviews.${capability}`);
  }
  for (const file of clientFiles.filter((name) => /-view\.mjs$/.test(name))) {
    const source = await fs.readFile(file, "utf8");
    const imports = importSpecifiers(source);
    assert(!imports.some((specifier) => /(?:^|\/)(?:api|storage)\.mjs$/.test(specifier)), `${path.basename(file)} must receive API and storage dependencies from its controller`);
    assert(!/\bchrome\s*\./.test(source), `${path.basename(file)} must not call Chrome APIs`);
  }

  for (const file of clientFiles.filter((name) => /(?:controller|view|service)\.mjs$/.test(name))) {
    const lines = (await fs.readFile(file, "utf8")).split(/\r?\n/).length;
    assert(lines <= 520, `${path.basename(file)} must remain a focused module (found ${lines} lines)`);
  }

  const runtimeFiles = await listFiles(path.join(root, "extension/runtime"), ".mjs");
  for (const file of runtimeFiles) {
    const source = await fs.readFile(file, "utf8");
    assert(!importSpecifiers(source).some((specifier) => specifier.includes("assets/client")), `${path.basename(file)} must not depend on dashboard modules`);
  }
  for (const [relativePath, maximumLines] of [
    ["extension/core/feed.mjs", 900],
    ["extension/core/feed-utils.mjs", 200],
    ["extension/core/feed-digest.mjs", 100],
    ["extension/runtime/refresh-policy.mjs", 100],
  ]) {
    const source = await fs.readFile(path.join(root, relativePath), "utf8");
    const lines = source.split(/\r?\n/).length;
    assert(lines <= maximumLines, `${relativePath} must remain focused (found ${lines} lines)`);
  }

  const cssEntry = await fs.readFile(path.join(root, "assets/dashboard.css"), "utf8");
  const imports = [...cssEntry.matchAll(/@import\s+url\(["'](.+?)["']\);/g)].map((match) => match[1]);
  assert.equal(imports.length, 7, "dashboard.css must remain an ordered local stylesheet manifest");
  for (const reference of imports) {
    assert(reference.startsWith("./styles/") && !reference.includes(":") && !reference.includes(".."), "CSS imports must remain local");
    await fs.access(path.resolve(path.dirname(path.join(root, "assets/dashboard.css")), reference));
  }

  const route = createMessageRouter({ ping: (payload, sender) => payload.value + sender.offset }, (type) => {
    throw Object.assign(new Error(`unknown: ${type}`), { code: "UNKNOWN_REQUEST" });
  });
  assert.equal(route({ type: "ping", payload: { value: 7 } }, { offset: 2 }), 9, "message routing must preserve sender context for tab-scoped browser capabilities");
  assert.throws(() => route({ type: "missing" }), (error) => error.code === "UNKNOWN_REQUEST");

  const settingsService = createRuntimeSettingsService({
    store: {
      async read() { return { uiLocale: "en" }; },
      mutate(action) { return action({ write: async (value) => value }); },
    },
    async readProviderProfile() {
      return { openaiBaseUrl: "https://api.openai.com/v1", openaiApiStyle: "responses", openaiSummaryModel: "model", credentialGeneration: 2 };
    },
    async readDeviceConsent() { return { aiDisclosureAccepted: false }; },
  });
  const settings = await settingsService.getSettings();
  assert.equal(settings.newsBookmarkFolder, "");
  assert.equal(settings.newsSourceMode, "public");
  assert.equal(settings.inspirationBookmarkFolder, "");
  assert.equal(settings.inspirationSourceMode, "preset");
  assert.equal(settings.credentialGeneration, 2);

  const records = new Map();
  const statusStore = createRuntimeStatusStore({
    getRecord: async (key, fallback) => records.has(key) ? records.get(key) : fallback,
    setRecord: async (key, value) => records.set(key, value),
    broadcast: () => {},
    createStages: () => ({ complete: "running" }),
  });
  await statusStore.setRefreshStatus({ running: true });
  assert.deepEqual(await statusStore.getRefreshStatus(), { running: true });

  const permissionGateway = createPermissionGateway({
    chrome: {
      bookmarks: { async getTree() { return []; } },
      permissions: {
        async getAll() { return { origins: ["https://news.example/*"] }; },
        async contains({ origins }) { return origins.includes("https://news.example/*"); },
      },
    },
    async getSettings() { return {}; },
    async secretStatus() { return { hasOpenAIKey: false, hasImageSearchKey: false }; },
  });
  assert.equal(await permissionGateway.hasOriginPermission("https://news.example/story"), true);
  assert.equal(await permissionGateway.hasOriginPermission("http://remote.example/story"), false);
  const zhCnPublicOrigins = await permissionGateway.selectedOrigins({ bookmarks: [] }, {
    bookmarkConsentGranted: true,
    publicFeedSupplementEnabled: true,
    uiLocale: "zh-CN",
  });
  assert(zhCnPublicOrigins.some((row) => row.origin === "https://www.ithome.com/*"));
  assert(!zhCnPublicOrigins.some((row) => row.origin === "https://www.theverge.com/*"));
  const enPublicOrigins = await permissionGateway.selectedOrigins({ bookmarks: [] }, {
    bookmarkConsentGranted: true,
    publicFeedSupplementEnabled: true,
    uiLocale: "en",
  });
  assert(enPublicOrigins.some((row) => row.origin === "https://www.theverge.com/*"));
  assert(enPublicOrigins.some((row) => row.origin === "https://feeds.macrumors.com/*"));
  assert(!enPublicOrigins.some((row) => row.origin === "https://www.solidot.org/*"));

  const storage = { async get() { return {}; }, async set() {}, async remove() {}, async clear() {} };
  const runtime = createExtensionRuntime({
    chrome: {
      storage: { local: storage, sync: storage },
      bookmarks: { async getTree() { return []; } },
      permissions: { async getAll() { return { origins: [] }; }, async contains() { return false; } },
      runtime: { sendMessage() { return Promise.resolve(); } },
    },
  });
  for (const method of [
    "ensureReady", "handleMessage", "refresh", "handleAlarm",
    "handleBookmarksChanged", "handlePermissionsAdded", "handlePermissionsRemoved",
    "handleActionClicked", "handleTabUpdated", "start",
  ]) assert.equal(typeof runtime[method], "function", `runtime must expose ${method}`);
  await assert.rejects(
    runtime.handleMessage({ type: "feed:refresh-source", payload: {} }),
    (error) => error?.code === "SOURCE_NOT_FOUND",
    "the scoped source-refresh message must reach the refresh service rather than an undefined factory export",
  );
}

function importSpecifiers(source) {
  return [...source.matchAll(/\bfrom\s+["']([^"']+)["']|\bimport\s+["']([^"']+)["']/g)]
    .map((match) => match[1] || match[2]);
}

async function listFiles(directory, extension) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return listFiles(absolute, extension);
    return entry.name.endsWith(extension) ? [absolute] : [];
  }));
  return files.flat();
}

async function localModuleGraph(entry) {
  const visited = new Set();
  const pending = [path.resolve(entry)];
  while (pending.length) {
    const file = pending.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    const source = await fs.readFile(file, "utf8");
    for (const specifier of importSpecifiers(source)) {
      if (!specifier.startsWith(".")) continue;
      pending.push(path.resolve(path.dirname(file), specifier));
    }
  }
  return visited;
}

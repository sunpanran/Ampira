import { getElementGroups } from "../../assets/client/elements.mjs";
import { createAiConnectionTest } from "../../assets/client/ai-connection-test.mjs";
import { createAiSearchController } from "../../assets/client/ai-search-ui.mjs";
import { createEfficiencyView } from "../../assets/client/efficiency-view.mjs";
import { createReaderController } from "../../assets/client/reader-ui.mjs";
import { createSettingsTransferController } from "../../assets/client/settings-transfer-controller.mjs";
import { createInitialState } from "../../assets/client/state.mjs";
import { createSummaryView } from "../../assets/client/summary-view.mjs";
import { createCardTransition } from "../../assets/client/card-transition.mjs";
import { dailyThumbTransition, summaryThumbTransition } from "../../assets/client/thumb-transition.mjs";

const checks = [];
const check = (value, label) => { if (!value) throw new Error(label); checks.push(label); };
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

try {
  const base = document.createElement("base");
  base.href = new URL("../../", import.meta.url).href;
  document.head.append(base);
  const markup = new DOMParser().parseFromString(await (await fetch(new URL("../../dashboard.html", import.meta.url))).text(), "text/html");
  markup.querySelectorAll("script").forEach(node => node.remove());
  document.body.replaceChildren(...[...markup.body.children].map(node => document.importNode(node, true)));
  const els = Object.assign({}, ...Object.values(getElementGroups()));
  const state = { data: { ai: { enabled: true }, feed: { items: [] } }, settings: {}, cardTypes: {}, todos: [] };
  let decision = deferred();
  const requests = [];
  const confirmManualAiUsage = () => decision.promise;
  const request = async message => {
    requests.push(message);
    if (message.type === "reader:get") return { title: "Synthetic article", url: "https://example.com/article", blocks: [{ type: "paragraph", runs: [{ text: "This is synthetic text used only to verify the Reader translation confirmation." }] }] };
    if (message.type === "reader:translate") return { title: "Translated synthetic article", text: "Translated fixture text." };
    throw new Error(`Unexpected request: ${message.type}`);
  };
  const common = { state, els, t: key => key, request, confirmManualAiUsage };
  const ai = createAiSearchController(common);
  const aiPending = ai.run("Compare TCP and UDP");
  await settle();
  check(requests.length === 0, "AI query waits for confirmation");
  decision.resolve(false);
  await aiPending;
  check(requests.length === 0 && !state.aiSearchBusy, "Cancelling AI query leaves no request or busy state");

  decision = deferred();
  els.modelInput.value = "synthetic-model";
  const connection = createAiConnectionTest({ ...common, getAiSetupState: () => ({ formUnlocked: true }),
    runSettingsAction: () => { throw new Error("Connection test started before consent"); } });
  const connectionPending = connection.testKey();
  await settle();
  check(requests.length === 0, "Connection test waits for confirmation");
  decision.resolve(false);
  await connectionPending;
  check(requests.length === 0, "Cancelling connection test sends nothing");

  decision = deferred();
  const efficiency = createEfficiencyView({ ...common, dashboardLayout: {}, createIcon: () => document.createElement("span") });
  const digestPending = efficiency.refreshDailyDigest();
  const duplicateDigest = efficiency.refreshDailyDigest();
  await settle();
  check(requests.length === 0, "Daily brief waits for confirmation, including repeated clicks");
  decision.resolve(false);
  await Promise.all([digestPending, duplicateDigest]);
  check(requests.length === 0 && !state.dailyDigestRefreshing, "Cancelling daily brief clears pending state");

  decision = deferred();
  const reader = createReaderController({ ...common, localizedErrorMessage: String, syncNavToCurrentSection() {}, renderEfficiencyPanel() {} });
  await reader.openFloatingWeb("https://example.com/article", "Synthetic article");
  check(requests.length === 1 && requests[0].type === "reader:get", "Reader emits its structured read request");
  els.webFrame.querySelector(".reader-translate").click();
  await settle();
  check(requests.length === 1, "Reader translation waits for confirmation");
  decision.resolve(false);
  await settle();
  check(requests.length === 1, "Cancelling translation leaves the original article intact");
  decision = deferred();
  els.webFrame.querySelector(".reader-translate").click();
  decision.resolve(true);
  await settle();
  check(requests.length === 2 && requests[1].type === "reader:translate" && requests[1].payload.text.includes("synthetic text"), "Confirmed translation sends the original text as structured payload");
  check(els.webFrame.querySelector(".reader-translate").textContent === "reader.showOriginal", "Translation exposes the original-text toggle");
  els.webFrame.querySelector(".reader-translate").click();
  check(els.webFrame.textContent.includes("This is synthetic text") && requests.length === 2, "Original-text toggle reuses the saved article without a request");
  reader.closeFloatingWeb();

  decision = deferred();
  const transfer = createSettingsTransferController({ ...common, confirmAction: () => decision.promise,
    runSettingsAction: () => { throw new Error("Reset started before confirmation"); } });
  const resetPending = transfer.factoryReset();
  await settle();
  check(requests.length === 2, "Factory reset waits for its destructive confirmation");
  decision.resolve(false);
  await resetPending;
  check(requests.length === 2, "Cancelling factory reset leaves storage untouched");

  for (const [kind, transition, thumbClass, contentClass] of [
    ["daily", dailyThumbTransition, "inspiration-thumb", "daily-batch-content"],
    ["summary", summaryThumbTransition, "thumb", "summary-card-content"],
  ]) {
    const card = () => {
      const root = document.createElement("article"), thumb = document.createElement("div"), content = document.createElement("button");
      thumb.className = thumbClass;
      const image = document.createElement("img");
      image.src = new URL("../../assets/presets/inspiration/art-chroma-01.webp", import.meta.url).href;
      thumb.append(image);
      content.className = contentClass;
      content.textContent = "Synthetic card";
      root.append(thumb, content);
      return root;
    };
    const current = card(), same = card();
    document.body.append(current);
    const originalImage = current.querySelector("img");
    const button = current.querySelector("button");
    button.focus();
    transition.sync(current, same);
    check(current.querySelector("img") === originalImage && document.activeElement === button, `${kind}: unchanged images and focus survive reconciliation`);
    const next = card();
    next.querySelector("img").alt = "replacement";
    transition.sync(current, next);
    check(current.querySelectorAll("img").length === 1 && current.querySelector("img").alt === "replacement", `${kind}: the card snapshot owns the crossfade without duplicate live images`);
    transition.sync(current, document.createElement("article"));
    check(!current.querySelector("img"), `${kind}: switching to no image removes the previous thumbnail`);
    current.remove();
  }
  const visualState = createInitialState();
  visualState.settings = {};
  const imageUrl = new URL("../../assets/presets/inspiration/art-chroma-01.webp", import.meta.url).href;
  visualState.data = { feed: { items: Array.from({ length: 18 }, (_, index) => ({
    articleId: `fixture-${index}`, url: `https://example.com/article-${index}`, sourceKey: "fixture",
    source: "Synthetic reference", host: "example.com", title: `合成测试资讯 ${index + 1}`,
    excerpt: "本页面只使用合成资料，检查摘要截断、完整提示、批次切换和图片节点复用，".repeat(10),
    imageUrl, publishedAt: new Date().toISOString(), score: 80 - index,
  })) } };
  const summary = createSummaryView({ state: visualState, els, t: key => key,
    localizedCategory: () => "合成资讯", formatDateTime: () => "Today", faviconUrl: () => imageUrl,
    createThemedIcon: () => document.createElement("span"), createReadingActions: () => document.createElement("div"),
    attachLinkContextMenu() {}, activateCardFromKeyboard() {}, cardSummaryEnabled: () => false,
    ...createCardTransition({ exitMs: 120, enterMs: 300 }), batchLabel: () => "1",
    isNewsCard: item => item.cardType === "news", newsSectionName: () => "News", openSummaryItem() {}, writeValue() {},
    newsPreviews: { get: () => ({ imageUrl }), fingerprint: () => "fixture", isRejected: () => false, request: async () => ({ imageUrl }) },
  });
  summary.renderSummaries({ immediate: true });
  const line = els.summaryGrid.querySelector(".summary-line");
  check(line.textContent.length <= 200 && line.title.length > 200, "Summary cards truncate visible detail but preserve the complete hover text");
  summary.reshuffleSummaries(); summary.reshuffleSummaries(); summary.reshuffleSummaries();
  await new Promise(resolve => setTimeout(resolve, 800));
  check(els.summaryGrid.querySelectorAll(".summary-card").length === 2, "Rapid real-DOM batch changes commit only the latest page");
  check(!els.summaryGrid.querySelector('[data-summary-thumb-phase="leaving"]'), "Finished batches leave no outgoing thumbnail nodes");
  visualState.variants.summary = 0;
  summary.renderSummaries({ immediate: true });
  els.summarySection?.scrollIntoView();
  window.dispatchEvent(new Event("pagehide"));
  window.clientBehaviorResult = { ok: true, checks };
} catch (error) {
  window.clientBehaviorResult = { ok: false, checks, error: error.stack };
}
const report = document.createElement("pre");
report.id = "testResult";
report.textContent = JSON.stringify(window.clientBehaviorResult, null, 2);
document.body.append(report);

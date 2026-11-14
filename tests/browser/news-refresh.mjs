import "./batch-motion.mjs";
import { createAutomaticAiHarness, syntheticArticle } from "../helpers/automatic-ai-harness.mjs";

const { state, daily, summary } = window.batchFixture;
const checks = [];
const check = (value, label) => { if (!value) throw new Error(label); checks.push(label); };
const gate = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const slow = gate(), image = gate();
let imagesStarted = false, firstCard = null, focused = null, initialKey = "";
const articles = ["城市开放公共图书馆", "轨道交通公布服务更新", "公共空间改造方案发布", "科学团队发布观测成果"].map((title, i) => syntheticArticle(`progress-${i}`, {
  sourceKey: `progress-source-${i}`, source: "合成资讯", host: "news.example", title,
  excerpt: "仅用于本地刷新检查的合成资料。检查先显示文字、慢来源后续加入及图片补全时的卡片顺序与焦点。",
  contentLocale: "zh-CN", categoryKey: "news",
}));
const h = createAutomaticAiHarness({ articles, runtime: {
  aiConfigured: async () => false,
  fetchSourceArticles: async source => {
    if (source.key !== articles[0].sourceKey) await slow.promise;
    return { outcome: "items", items: articles.filter(item => item.sourceKey === source.key) };
  },
  broadcast: type => {
    if (type !== "dashboard.updated") return;
    state.data.feed = structuredClone(h.records.get("feed") || { items: [] });
    summary.renderSummaries();
    daily.renderDaily();
  },
  feedImageService: { updateImageQualityMetrics() {}, enrichMissingFeedImages: async items => {
    imagesStarted = true;
    await image.promise;
    items.forEach((item, index) => {
      item.imageUrl = new URL(`/assets/presets/inspiration/art-chroma-0${index % 3 + 1}.webp`, location.href).href;
      item.imageUrls = [item.imageUrl]; item.imageSource = "origin";
    });
  } },
} });
state.data.feed = { items: [] };
summary.renderSummaries({ immediate: true });
daily.renderDaily();
const running = h.run(undefined, { organize: false });
window.newsRefreshFixture = {
  checks, running, state,
  get imagesStarted() { return imagesStarted; },
  first() {
    const cards = [...document.querySelectorAll("#summaryGrid > .summary-card")];
    check(cards.length === 1, "First source displays while other sources remain blocked");
    check(!imagesStarted, "Text displays before image enrichment starts");
    firstCard = cards[0]; initialKey = firstCard.dataset.key;
    focused = firstCard;
    focused.focus();
    check(document.activeElement === focused, "The first card accepts keyboard focus");
    document.querySelector("#summaryGrid").closest("section")?.scrollIntoView({ behavior: "instant", block: "start" });
    return { cards: cards.length, focused: Boolean(focused) };
  },
  releaseSources: () => slow.resolve(),
  beforeImages() {
    const cards = [...document.querySelectorAll("#summaryGrid > .summary-card")];
    check(cards.length === 4 && imagesStarted, "Every fetched headline displays before slow images complete");
    check(cards[0] === firstCard && cards[0].dataset.key === initialKey, "New batches preserve the first card and its position");
    check(document.activeElement === focused, "Incremental source updates preserve keyboard focus");
    image.resolve();
  },
  async finish() {
    await running;
    await new Promise(resolve => setTimeout(resolve, 500));
    const cards = [...document.querySelectorAll("#summaryGrid > .summary-card")];
    check(cards[0] === firstCard && cards[0].dataset.key === initialKey, "Late images preserve card identity and order");
    check(document.activeElement === focused, "Late images preserve keyboard focus");
    check(state.data.feed.items.every(item => item.imageUrl), "All completed image results reach the visible feed");
    check(document.documentElement.scrollWidth <= innerWidth, "No horizontal overflow after progressive updates");
    check(h.requests.length === 0, "Collect-only refresh does not invoke AI");
    window.newsRefreshResult = { ok: true, checks };
    return window.newsRefreshResult;
  },
};

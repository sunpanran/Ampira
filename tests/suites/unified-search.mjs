import assert from "node:assert/strict";
import { bookmarkSearchEntries, rankSearchEntries, ampiraSearchEntries } from "../../extension/core/unified-search.mjs";
import { createLocalSearchService } from "../../extension/runtime/local-search-service.mjs";
import { createUnifiedSearchController, searchRecommendationRows, defaultSearchRecommendation } from "../../assets/client/unified-search-controller.mjs";
import { messageRequestForHttp } from "../../assets/client/message-contract.mjs";
import { createSearchResultsView } from "../../assets/client/search-results-view.mjs";
import { faviconUrl } from "../../assets/client/urls.mjs";

const tree = [{ title: "", children: [{ title: "Other bookmarks", children: [
  { title: "Unconfigured folder", children: [{ title: "模型参考", url: "https://reference.example/model#one" }] },
  { title: "Direct bookmark", url: "https://direct.example/" },
] }] }];
const bookmarks = bookmarkSearchEntries(tree);
assert.equal(bookmarks.length, 2, "direct children and unconfigured folders are searchable");
assert.equal(rankSearchEntries(bookmarks, "模型")[0].folderPath, "Other bookmarks / Unconfigured folder");
assert.equal(rankSearchEntries(bookmarks, "模").length, 1, "single Han characters remain searchable");
assert.equal(rankSearchEntries(bookmarks, "DIRECT").length, 1);
assert.equal(rankSearchEntries(bookmarks, "unconfigured").length, 1, "folder paths participate in matching");
assert.deepEqual(rankSearchEntries(bookmarks, " "), []);

const results = rankSearchEntries([
  { title: "Model", url: "https://example.com/a?q=1#one", sources: ["history"], lastVisitTime: 30 },
  { title: "Model", url: "https://example.com/a?q=1#one", sources: ["bookmark"] },
  { title: "Model", url: "https://example.com/a?q=1#one", sources: ["ampira"], articleId: "article", contentKind: "article" },
  { title: "Model", url: "https://example.com/a?q=1#two", sources: ["history"], lastVisitTime: 20 },
  { title: "Model", url: "https://example.com/a?q=2#one", sources: ["history"], lastVisitTime: 40 },
  { title: "Model", url: "javascript:alert(1)", sources: ["bookmark"] },
  { title: "Model", url: "http://remote.example/", sources: ["history"] },
], "model");
assert.equal(results.length, 3, "only identical full URLs merge; unsafe schemes are omitted");
assert.deepEqual(results[0].sources, ["bookmark", "ampira", "history"]);
assert.equal(results[0].articleId, "article");
assert.equal(results[1].lastVisitTime, 40, "equally ranked history uses recency");
assert.deepEqual(rankSearchEntries([
  { title: "My saved label", url: "https://example.com/renamed", sources: ["bookmark"] },
  { title: "Searchable history title", url: "https://example.com/renamed", sources: ["history"] },
], "searchable")[0].sources, ["bookmark", "history"], "one matching title retains every source for the same URL");
assert.equal(rankSearchEntries(Array.from({ length: 50 }, (_, i) => ({ title: "match", url: `https://example.com/${i}`, sources: ["bookmark"] })), "match").length, 20);
assert.equal(rankSearchEntries(ampiraSearchEntries({ feed: { items: [{ title: "Title", summary: ["Summary needle"], url: "https://article.example/" }] } }), "needle")[0].contentKind, "article");

const rows = searchRecommendationRows("model", results, { browserEnabled: true, historyStatus: "permission", aiEnabled: true });
assert.equal(defaultSearchRecommendation(rows), results[0].id);
assert.equal(defaultSearchRecommendation(searchRecommendationRows("absent", [], {})), "web");
assert.equal(defaultSearchRecommendation(searchRecommendationRows("https://example.com", results, {})), "direct");
assert.equal(defaultSearchRecommendation(searchRecommendationRows("", [], { hasConversation: true, historyStatus: "permission" })), "", "AI and permission rows never auto-submit");
assert.deepEqual(rows.map(row => row.kind), ["result", "web", "ai", "result", "result", "history"]);
assert.equal(messageRequestForHttp("POST", "/api/search").request.type, "search:query");

for (const [query, title, url, bookmarkMatch] of [
  ["a", "Alpha", "https://saved.example/", "normal"],
  [" A ", "a", "https://saved.example/", "exact"],
  ["mo", "Model reference", "https://saved.example/", "prefix"],
  ["MODEL", "Model", "https://saved.example/", "exact"],
  ["model", "Reference model guide", "https://saved.example/", "normal"],
  ["model", "Saved page", "https://saved.example/model", "normal"],
  ["model", "Saved page", "https://www.model.example/", "prefix"],
  ["MODEL.EXAMPLE", "Saved page", "https://www.model.example/", "exact"],
  ["a", "Saved page", "https://alpha.example/", "normal"],
  ["模", "模型参考", "https://saved.example/", "normal"],
  ["模", "模", "https://saved.example/", "exact"],
  ["模型", "模型参考", "https://saved.example/", "prefix"],
  ["模型", "参考模型", "https://saved.example/", "normal"],
  ["𠮷", "𠮷野", "https://saved.example/", "normal"],
]) {
  const [result] = rankSearchEntries([{ title, url, sources: ["bookmark"] }], query);
  assert.equal(result.bookmarkMatch, bookmarkMatch, `${query}: only full and multi-character prefix bookmark matches are strong`);
  assert(!("score" in result), "ranking scores stay internal to the search model");
}
assert.equal(rankSearchEntries(bookmarks, "unconfigured")[0].bookmarkMatch, "normal", "folder matches are ordinary bookmarks");
assert.equal(rankSearchEntries([{ title: "Saved notes", folderPath: "model", url: "https://saved.example/", sources: ["bookmark"] }], "model notes")[0].bookmarkMatch,
  "normal", "separate query terms do not become strong matches");

const mixedEntries = [
  { title: "Model", url: "https://visited.example/old", sources: ["history"], lastVisitTime: 10 },
  { title: "Model", url: "https://content.example/", sources: ["ampira", "history"], contentKind: "article" },
  { title: "Saved notes", url: "https://saved.example/folder", folderPath: "model", sources: ["bookmark"] },
  { title: "Reference model guide", url: "https://saved.example/contains", sources: ["bookmark"] },
  ...["b", "a", "c", "d"].map(suffix => ({ title: `Model ${suffix}`, url: `https://saved.example/prefix-${suffix}`, sources: ["bookmark"] })),
  { title: "MODEL", url: "https://saved.example/exact", sources: ["bookmark"] },
  { title: "Model", url: "https://saved.example/prefix-c", sources: ["history"], lastVisitTime: 50 },
  { title: "Model", url: "https://visited.example/new", sources: ["history"], lastVisitTime: 20 },
];
const prioritized = rankSearchEntries(mixedEntries, "model");
const priorityRows = searchRecommendationRows("model", prioritized, { browserEnabled: true, aiEnabled: true, hasConversation: true });
assert.deepEqual(priorityRows.map(row => row.id), [
  "https://saved.example/exact", "https://saved.example/prefix-c", "https://saved.example/prefix-a",
  "web", "ai", "resume", "https://saved.example/prefix-b", "https://saved.example/prefix-d",
  "https://saved.example/contains", "https://saved.example/folder", "https://content.example/",
  "https://visited.example/new", "https://visited.example/old",
], "three strong bookmarks precede actions; overflow and ordinary bookmarks precede content and history");
assert.equal(priorityRows.find(row => row.id === "https://content.example/").icon, "news", "content wins over history when sources merge");
assert.equal(prioritized[1].bookmarkMatch, "prefix", "a stronger history title cannot upgrade a bookmark prefix to an exact match");
assert.deepEqual(rankSearchEntries(mixedEntries, "model", 2).map(row => row.id), priorityRows.slice(0, 2).map(row => row.id),
  "promotion happens before applying the result limit");

const renamedEntries = [
  { title: "Saved label", url: "https://saved.example/renamed", sources: ["bookmark"] },
  { title: "Model", url: "https://saved.example/renamed", sources: ["history"] },
  { title: "Model reference", url: "https://saved.example/renamed", sources: ["ampira"] },
];
for (const entries of [renamedEntries, [...renamedEntries].reverse()]) {
  const merged = rankSearchEntries(entries, "model");
  assert.equal(merged.length, 1);
  assert.equal(merged[0].title, "Saved label");
  assert.equal(merged[0].bookmarkMatch, "normal", "matching history or content never promotes an unrelated saved title");
  assert.deepEqual(merged[0].sources, ["bookmark", "ampira", "history"]);
  assert.deepEqual(searchRecommendationRows("model", merged).map(row => row.id), ["web", "ai", merged[0].id]);
}
assert.equal(rankSearchEntries([
  ...renamedEntries, { title: "Model", url: renamedEntries[0].url, sources: ["bookmark"] },
], "model")[0].bookmarkMatch, "exact", "another real bookmark title for the same URL may supply the strong match");

const crowded = rankSearchEntries([
  ...Array.from({ length: 40 }, (_, i) => ({ title: "Model", url: `https://visited.example/${i}`, sources: ["history"] })),
  { title: "Saved notes", folderPath: "model", url: "https://saved.example/", sources: ["bookmark"] },
  { title: "Article", text: "model", url: "https://content.example/", sources: ["ampira"] },
], "model");
assert.equal(crowded.length, 20);
assert.deepEqual(crowded.slice(0, 2).map(row => row.sources[0]), ["bookmark", "ampira"], "high-scoring history cannot crowd out bookmarks or Ampira content");
const crowdedRows = searchRecommendationRows("model", crowded);
assert.equal(crowdedRows.length, 22, "search and AI actions do not consume the local result limit");
assert.equal(defaultSearchRecommendation(crowdedRows), "web", "ordinary local matches do not take the default Enter action");
const letterResults = rankSearchEntries([
  { title: "Alpha", url: "https://saved.example/alpha", sources: ["bookmark"] },
  { title: "a", url: "https://visited.example/letter", sources: ["history"] },
], "a");
assert.deepEqual(searchRecommendationRows("a", letterResults).map(row => row.kind), ["web", "ai", "result", "result"]);
assert.equal(defaultSearchRecommendation(searchRecommendationRows("a", letterResults)), "web");
assert.deepEqual(searchRecommendationRows("", prioritized, { hasConversation: true, historyStatus: "permission" }).map(row => row.id),
  ["ai", "resume", "history"], "empty input never displays retained result rows or selects an action");
console.log("Search priority, bookmark match tiers and bounded result selection tests passed");

let historyAllowed = false, consent = true, historyCalls = 0, bookmarkCalls = 0, dashboardCalls = 0;
let historyRead = async () => [{ title: "模型历史", url: "https://history.example/", lastVisitTime: 10 }];
let bookmarkRead = async () => tree;
const service = createLocalSearchService({
  chrome: {
    permissions: { contains: async ({ permissions }) => permissions[0] === "history" ? historyAllowed : true },
    history: { search: async query => {
      historyCalls += 1;
      assert.deepEqual(query, { text: "模型", startTime: 0, maxResults: 200 });
      return historyRead();
    } },
  },
  getSettings: async () => ({ bookmarkConsentGranted: consent }),
  currentBookmarkTree: async () => { bookmarkCalls += 1; return bookmarkRead(); },
  readDashboard: async () => { dashboardCalls += 1; return { feed: { items: [] } }; },
});
assert.equal((await service.search({ query: "模型" })).sources.history, "permission");
assert.equal(historyCalls, 0, "no history read without permission");
historyAllowed = true;
let response = await service.search({ query: "模型" });
assert.equal(response.results.length, 2);
const before = [historyCalls, bookmarkCalls, dashboardCalls];
await service.search({ query: " " });
assert.deepEqual([historyCalls, bookmarkCalls, dashboardCalls], before, "empty queries do not enumerate content or history");
consent = false;
response = await service.search({ query: "模型" });
assert.equal(response.sources.bookmark, "consent");
assert.equal(bookmarkCalls, before[1], "bookmark consent gates the entire browser tree");
consent = true;
bookmarkRead = async () => { throw Error("synthetic source failure"); };
response = await service.search({ query: "模型" });
assert.equal(response.sources.bookmark, "error");
assert.equal(response.results.length, 1, "one source failing does not discard other results");
bookmarkRead = async () => tree;
let resolveHistory;
historyRead = () => new Promise(resolve => { resolveHistory = resolve; });
const pending = service.search({ query: "模型" });
while (!resolveHistory) await new Promise(resolve => setImmediate(resolve));
historyAllowed = false;
resolveHistory([{ title: "模型 removed", url: "https://removed.example/" }]);
response = await pending;
assert(!response.results.some(result => result.sources.includes("history")), "revocation during a request discards history");

historyAllowed = true;
resolveHistory = null;
const removedPending = service.search({ query: "模型" });
while (!resolveHistory) await new Promise(resolve => setImmediate(resolve));
service.invalidate();
historyRead = async () => [];
resolveHistory([{ title: "模型 deleted", url: "https://deleted.example/" }]);
response = await removedPending;
assert(!response.results.some(result => result.sources.includes("history")), "deletion invalidates in-flight candidates and re-queries");
console.log("Unified search model and runtime tests passed");

const nativeIcon = faviconUrl({ url: "https://example.com/saved?q=1" }, {
  nativeEnabled: true, nativeSupported: true,
  runtime: { id: "synthetic", getURL: value => `chrome-extension://synthetic${value}` },
});
assert(nativeIcon.startsWith("chrome-extension://synthetic/_favicon/"));
assert.equal(new URL(nativeIcon).searchParams.get("pageUrl"), "https://example.com/saved?q=1");
assert.equal(faviconUrl({ url: "https://example.com/" }, { nativeEnabled: false }), "favicon.svg");
assert.equal(faviconUrl({ url: "https://example.com/" }, { nativeEnabled: true, nativeSupported: false }), "favicon.svg");

const list = element("div"), selected = [];
let iconPermission = true;
const view = createSearchResultsView({
  list, doc: { createElement: element }, t: key => key,
  icon: () => element("span"), onSelect: row => selected.push(row),
  getFaviconUrl: () => iconPermission ? nativeIcon : "favicon.svg",
});
const saved = { id: "saved", kind: "result", title: "Saved", url: "https://example.com/saved?q=1", folderPath: "Root / Work / Reference", sources: ["bookmark"], icon: "bookmark" };
const visited = { ...saved, id: "visited", title: "Visited", url: "https://example.com/visited", sources: ["history"], icon: "clock" };
const web = { id: "web", kind: "web", titleKey: "web", icon: "search", detail: "query" };
view.render([saved, visited, web], { activeId: "saved" });
const firstRow = list.children[0], firstImage = firstRow.children[0].children[1];
const firstTitle = firstRow.children[1].children[0];
const historyImage = list.children[1].children[0].children[1];
assert.equal(firstImage.width, 20);
assert.equal(firstImage.height, 20);
assert.equal(historyImage.src, nativeIcon, "history and bookmark rows share the approved favicon path");
assert(firstRow.title.includes("https://example.com/saved?q=1"), "the complete URL remains inspectable after shortening visible metadata");
view.render([{ ...saved, title: "Renamed" }, visited, web], { activeId: "visited", stale: true });
assert.equal(list.children[0], firstRow, "pending and repeated responses preserve row identity");
assert.equal(firstRow.children[1].children[0], firstTitle);
assert.equal(firstTitle.textContent, "Renamed");
assert.equal(firstRow.children[0].children[1], firstImage, "icons are not recreated on each keystroke");
assert.equal(firstImage.sourceWrites, 1, "unchanged icon URLs are not reloaded");
firstRow.fire("click");
assert.equal(selected.length, 0, "displayed stale results cannot be opened");
list.children[2].fire("click");
assert.equal(selected[0], web, "explicit current-query actions remain available while results load");
view.render([visited, { ...saved, title: "Latest" }, web], { activeId: "saved" });
assert.equal(list.children[1], firstRow, "reordering reuses the result node and its loaded icon");
firstRow.fire("click");
assert.equal(selected.at(-1).title, "Latest", "reused rows dispatch current data, not a stale closure");
firstImage.fire("error");
assert.equal(firstImage.src, "favicon.svg");
const fallbackWrites = firstImage.sourceWrites;
firstImage.fire("error");
assert.equal(firstImage.sourceWrites, fallbackWrites, "missing fallback icons do not retry forever");
iconPermission = false;
view.render([visited, saved, web], { activeId: "saved" });
assert.equal(firstRow.children[0].children[1], firstImage, "permission changes update an existing icon in its reserved slot");
assert.equal(historyImage.src, "favicon.svg");
view.clear();
assert.equal(list.children.length, 0, "privacy invalidation removes every displayed result immediately");
console.log("Search result identity, safe favicon and stale-action tests passed");

await testSearchMotionLifecycle();

async function testSearchMotionLifecycle() {
  const previousDocument = globalThis.document;
  const doc = { createElement: element, addEventListener() {}, hidden: false };
  const els = Object.fromEntries(["unifiedSearchInput", "unifiedSearchResults", "unifiedSearch",
    "unifiedSearchForm", "unifiedSearchStatus", "unifiedSearchSubmit",
    "backToSearch", "aiSearchOverlay", "aiSearchPanel", "aiSearchNav"].map(key => [key, element("div")]));
  const trigger = element("button"), timers = new Map(), animations = [];
  let nextTimer = 0;
  for (const node of [trigger, ...Object.values(els)]) {
    node.isConnected = true;
    node.focus = () => { doc.activeElement = node; };
    node.setSelectionRange = () => {};
  }
  const list = els.unifiedSearchResults, input = els.unifiedSearchInput;
  input.value = "";
  const view = {
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id),
    matchMedia: () => ({ matches: false }), addEventListener() {},
    getComputedStyle: node => ({ height: `${node.children.length * 48 + 12}px`, opacity: "1" }),
  };
  list.animate = (keyframes) => {
    const animation = { keyframes, playState: "running", addEventListener() {},
      pause() { this.playState = "paused"; }, play() { this.playState = "running"; },
      cancel() { this.playState = "idle"; } };
    animations.push(animation);
    return animation;
  };
  const flush = async delay => {
    for (const [id, task] of [...timers]) {
      if (task.delay === delay) { timers.delete(id); task.callback(); }
    }
    await Promise.resolve();
  };
  globalThis.document = doc;
  try {
    const search = createUnifiedSearchController({
      state: { settings: {}, data: {} }, els, doc, view, t: key => key,
      apiPost: async (_path, { query }) => ({ results: query ? [saved] : [], sources: {}, browserSearchEnabled: true }),
      aiSearch: { close() {}, call() {} }, setActiveNavButton() {}, syncNavToCurrentSection() {},
    });
    trigger.focus(); search.open(); await flush(0);
    const compactRows = [...list.children];
    input.value = "model"; input.fire("input");
    assert.deepEqual(list.children, compactRows, "first query waits for results instead of inserting a transient action layout");
    assert.equal(animations.length, 0, "typing alone does not start the first of two expansions");
    await flush(150);
    assert.equal(animations.length, 1, "first results trigger one size transition");
    assert(list.children.some(node => node.dataset.searchId === saved.id));
    const populatedRows = [...list.children], resize = animations.at(-1);
    search.close();
    assert.deepEqual(list.children, populatedRows, "closing preserves visible results until the fade finishes");
    assert.equal(resize.playState, "paused", "closing freezes an unfinished resize at its current height");
    search.open();
    assert.equal(resize.playState, "running", "reopening resumes the interrupted resize");
    await flush(180);
    assert(els.aiSearchOverlay.classList.contains("open"), "the old close timer cannot hide a reopened search");
    await flush(0);
    search.close(); await flush(180);
    assert.equal(list.children.length, 0, "completed close releases the result DOM");
    assert.equal(doc.activeElement, trigger, "reopening while closing retains the original focus target");
    search.open("model"); await flush(0);
    const previousHeight = view.getComputedStyle(list).height;
    input.value = ""; input.fire("input");
    assert.equal(animations.at(-1).keyframes[0].height, previousHeight, "clear measures the populated height before removing rows");
    assert(!list.children.some(node => node.dataset.searchId === saved.id), "clearing removes old content immediately");
    input.value = "model"; input.fire("input"); await flush(150);
    search.invalidate();
    assert(!list.children.some(node => node.dataset.searchId === saved.id), "privacy invalidation removes results without waiting for animation");
    search.close(); await flush(180);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
  console.log("Search entrance, reversal, cleanup and focus lifecycle tests passed");
}

function element(tag) {
  const classes = new Set(), attrs = new Map(), listeners = new Map();
  return {
    tag, children: [], parent: null, textContent: "", dataset: {}, sourceWrites: 0,
    classList: {
      add: (...names) => names.forEach(name => classes.add(name)), remove: (...names) => names.forEach(name => classes.delete(name)),
      toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name),
      contains: name => classes.has(name),
    },
    style: { setProperty() {}, removeProperty() {} },
    get firstElementChild() { return this.children[0] || null; },
    get nextElementSibling() { return this.parent?.children[this.parent.children.indexOf(this) + 1] || null; },
    set src(value) { attrs.set("src", value); this.sourceWrites += 1; },
    get src() { return attrs.get("src"); },
    setAttribute: (name, value) => attrs.set(name, value),
    getAttribute: name => attrs.get(name),
    removeAttribute: name => attrs.delete(name),
    addEventListener: (name, callback) => listeners.set(name, callback),
    fire: name => listeners.get(name)?.(),
    append(...nodes) { for (const node of nodes) this.insertBefore(node, null); },
    remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; },
    insertBefore(node, before) { node.remove(); node.parent = this; this.children.splice(before ? this.children.indexOf(before) : this.children.length, 0, node); },
    replaceChildren(...nodes) { for (const node of [...this.children]) node.remove(); this.append(...nodes); },
  };
}

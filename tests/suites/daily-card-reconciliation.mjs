import assert from "node:assert/strict";
import { createCardTransition } from "../../assets/client/card-transition.mjs";
import { createDailyBatchTransition } from "../../assets/client/daily-batch-transition.mjs";
import { nodesEqualIgnoringIconLoadState } from "../../assets/client/dom.mjs";
import { dailyThumbTransition } from "../../assets/client/thumb-transition.mjs";
const { sync: syncDailyThumb } = dailyThumbTransition;
import { summaryThumbTransition } from "../../assets/client/thumb-transition.mjs";
const { sync: syncSummaryThumb } = summaryThumbTransition;

export function runDailyCardReconciliationTests() {
  testStableCardStaysConnected();
  testChangedCardKeepsItsLiveShell();
  testTransientPointerStylesDoNotPreventReuse();
  testTransientIconLoadStateDoesNotPreventReuse();
  testTransientPreviewImageLoadStateDoesNotPreventReuse();
  testActionStateRerenderKeepsLoadedPreviewThumbs();
  testCachedImageKeepsLoadedPreviewThumbs();
  testClippedBatchSnapshots();
  testSharedBatchSnapshots();
}

function testSharedBatchSnapshots() {
  const values = new Map();
  const columns = ["utility", "news", "inspiration"].map(id => ({ id, type: id === "inspiration" ? "inspiration" : "news", items: [1] }));
  const roots = new Map(columns.map(({ id }) => [id, {
    querySelector: () => ({ children: [], clientHeight: 100, scrollHeight: 200,
      closest: () => null, style: { setProperty: (_key, value) => values.set(id, value), removeProperty: () => values.delete(id) } }),
    querySelectorAll: () => [],
  }]));
  let contexts;
  const controller = createDailyBatchTransition({
    documentNode: { documentElement: { classList: { add() {}, remove() {} } }, startViewTransition: update => { update(); return {}; } },
    dailyColumns: () => columns, getColumn: id => roots.get(id), directDailyCards: node => node.children,
    prefersReducedMotion: () => false, renderColumn: (_id, value) => { contexts = value; },
  });
  controller.run("news");
  assert.deepEqual([...contexts.keys()], ["utility", "news"], "every visible instance of the same card type must join one transition");
  assert.equal(new Set(values.values()).size, 2, "shared batches must have unique snapshot names per instance");
  assert(!values.has("inspiration"), "other card types must stay untouched");
  controller.cancel();
  assert.equal(values.size, 0, "all participating snapshots must be cleaned on interruption");
}

function testClippedBatchSnapshots() {
  const style = () => {
    const values = new Map();
    return { setProperty: (key, value) => values.set(key, value), removeProperty: key => values.delete(key), get: key => values.get(key) };
  };
  for (const [size, overflow, bounded] of [["compact", false, true], ["tall", true, true], ["tall", false, false]]) {
    const cards = Array.from({ length: 3 }, () => ({ style: style(), querySelector: () => null, querySelectorAll: () => [] }));
    const list = { children: cards, style: style(), clientHeight: 180, scrollHeight: overflow ? 400 : 180,
      closest: () => ({ dataset: { slotSize: size } }) };
    const column = { querySelector: () => list, querySelectorAll: () => cards };
    const classes = new Set();
    let context;
    const transition = createDailyBatchTransition({
      documentNode: { visibilityState: "visible", documentElement: { classList: { add: value => classes.add(value), remove: value => classes.delete(value) } },
        startViewTransition(update) { update(); return { skipTransition() {} }; } },
      getColumn: () => column, dailyColumns: () => [{ id: "utility", items: [1, 2, 3] }], directDailyCards: node => node.children,
      prefersReducedMotion: () => false, renderColumn: (id, value) => { context = value.get(id); },
    });
    transition.run("utility");
    assert.equal(Boolean(context.bounded), bounded, "compact or scrollable content needs a clipped viewport snapshot");
    if (bounded) {
      assert.equal(list.style.get("view-transition-name"), "today-utility-viewport");
      assert(cards.every(card => !card.style.get("view-transition-name")), "offscreen rows must not escape clipping in independent page-level snapshots");
    } else {
      assert(cards.every(card => card.style.get("view-transition-name")), "fully visible tall cards retain their existing item transition");
    }
    transition.cancel();
    assert(!list.style.get("view-transition-name"), "cancelling or switching card types clears the viewport snapshot name");
    assert(cards.every(card => !card.style.get("view-transition-name")));
    assert(!classes.size);
  }
}

function testStableCardStaysConnected() {
  const current = createDailyCard("story-1", "content-1");
  const next = createDailyCard("story-1", "content-1");
  const list = createCardList([current]);
  const entered = [];
  const transition = createDailyTransition({
    animateCardsIn: (cards) => entered.push(...cards),
    canReuseCard: () => true,
  });

  transition.applyCardListDiff(list, { className: "card-list link-list" }, [next]);

  assert.equal(list.children[0], current, "an unchanged news card must retain its live DOM root");
  assert.equal(current.isConnected, true, "an unchanged hovered card must stay connected during a progress repaint");
  assert.equal(current.removeCount, 0, "an unchanged hovered card must never leave its list");
  assert.equal(list.replaceCount, 0, "a progress repaint must not replace the whole card list");
  assert.deepEqual(entered, []);
}

function testChangedCardKeepsItsLiveShell() {
  const current = createDailyCard("story-1", "content-1");
  const next = createDailyCard("story-1", "content-2");
  const list = createCardList([current]);
  const transition = createDailyTransition({ canReuseCard: () => false });

  transition.applyCardListDiff(list, { className: "card-list link-list" }, [next]);

  assert.equal(list.children[0], current, "updated story content must patch the existing interactive shell");
  assert.equal(current.content.id, "content-2");
  assert.equal(current.dataset.itemVersion, "content-2");
  assert.equal(current.ampiraItem.contentId, "content-2");
  assert.equal(current.removeCount, 0);
  assert.equal(list.replaceCount, 0);
}

function testTransientPointerStylesDoNotPreventReuse() {
  const transition = createCardTransition({ exitMs: 120, enterMs: 240 });
  const current = createComparableCard({
    style: {
      "--mx": "120px",
      "--my": "60px",
      "--card-motion-delay": "0ms",
      "--card-motion-duration": "240ms",
    },
  });
  const next = createComparableCard();
  assert.equal(
    transition.canReuseCard(current, next),
    true,
    "pointer coordinates and completed motion metadata must not make unchanged card content look different",
  );

  const emptyStyle = createComparableCard({ hasStyleAttribute: true });
  assert.equal(
    transition.canReuseCard(emptyStyle, next),
    true,
    "an empty style attribute left by animation cleanup must not prevent card reuse",
  );

  const meaningfulStyle = createComparableCard({ style: { opacity: ".5" } });
  assert.equal(
    transition.canReuseCard(meaningfulStyle, next),
    false,
    "non-transient inline presentation differences must remain observable",
  );
}

function testTransientIconLoadStateDoesNotPreventReuse() {
  const transition = createCardTransition({ exitMs: 120, enterMs: 240 });
  const settled = createComparableCard();
  const pending = createComparableCard({ pendingIconCount: 3 });
  assert.equal(
    nodesEqualIgnoringIconLoadState(settled, pending),
    true,
    "newly-created pending header icons must compare equal to their already-loaded live nodes",
  );
  assert.equal(
    transition.canReuseCard(settled, pending),
    true,
    "pending pill icons must not make unchanged card content look different",
  );

  const changed = createComparableCard({ markup: "changed-card", pendingIconCount: 1 });
  assert.equal(
    transition.canReuseCard(settled, changed),
    false,
    "ignoring icon load state must not hide real card content changes",
  );
}

function testTransientPreviewImageLoadStateDoesNotPreventReuse() {
  const transition = createCardTransition({ exitMs: 120, enterMs: 240 });
  const settled = createComparableCard();
  const pending = createComparableCard({ pendingPreviewImageCount: 1 });
  const revealing = createComparableCard({ revealingPreviewImageCount: 1 });
  assert.equal(
    transition.canReuseCard(settled, pending),
    true,
    "a refresh-progress repaint must not replace an unchanged card while its preview image is pending",
  );
  assert.equal(
    transition.canReuseCard(settled, revealing),
    true,
    "a refresh-progress repaint must not replace an unchanged card while its preview image is revealing",
  );
}

function testActionStateRerenderKeepsLoadedPreviewThumbs() {
  for (const [label, syncThumb] of [
    ["today inspiration", syncDailyThumb],
    ["SIGNAL FEED", syncSummaryThumb],
  ]) {
    const currentThumb = createComparablePreviewThumb("is-preview-image-revealing");
    const nextThumb = createComparablePreviewThumb("is-preview-image-pending");
    syncThumb(createThumbCard(currentThumb), createThumbCard(nextThumb));
    assert.equal(
      currentThumb.replaceCount,
      0,
      `${label} must keep the already painted image when only an action state changed`,
    );
    assert.equal(nextThumb.removeCount, 1, `${label} must discard the duplicate pending image off-DOM`);
  }
}

function testCachedImageKeepsLoadedPreviewThumbs() {
  for (const syncThumb of [syncDailyThumb, syncSummaryThumb]) {
    const currentThumb = createComparablePreviewThumb("is-preview-image-revealing");
    const cachedThumb = createComparablePreviewThumb("", true);
    syncThumb(createThumbCard(currentThumb), createThumbCard(cachedThumb));
    assert.equal(currentThumb.replaceCount, 0, "an empty class attribute after a cache hit must not replace the already decoded image");
    assert.equal(cachedThumb.removeCount, 1);
    const changedThumb = createComparablePreviewThumb("", true);
    changedThumb.markup = "different-preview";
    assert(!nodesEqualIgnoringIconLoadState(currentThumb, changedThumb), "a real thumbnail change must remain observable");
  }
}

function createComparablePreviewThumb(transientClass, hasClassAttribute = Boolean(transientClass)) {
  let imageClass = transientClass;
  let imageClassAttribute = hasClassAttribute;
  const thumb = {
    markup: "same-preview",
    removeCount: 0,
    replaceCount: 0,
    classList: {
      get length() { return 1; },
      remove() {},
    },
    cloneNode() {
      const clone = createComparablePreviewThumb(imageClass, imageClassAttribute);
      clone.markup = thumb.markup;
      return clone;
    },
    isEqualNode(other) {
      return thumb.markup === other.markup
        && imageClass === other.imageClass()
        && imageClassAttribute === other.imageClassAttribute();
    },
    querySelectorAll(selector) {
      if (selector === '[class=""]' ? imageClass || !imageClassAttribute : !imageClass || selector !== `.${imageClass}`) return [];
      return [{
        classList: {
          get length() { return imageClass ? 1 : 0; },
          remove(name) { if (name === imageClass) imageClass = ""; },
        },
        removeAttribute(name) { if (name === "class") imageClassAttribute = false; },
      }];
    },
    imageClass: () => imageClass,
    imageClassAttribute: () => imageClassAttribute,
    remove() { thumb.removeCount += 1; },
    replaceWith() { thumb.replaceCount += 1; },
  };
  return thumb;
}

function createThumbCard(thumb) {
  return {
    prepend() {},
    querySelector() { return thumb; },
  };
}

function createDailyTransition({ animateCardsIn = () => {}, canReuseCard }) {
  return createDailyBatchTransition({
    animateCardsIn,
    canReuseCard,
    clearCardAnimationState: () => {},
    dailyBoardCardSelector: ".news-list-card, .daily-card, .archive-card",
    dailyColumns: () => [],
    directDailyCards: (list) => Array.from(list.children),
    getColumn: () => null,
    prefersReducedMotion: () => true,
    renderColumn: () => {},
  });
}

function createDailyCard(key, contentId) {
  const classes = new Set(["news-list-card", "link-row"]);
  const attributes = new Map([
    ["role", "link"],
    ["aria-label", `Open ${key}`],
  ]);
  const card = {
    ampiraItem: { key, contentId },
    className: "news-list-card link-row",
    content: null,
    dataset: { key, itemVersion: contentId },
    isConnected: false,
    parentList: null,
    removeCount: 0,
    tabIndex: 0,
    classList: {
      contains: (name) => classes.has(name),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
    },
    getAttribute: (name) => attributes.get(name) ?? null,
    hasAttribute: (name) => attributes.has(name),
    querySelector(selector) {
      if (selector === ":scope > .daily-batch-content") return card.content;
      return null;
    },
    remove() {
      card.removeCount += 1;
      const index = card.parentList?.children.indexOf(card) ?? -1;
      if (index >= 0) card.parentList.children.splice(index, 1);
      card.parentList = null;
      card.isConnected = false;
    },
    removeAttribute: (name) => attributes.delete(name),
    setAttribute: (name, value) => attributes.set(name, String(value)),
  };
  card.content = createDailyContent(card, contentId);
  return card;
}

function createDailyContent(owner, id) {
  return {
    id,
    replaceWith(nextContent) {
      owner.content = nextContent;
    },
  };
}

function createCardList(cards) {
  const list = {
    children: [...cards],
    className: "card-list link-list",
    insertCount: 0,
    replaceCount: 0,
    get lastElementChild() {
      return list.children.at(-1) || null;
    },
    insertBefore(card, reference) {
      list.insertCount += 1;
      const currentIndex = list.children.indexOf(card);
      if (currentIndex >= 0) list.children.splice(currentIndex, 1);
      const targetIndex = reference ? list.children.indexOf(reference) : list.children.length;
      list.children.splice(targetIndex < 0 ? list.children.length : targetIndex, 0, card);
      card.parentList = list;
      card.isConnected = true;
    },
    replaceChildren() {
      list.replaceCount += 1;
    },
  };
  for (const card of list.children) {
    card.parentList = list;
    card.isConnected = true;
  }
  return list;
}

function createComparableCard({
  hasStyleAttribute,
  markup = "same-card",
  pendingIconCount = 0,
  pendingPreviewImageCount = 0,
  revealingPreviewImageCount = 0,
  style = {},
  version = "version-1",
} = {}) {
  const styleValues = new Map(Object.entries(style));
  let stylePresent = hasStyleAttribute ?? styleValues.size > 0;
  let pendingIcons = pendingIconCount;
  let pendingPreviewImages = pendingPreviewImageCount;
  let revealingPreviewImages = revealingPreviewImageCount;
  const card = {
    dataset: { itemVersion: version },
    style: {
      get length() {
        return styleValues.size;
      },
      removeProperty(name) {
        const previous = styleValues.get(name) || "";
        styleValues.delete(name);
        return previous;
      },
    },
    cloneNode() {
      return createComparableCard({
        hasStyleAttribute: stylePresent,
        markup,
        pendingIconCount: pendingIcons,
        pendingPreviewImageCount: pendingPreviewImages,
        revealingPreviewImageCount: revealingPreviewImages,
        style: Object.fromEntries(styleValues),
        version: card.dataset.itemVersion,
      });
    },
    isEqualNode(other) {
      return JSON.stringify(cardSnapshot(card)) === JSON.stringify(cardSnapshot(other));
    },
    removeAttribute(name) {
      if (name !== "style") return;
      stylePresent = false;
      styleValues.clear();
    },
    querySelectorAll(selector) {
      const counts = {
        ".is-icon-pending": () => pendingIcons,
        ".is-preview-image-pending": () => pendingPreviewImages,
        ".is-preview-image-revealing": () => revealingPreviewImages,
      };
      const count = counts[selector]?.() || 0;
      return Array.from({ length: count }, () => ({
        classList: {
          remove(name) {
            if (name === "is-icon-pending" && pendingIcons > 0) pendingIcons -= 1;
            if (name === "is-preview-image-pending" && pendingPreviewImages > 0) pendingPreviewImages -= 1;
            if (name === "is-preview-image-revealing" && revealingPreviewImages > 0) revealingPreviewImages -= 1;
          },
        },
      }));
    },
    snapshot() {
      return {
        markup,
        pendingIconCount: pendingIcons,
        pendingPreviewImageCount: pendingPreviewImages,
        revealingPreviewImageCount: revealingPreviewImages,
        style: [...styleValues.entries()].sort(([left], [right]) => left.localeCompare(right)),
        stylePresent,
        version: card.dataset.itemVersion,
      };
    },
  };
  return card;
}

function cardSnapshot(card) {
  return card.snapshot();
}

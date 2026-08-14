import assert from "node:assert/strict";
import { createCardTransition } from "../../assets/client/card-transition.mjs";
import { createDailyBatchTransition } from "../../assets/client/daily-batch-transition.mjs";
import { nodesEqualIgnoringIconLoadState } from "../../assets/client/dom.mjs";
import { syncDailyThumb } from "../../assets/client/daily-thumb-transition.mjs";
import { syncSummaryThumb } from "../../assets/client/summary-thumb-transition.mjs";

export function runDailyCardReconciliationTests() {
  testStableCardStaysConnected();
  testChangedCardKeepsItsLiveShell();
  testTransientPointerStylesDoNotPreventReuse();
  testTransientIconLoadStateDoesNotPreventReuse();
  testTransientPreviewImageLoadStateDoesNotPreventReuse();
  testActionStateRerenderKeepsLoadedPreviewThumbs();
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

function createComparablePreviewThumb(transientClass) {
  let imageClass = transientClass;
  let imageClassAttribute = Boolean(transientClass);
  const thumb = {
    markup: "same-preview",
    removeCount: 0,
    replaceCount: 0,
    classList: {
      get length() { return 1; },
      remove() {},
    },
    cloneNode() {
      return createComparablePreviewThumb(imageClass);
    },
    isEqualNode(other) {
      return thumb.markup === other.markup
        && imageClass === other.imageClass()
        && imageClassAttribute === other.imageClassAttribute();
    },
    querySelectorAll(selector) {
      if (!imageClass || selector !== `.${imageClass}`) return [];
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
    els: { dailyBoard: { children: [], querySelectorAll: () => [] } },
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

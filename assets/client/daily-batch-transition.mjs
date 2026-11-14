import { createBatchTransition, settleBatchImages } from "./batch-transition.mjs";
import { dailyThumbTransition } from "./thumb-transition.mjs";
const { sync: syncDailyThumb } = dailyThumbTransition;

export function createDailyBatchTransition(options) {
  const snapshotLists = new Set();
  const {
    animateCardsIn,
    canReuseCard,
    clearCardAnimationState,
    dailyBoardCardSelector,
    dailyColumns,
    directDailyCards,
    getColumn,
    prefersReducedMotion,
    renderColumn,
  } = options;
  const controller = createBatchTransition({
    activeClass: "is-daily-batch-transitioning",
    documentNode: options.documentNode,
    cleanup,
    prefersReducedMotion,
    requestKey: (columnId) => dailyColumns().find((column) => column.id === columnId)?.type || columnId,
    prepare,
    settle: (contexts) => settleBatchImages([...contexts.keys()].map(getColumn)),
    update: (transitionState, columnId) => renderColumn(columnId, transitionState),
  });

  function prepare(columnId) {
    const columns = dailyColumns();
    const selected = columns.find((column) => column.id === columnId);
    return new Map(columns.filter((column) => column.type === selected?.type)
      .map((column) => [column.id, prepareColumn(column)]));
  }

  function prepareColumn(column) {
    const columnId = column.id;
    const currentColumn = getColumn(columnId);
    const currentList = currentColumn?.querySelector(":scope > .utility-card-body > .card-list");
    const currentCards = currentList ? directDailyCards(currentList) : [];
    currentCards.forEach((card) => clearCardAnimationState?.(card));
    const bounded = currentList && (currentList.closest(".dashboard-slot")?.dataset.slotSize === "compact"
      || currentList.scrollHeight > currentList.clientHeight + 1);
    if (bounded) {
      currentList.style.setProperty("view-transition-name", `today-${columnId}-viewport`);
      snapshotLists.add(currentList);
      return { columnId, bounded: true };
    }
    currentCards.forEach((card, index) => setTransitionName(card, columnId, index));
    return { columnId };
  }

  function renderCardList(currentList, nextList, transitionState) {
    const columnId = currentList.closest(".board-column")?.dataset.columnId || "";
    const currentCards = directDailyCards(currentList);
    const nextCards = directDailyCards(nextList);
    if (transitionState.columnId !== columnId
      || nextList.children.length !== nextCards.length) {
      currentList.className = nextList.className;
      currentList.replaceChildren(...nextList.childNodes);
      return;
    }

    currentList.className = nextList.className;
    for (const child of Array.from(currentList.children)) {
      if (!child.matches?.(dailyBoardCardSelector)) child.remove();
    }

    const sharedCount = Math.min(currentCards.length, nextCards.length);
    for (let index = 0; index < sharedCount; index += 1) {
      syncCard(currentCards[index], nextCards[index]);
      if (!transitionState.bounded) setTransitionName(currentCards[index], columnId, index);
    }

    for (let index = sharedCount; index < nextCards.length; index += 1) {
      if (!transitionState.bounded) setTransitionName(nextCards[index], columnId, index);
      currentList.append(nextCards[index]);
    }

    for (let index = currentCards.length - 1; index >= nextCards.length; index -= 1) {
      currentCards[index].remove();
    }
  }

  function applyCardListDiff(currentList, nextList, nextCards, { animateEntries = true } = {}) {
    const currentByKey = new Map(directDailyCards(currentList)
      .filter((card) => card.dataset.key && !card.classList.contains("is-leaving"))
      .map((card) => [card.dataset.key, card]));
    const enteringCards = [];
    const resolvedCards = nextCards.map((nextCard) => {
      const key = nextCard.dataset.key || "";
      const currentCard = currentByKey.get(key);
      if (currentCard) {
        clearCardAnimationState(nextCard);
        clearCardAnimationState(currentCard);
        return canReuseCard(currentCard, nextCard)
          ? currentCard
          : syncCard(currentCard, nextCard);
      }
      enteringCards.push(nextCard);
      return nextCard;
    });
    currentList.className = nextList.className;
    resolvedCards.forEach((card, index) => {
      if (currentList.children[index] !== card) {
        currentList.insertBefore(card, currentList.children[index] || null);
      }
    });
    while (currentList.children.length > resolvedCards.length) currentList.lastElementChild?.remove();
    if (animateEntries) animateCardsIn(enteringCards);
  }

  function syncCard(currentCard, nextCard) {
    currentCard.className = nextCard.className;
    clearCardAnimationState(currentCard);
    for (const key of Object.keys(currentCard.dataset)) delete currentCard.dataset[key];
    for (const [key, value] of Object.entries(nextCard.dataset)) currentCard.dataset[key] = value;
    currentCard.ampiraItem = nextCard.ampiraItem;
    currentCard.tabIndex = nextCard.tabIndex;
    currentCard.setAttribute("role", nextCard.getAttribute("role") || "link");
    currentCard.setAttribute("aria-label", nextCard.getAttribute("aria-label") || "");
    if (nextCard.hasAttribute("title")) currentCard.setAttribute("title", nextCard.getAttribute("title") || "");
    else currentCard.removeAttribute("title");

    syncDailyThumb(currentCard, nextCard);

    const currentContent = batchContent(currentCard);
    const nextContent = batchContent(nextCard);
    if (currentContent && nextContent) currentContent.replaceWith(nextContent);
    else if (nextContent) currentCard.append(nextContent);
    else currentContent?.remove();
    return currentCard;
  }

  function cleanup() {
    for (const list of snapshotLists) list.style.removeProperty("view-transition-name");
    snapshotLists.clear();
    const cards = dailyColumns().flatMap(({ id }) => Array.from(getColumn(id)?.querySelectorAll(
      ":scope > .utility-card-body > .card-list > .news-list-card, :scope > .utility-card-body > .card-list > .daily-card",
    ) || []));
    for (const card of cards) {
      card.style.removeProperty("view-transition-name");
    }
  }

  return { applyCardListDiff, cancel: controller.cancel, renderCardList, run: controller.run };
}

function batchContent(card) {
  return card?.querySelector?.(":scope > .daily-batch-content") || null;
}

function setTransitionName(node, columnId, index) {
  node?.style?.setProperty("view-transition-name", `today-${columnId}-card-${index + 1}`);
}

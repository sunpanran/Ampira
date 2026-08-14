import { createBatchTransition } from "./batch-transition.mjs";
import { cleanupDailyThumbTransitions, crossfadeDailyThumb, syncDailyThumb } from "./daily-thumb-transition.mjs";

export function createDailyBatchTransition(options) {
  const {
    animateCardsIn,
    canReuseCard,
    clearCardAnimationState,
    dailyBoardCardSelector,
    dailyColumns,
    directDailyCards,
    els,
    prefersReducedMotion,
    renderColumn,
  } = options;
  const controller = createBatchTransition({
    activeClass: "is-daily-batch-transitioning",
    cleanup,
    prefersReducedMotion,
    prepare,
    update: (transitionState, columnId) => renderColumn(columnId, transitionState),
  });

  function prepare(columnId) {
    const column = dailyColumns().find((candidate) => candidate.id === columnId);
    const currentColumn = Array.from(els.dailyBoard.children)
      .find((candidate) => candidate.dataset.columnId === columnId);
    const currentList = currentColumn?.querySelector(":scope > .card-list");
    const currentCards = currentList ? directDailyCards(currentList) : [];
    const nextCardCount = column?.items?.length || 0;
    currentCards.forEach((card, index) => {
      if (index < nextCardCount) setSharedTransitionNames(card, columnId, index);
      else setTransitionName(card, columnId, index);
    });
    return { columnId, nextCardCount };
  }

  function renderCardList(currentList, nextList, transitionState) {
    const columnId = currentList.closest(".board-column")?.dataset.columnId || "";
    const currentCards = directDailyCards(currentList);
    const nextCards = directDailyCards(nextList);
    if (transitionState.columnId !== columnId
      || nextList.children.length !== nextCards.length
      || nextCards.length !== transitionState.nextCardCount) {
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
      setSharedTransitionNames(nextCards[index], columnId, index);
      syncCard(currentCards[index], nextCards[index], { crossfadeThumb: columnId === "inspiration" });
    }

    for (let index = sharedCount; index < nextCards.length; index += 1) {
      setTransitionName(nextCards[index], columnId, index);
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

  function syncCard(currentCard, nextCard, { crossfadeThumb = false } = {}) {
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

    if (crossfadeThumb) crossfadeDailyThumb(currentCard, nextCard);
    else syncDailyThumb(currentCard, nextCard);

    const currentContent = batchContent(currentCard);
    const nextContent = batchContent(nextCard);
    if (currentContent && nextContent) currentContent.replaceWith(nextContent);
    else if (nextContent) currentCard.append(nextContent);
    else currentContent?.remove();
    return currentCard;
  }

  function cleanup() {
    const cards = Array.from(els.dailyBoard.querySelectorAll(
      ".board-column.is-news > .card-list > .news-list-card, .board-column.is-inspiration > .card-list > .daily-card",
    ));
    for (const card of cards) {
      card.style.removeProperty("view-transition-name");
      batchContent(card)?.style.removeProperty("view-transition-name");
      for (const { node } of sharedTransitionParts(card)) {
        node.style?.removeProperty("view-transition-name");
      }
    }
    cleanupDailyThumbTransitions(cards);
  }

  return { applyCardListDiff, cancel: controller.cancel, renderCardList, run: controller.run };
}

function batchContent(card) {
  return card?.querySelector?.(":scope > .daily-batch-content") || null;
}

function sharedTransitionParts(card) {
  const content = batchContent(card);
  if (!content) return card ? [{ node: card, suffix: "" }] : [];
  if (!content.classList?.contains("news-list-content")) return [{ node: content, suffix: "" }];
  const parts = [
    { node: content.querySelector?.(":scope > .bookmark-favicon"), suffix: "source" },
    { node: content.querySelector?.(":scope > .link-main"), suffix: "content" },
  ].filter((part) => part.node);
  return parts.length ? parts : [{ node: content, suffix: "" }];
}

function setSharedTransitionNames(card, columnId, index) {
  for (const { node, suffix } of sharedTransitionParts(card)) {
    setTransitionName(node, columnId, index, suffix);
  }
}

function setTransitionName(node, columnId, index, suffix = "") {
  const name = `today-${columnId}-card-${index + 1}`;
  node?.style?.setProperty("view-transition-name", suffix ? `${name}-${suffix}` : name);
}

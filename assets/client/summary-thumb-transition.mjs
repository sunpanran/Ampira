import { nodesEqualIgnoringTransientLoadState } from "./dom.mjs";

export const activeSummaryThumbSelector = ':scope > .thumb:not([data-summary-thumb-phase="leaving"])';

export function syncSummaryThumb(currentCard, nextCard) {
  const currentThumb = summaryThumb(currentCard);
  const nextThumb = summaryThumb(nextCard);
  if (currentThumb && nextThumb && nodesEqualIgnoringTransientLoadState(currentThumb, nextThumb)) {
    nextThumb.remove();
  } else if (currentThumb && nextThumb) {
    currentThumb.replaceWith(nextThumb);
  } else if (nextThumb) {
    currentCard.prepend(nextThumb);
  } else {
    currentThumb?.remove();
  }
}

export function crossfadeSummaryThumb(currentCard, nextCard) {
  const currentThumb = summaryThumb(currentCard);
  const nextThumb = summaryThumb(nextCard);
  if (currentThumb && nextThumb && nodesEqualIgnoringTransientLoadState(currentThumb, nextThumb)) {
    nextThumb.remove();
    return;
  }
  if (currentThumb) currentThumb.dataset.summaryThumbPhase = "leaving";
  if (!nextThumb) return;
  nextThumb.dataset.summaryThumbPhase = "entering";
  currentCard.insertBefore(nextThumb, currentCard.querySelector(":scope > .summary-card-content"));
}

export function cleanupSummaryThumbTransitions(cards) {
  for (const card of cards) {
    for (const thumb of card.querySelectorAll(':scope > .thumb[data-summary-thumb-phase="leaving"]')) {
      thumb.remove();
    }
    for (const thumb of card.querySelectorAll(':scope > .thumb[data-summary-thumb-phase="entering"]')) {
      delete thumb.dataset.summaryThumbPhase;
    }
  }
}

function summaryThumb(card) {
  return card?.querySelector?.(activeSummaryThumbSelector) || null;
}

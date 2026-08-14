import { nodesEqualIgnoringTransientLoadState } from "./dom.mjs";

export const activeDailyThumbSelector = ':scope > .inspiration-thumb:not([data-daily-thumb-phase="leaving"])';

export function syncDailyThumb(currentCard, nextCard) {
  const currentThumb = dailyThumb(currentCard);
  const nextThumb = dailyThumb(nextCard);
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

export function crossfadeDailyThumb(currentCard, nextCard) {
  const currentThumb = dailyThumb(currentCard);
  const nextThumb = dailyThumb(nextCard);
  if (currentThumb && nextThumb && nodesEqualIgnoringTransientLoadState(currentThumb, nextThumb)) {
    nextThumb.remove();
    return;
  }
  if (currentThumb) currentThumb.dataset.dailyThumbPhase = "leaving";
  if (!nextThumb) return;
  nextThumb.dataset.dailyThumbPhase = "entering";
  currentCard.insertBefore(nextThumb, currentCard.querySelector(":scope > .daily-batch-content"));
}

export function cleanupDailyThumbTransitions(cards) {
  for (const card of cards) {
    for (const thumb of card.querySelectorAll(':scope > .inspiration-thumb[data-daily-thumb-phase="leaving"]')) {
      thumb.remove();
    }
    for (const thumb of card.querySelectorAll(':scope > .inspiration-thumb[data-daily-thumb-phase="entering"]')) {
      delete thumb.dataset.dailyThumbPhase;
    }
  }
}

function dailyThumb(card) {
  return card?.querySelector?.(activeDailyThumbSelector) || null;
}

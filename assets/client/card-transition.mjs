import { prefersReducedMotion } from "./motion.mjs";

export function createCardTransition({ exitMs, enterMs }) {
  function animateCardsOut(cards) {
    let longest = exitMs;
    cards.forEach((card) => {
      const delay = 0;
      longest = Math.max(longest, delay + exitMs);
      card.classList.remove("is-entering");
      card.classList.add("is-leaving");
      card.style.setProperty("--card-motion-delay", `${delay}ms`);
      card.style.setProperty("--card-motion-duration", `${exitMs}ms`);
    });
    return longest;
  }

  function animateCardsIn(cards) {
    if (prefersReducedMotion()) return;
    cards.forEach((card, index) => {
      const delay = Math.min(index * 32, 96);
      card.classList.remove("is-leaving");
      card.classList.add("is-entering");
      card.style.setProperty("--card-motion-delay", `${delay}ms`);
      card.style.setProperty("--card-motion-duration", `${enterMs}ms`);
      card.addEventListener("animationend", () => {
        card.classList.remove("is-entering");
        card.style.removeProperty("--card-motion-delay");
        card.style.removeProperty("--card-motion-duration");
      }, { once: true });
    });
  }

  function clearCardAnimationState(card) {
    card.classList.remove("is-entering", "is-leaving");
    card.style.removeProperty("--card-motion-delay");
    card.style.removeProperty("--card-motion-duration");
  }

  function setCardItemIdentity(card, item) {
    card.dataset.key = String(item?.key || "");
    card.dataset.itemVersion = cardItemVersion(item);
  }

  function canReuseCard(currentCard, nextCard) {
    return Boolean(nextCard.dataset.itemVersion)
      && currentCard.dataset.itemVersion === nextCard.dataset.itemVersion
      && currentCard.isEqualNode(nextCard);
  }

  return {
    animateCardsIn,
    animateCardsOut,
    canReuseCard,
    clearCardAnimationState,
    prefersReducedMotion,
    setCardItemIdentity,
  };
}

function cardItemVersion(item) {
  let text;
  try {
    text = JSON.stringify(item) || "";
  } catch {
    return "";
  }
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

import { nodesEqualIgnoringTransientLoadState } from "./dom.mjs";

export const dailyThumbTransition = createThumbTransition(".inspiration-thumb");
export const summaryThumbTransition = createThumbTransition(".thumb");

function createThumbTransition(selector) {
  const activeSelector = `:scope > ${selector}`;
  const thumbOf = card => card?.querySelector?.(activeSelector) || null;

  function sync(currentCard, nextCard) {
    const current = thumbOf(currentCard);
    const next = thumbOf(nextCard);
    if (current && next && nodesEqualIgnoringTransientLoadState(current, next)) next.remove();
    else if (current && next) current.replaceWith(next);
    else if (next) currentCard.prepend(next);
    else current?.remove();
  }

  return { activeSelector, sync };
}

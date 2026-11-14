import { FOCUS_STATE_KEY, normalizeFocusState } from "../../extension/core/focus.mjs";
import { createPersonalCardState } from "./personal-card-state.mjs";

export function createFocusCardState(options) {
  return createPersonalCardState({ ...options, kind: "focus", key: FOCUS_STATE_KEY, normalize: normalizeFocusState });
}

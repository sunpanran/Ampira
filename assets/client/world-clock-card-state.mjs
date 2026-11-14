import { WORLD_CLOCK_STATE_KEY, normalizeWorldClockState } from "../../extension/core/world-clock.mjs";
import { createSyncedPersonalCardState } from "./synced-personal-card-state.mjs";

export function createWorldClockCardState(options) {
  return createSyncedPersonalCardState({ ...options, kind: "worldClock", key: WORLD_CLOCK_STATE_KEY, normalize: normalizeWorldClockState });
}

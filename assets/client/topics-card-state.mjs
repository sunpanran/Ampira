import { TRACKED_TOPICS_KEY, normalizeTrackedTopics } from "../../extension/core/tracked-topics.mjs";
import { createPersonalCardState } from "./personal-card-state.mjs";

export function createTopicsCardState(options) {
  return createPersonalCardState({ ...options, kind: "topics", key: TRACKED_TOPICS_KEY, normalize: normalizeTrackedTopics });
}

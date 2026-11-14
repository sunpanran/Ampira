import { NOTES_STATE_KEY, normalizeNotesState } from "../../extension/core/notes.mjs";
import { createSyncedPersonalCardState } from "./synced-personal-card-state.mjs";

export function createNotesCardState(options) {
  return createSyncedPersonalCardState({ ...options, kind: "notes", key: NOTES_STATE_KEY, normalize: normalizeNotesState });
}

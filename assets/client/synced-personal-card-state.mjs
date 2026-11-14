import { createPersonalCardState } from "./personal-card-state.mjs";

export function createSyncedPersonalCardState(options) {
  let syncError = null;
  const shared = createPersonalCardState({ ...options, request: async message => {
    const result = await options.request(message);
    if (Object.hasOwn(result, "syncError")) syncError = result.syncError;
    return result;
  } });
  return { ...shared, read: () => ({ ...shared.read(), syncError }), clearSyncError: () => { syncError = null; },
    retrySync: () => shared.change({ type: "sync" }) };
}

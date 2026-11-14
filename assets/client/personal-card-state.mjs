import { applyExternalStoragePatch, flushStorage, readJson } from "./storage.mjs";

export function createPersonalCardState({ kind, key, normalize, request, notify, onValues = () => {}, initialState = readJson(key, null) }) {
  let value = normalize(initialState), loaded = false, error = null, pending = null;
  function accept(result) {
    const next = normalize(result.state);
    if (next.revision >= value.revision) {
      value = next;
      if (result.values) { applyExternalStoragePatch(result.values); onValues(result.values); }
    }
    loaded = true; error = null;
    return result;
  }
  function send(type, action) {
    pending = Promise.resolve().then(() => action ? flushStorage() : undefined)
      .then(() => request({ type, payload: { kind, ...(action ? { action } : {}) } }))
      .then(accept).catch(reason => { error = reason; return { ok: false, reason: "request", error: reason }; })
      .finally(() => { pending = null; notify(); });
    notify(); return pending;
  }
  return {
    read: () => ({ value, loaded, error, busy: Boolean(pending) }),
    ensure({ force = false } = {}) {
      if (pending) return pending;
      if (!force && (loaded || error)) return Promise.resolve();
      return send("personal-cards:get");
    },
    change(action) {
      if (pending) return Promise.resolve({ ok: false, reason: "busy" });
      return send("personal-cards:change", action);
    },
    syncFromStorage() {
      const next = normalize(readJson(key, null));
      if (next.revision < value.revision || JSON.stringify(next) === JSON.stringify(value)) return;
      value = next; loaded = true; error = null; notify();
    },
  };
}

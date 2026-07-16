const KEY_PATTERN = /^dash\.[A-Za-z0-9._-]{1,91}$/;
const MAX_VALUE_BYTES = 512 * 1024;
const MAX_STATE_BYTES = 2 * 1024 * 1024;
const MAX_PATCH_ENTRIES = 100;

export function createClientStateStore(adapters) {
  let writeQueue = Promise.resolve();

  return {
    async read() {
      await writeQueue;
      return adapters.getRecord("client-state", {});
    },
    reset() {
      return enqueue(() => persist({}));
    },
    save(payload = {}) {
      return enqueue(async () => {
        const patch = normalizePatch(payload.values);
        const current = payload.replace === true ? {} : await adapters.getRecord("client-state", {});
        const next = { ...current, ...patch };
        await persist(next);
        return { ok: true };
      });
    },
    mutate(action) {
      if (typeof action !== "function") {
        return Promise.reject(stateError("INVALID_CLIENT_STATE", "background.error.clientStateInvalid"));
      }
      return enqueue(async () => {
        const stored = await adapters.getRecord("client-state", {});
        const current = stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
        const outcome = await action(Object.freeze({ ...current })) || {};
        const patch = normalizePatch(outcome.values || {});
        if (Object.keys(patch).length) await persist({ ...current, ...patch });
        return outcome.result;
      });
    },
  };

  async function persist(value) {
    if (byteLength(JSON.stringify(value)) > MAX_STATE_BYTES) {
      throw stateError("CLIENT_STATE_TOO_LARGE", "background.error.clientStateTooLarge");
    }
    await adapters.setRecord("client-state", value, "state");
  }

  function enqueue(action) {
    const operation = writeQueue.then(action);
    writeQueue = operation.catch(() => {});
    return operation;
  }
}

export function normalizeClientStatePatch(values) {
  return normalizePatch(values);
}

function normalizePatch(values) {
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    throw stateError("INVALID_CLIENT_STATE", "background.error.clientStateInvalid");
  }
  const entries = Object.entries(values);
  if (entries.length > MAX_PATCH_ENTRIES) throw stateError("INVALID_CLIENT_STATE", "background.error.clientStateInvalid");
  const patch = {};
  for (const [key, value] of entries) {
    if (!KEY_PATTERN.test(key) || typeof value !== "string" || byteLength(value) > MAX_VALUE_BYTES) {
      throw stateError("INVALID_CLIENT_STATE", "background.error.clientStateInvalid");
    }
    patch[key] = value;
  }
  return patch;
}

function stateError(code, messageKey) {
  const error = new Error(code);
  error.code = code;
  error.messageKey = messageKey;
  error.messageParams = {};
  error.retryable = false;
  return error;
}

function byteLength(value) {
  return new TextEncoder().encode(String(value)).byteLength;
}

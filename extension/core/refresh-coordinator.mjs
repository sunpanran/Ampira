export function createRefreshCoordinator(options = {}) {
  const getStatus = typeof options.getStatus === "function" ? options.getStatus : async () => ({});
  let run = typeof options.run === "function" ? options.run : async () => {};
  const isFresh = typeof options.isFresh === "function" ? options.isFresh : () => false;
  let active = null;
  let queuedForce = false;
  let queuedOptions = {};
  let generation = 0;

  function complete(state) {
    if (active !== state) return;
    active = null;
    if (!queuedForce) return;
    queuedForce = false;
    start(true, queuedOptions).catch(() => {});
  }

  async function start(force = false, runOptions = {}) {
    if (active) {
      if (force) { queuedForce = true; queuedOptions = runOptions; }
      return { started: false, queued: queuedForce, status: await getStatus() };
    }

    const state = { operation: null, controller: new AbortController() };
    active = state;
    try {
      const previous = await getStatus();
      if (state.controller.signal.aborted) {
        complete(state);
        return { started: false, status: previous };
      }
      if (!force && isFresh(previous)) {
        complete(state);
        return { started: false, status: previous };
      }

      const currentGeneration = ++generation;
      const operation = Promise.resolve()
        .then(() => run(currentGeneration, { ...runOptions, force, signal: state.controller.signal }))
        .catch(() => {});
      state.operation = operation;
      operation.then(() => complete(state));
      return { started: true, status: await getStatus() };
    } catch (error) {
      if (!state.operation) complete(state);
      throw error;
    }
  }

  return {
    start,
    setRun(nextRun) {
      if (active) throw new Error("REFRESH_RUNNER_ACTIVE");
      run = typeof nextRun === "function" ? nextRun : async () => {};
    },
    invalidate() {
      generation += 1;
      queuedForce = false;
      active?.controller.abort();
    },
    isCurrent(value) {
      return value === generation;
    },
  };
}

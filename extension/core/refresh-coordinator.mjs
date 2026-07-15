export function createRefreshCoordinator(options = {}) {
  const getStatus = typeof options.getStatus === "function" ? options.getStatus : async () => ({});
  let run = typeof options.run === "function" ? options.run : async () => {};
  const isFresh = typeof options.isFresh === "function" ? options.isFresh : () => false;
  let active = null;
  let queuedForce = false;
  let generation = 0;

  function complete(state) {
    if (active !== state) return;
    active = null;
    if (!queuedForce) return;
    queuedForce = false;
    start(true).catch(() => {});
  }

  async function start(force = false) {
    if (active) {
      if (force) queuedForce = true;
      return { started: false, queued: queuedForce, status: await getStatus() };
    }

    const state = { operation: null };
    active = state;
    try {
      const previous = await getStatus();
      if (!force && isFresh(previous)) {
        complete(state);
        return { started: false, status: previous };
      }

      const currentGeneration = ++generation;
      const operation = Promise.resolve()
        .then(() => run(currentGeneration, { force }))
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
    },
    isCurrent(value) {
      return value === generation;
    },
  };
}

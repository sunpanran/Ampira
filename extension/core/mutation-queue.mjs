export function createEpochMutationQueue() {
  let epoch = 0;
  let tail = Promise.resolve();

  function run(action, expectedEpoch) {
    if (typeof action !== "function") throw new TypeError("Mutation action must be a function.");
    const guarded = arguments.length > 1;
    const execute = async () => {
      const isCurrent = () => !guarded || expectedEpoch === epoch;
      if (!isCurrent()) return undefined;
      return action(isCurrent);
    };
    const operation = tail.then(execute, execute);
    tail = operation.catch(() => {});
    return operation;
  }

  return {
    capture() {
      return epoch;
    },
    invalidate() {
      epoch += 1;
      return epoch;
    },
    isCurrent(value) {
      return value === epoch;
    },
    run,
  };
}

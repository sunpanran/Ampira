export function createActionPort(methodNames) {
  let target = null;
  const port = {
    bind(nextTarget) {
      target = nextTarget;
    },
  };
  for (const methodName of methodNames) {
    port[methodName] = (...args) => {
      if (typeof target?.[methodName] !== "function") {
        throw new Error(`Action port is not bound: ${methodName}`);
      }
      return target[methodName](...args);
    };
  }
  return Object.freeze(port);
}

export function createLazyController({ load, onError = () => {}, onLoading = () => {} }) {
  let controller = null;
  let pending = null;
  let openGeneration = 0;

  function ensure() {
    if (controller) return Promise.resolve(controller);
    if (!pending) {
      pending = Promise.resolve().then(load).then((value) => {
        controller = value;
        return value;
      }).finally(() => { pending = null; });
    }
    return pending;
  }

  return {
    async open(...args) {
      const generation = ++openGeneration;
      onLoading(true);
      try {
        const loaded = await ensure();
        if (generation !== openGeneration) return false;
        loaded.open(...args);
        return true;
      } catch (error) {
        if (generation === openGeneration) onError(error);
        return false;
      } finally {
        if (generation === openGeneration) onLoading(false);
      }
    },
    close() {
      openGeneration += 1;
      onLoading(false);
      controller?.close();
    },
    call(method, ...args) {
      return controller?.[method]?.(...args);
    },
  };
}

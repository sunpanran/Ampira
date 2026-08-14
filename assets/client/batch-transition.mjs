export function createBatchTransition(options) {
  const {
    activeClass,
    update,
    prepare = () => undefined,
    cleanup = () => {},
    prefersReducedMotion,
    documentNode = globalThis.document,
  } = options;
  let requestToken = 0;
  let activeTransition = null;
  let visualStateActive = false;

  function run(request) {
    const token = ++requestToken;
    const previousTransition = activeTransition;
    activeTransition = null;
    previousTransition?.skipTransition?.();
    clearVisualState();

    const updateLatest = (context) => {
      if (token !== requestToken) return;
      update(context, request);
    };

    if (!documentNode
      || typeof documentNode.startViewTransition !== "function"
      || documentNode.visibilityState === "hidden"
      || prefersReducedMotion()) {
      updateLatest();
      return null;
    }

    let transition;
    try {
      visualStateActive = true;
      const context = prepare(request);
      documentNode.documentElement?.classList?.add(activeClass);
      transition = documentNode.startViewTransition(() => updateLatest(context));
    } catch {
      clearVisualState();
      updateLatest();
      return null;
    }

    activeTransition = transition;
    transition.ready?.catch?.(() => {});
    transition.finished?.then?.(
      () => finishTransition(transition),
      () => finishTransition(transition),
    );
    return transition;
  }

  function cancel() {
    requestToken += 1;
    const transition = activeTransition;
    activeTransition = null;
    transition?.skipTransition?.();
    clearVisualState();
  }

  function finishTransition(transition) {
    if (activeTransition !== transition) return;
    activeTransition = null;
    clearVisualState();
  }

  function clearVisualState() {
    if (visualStateActive) {
      visualStateActive = false;
      try {
        cleanup();
      } catch {
        // Cleanup must not prevent the latest batch from rendering.
      }
    }
    documentNode?.documentElement?.classList?.remove(activeClass);
  }

  return { cancel, run };
}

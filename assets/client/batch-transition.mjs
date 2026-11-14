import { prepareImageForSnapshot } from "./async-image-reveal.mjs";
import { MOTION_DURATION } from "./motion.mjs";

const documentTransitions = new WeakMap();

export function settleBatchImages(roots) {
  const captures = roots.flatMap(root => Array.from(root?.querySelectorAll?.("img.is-preview-image-pending, img.is-preview-image-revealing") || []))
    .filter(image => {
      if (image.complete || !image.getBoundingClientRect) return true;
      const rect = image.getBoundingClientRect();
      const viewport = image.ownerDocument.defaultView;
      return rect.width > 0 && rect.height > 0 && rect.top < viewport.innerHeight && rect.bottom > 0
        && rect.left < viewport.innerWidth && rect.right > 0;
    })
    .map(image => {
      if (image.loading === "lazy") image.loading = "eager";
      return image;
    })
    .map(prepareImageForSnapshot).filter(Boolean);
  if (!captures.length) return;
  let timer;
  // Keep the old snapshot visible during decode, but never wait on a slow network image.
  return Promise.race([
    Promise.allSettled(captures.map(capture => capture.ready)),
    new Promise(resolve => { timer = setTimeout(resolve, MOTION_DURATION.press); }),
  ]).finally(() => {
    clearTimeout(timer);
    captures.forEach(capture => capture.release());
  });
}

export function createBatchTransition(options) {
  const {
    activeClass,
    update,
    prepare = () => undefined,
    cleanup = () => {},
    settle = () => undefined,
    requestKey = (request) => request,
    prefersReducedMotion,
    documentNode = globalThis.document,
  } = options;
  let requestToken = 0;
  let activeTransition = null;
  let visualStateActive = false;
  let pendingUpdate = null;
  let queuedRequest = null;
  let activeRequestKey;
  let motionQuery = null;
  const owner = { finish: finishImmediately };

  function run(request) {
    const key = requestKey(request);
    if (activeTransition && !pendingUpdate && activeRequestKey === key) {
      // Let the visible crossfade finish; coalesce repeated clicks into its latest successor.
      queuedRequest = { request };
      return activeTransition;
    }
    // A different column must not lose its requested batch when another takes over.
    if (activeRequestKey !== key) finishImmediately();
    cancel();
    documentTransitions.get(documentNode)?.finish();
    const token = ++requestToken;
    let updated = false;
    const updateLatest = (context) => {
      if (token !== requestToken || updated) return;
      updated = true;
      pendingUpdate = null;
      update(context, request);
      if (context) return settle(context, request);
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
      activeRequestKey = key;
      pendingUpdate = () => updateLatest();
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
    documentTransitions.set(documentNode, owner);
    documentNode.addEventListener?.("visibilitychange", onMotionChange);
    motionQuery = documentNode.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)");
    motionQuery?.addEventListener?.("change", onMotionChange);
    transition.ready?.catch?.(() => {});
    transition.updateCallbackDone?.catch?.(() => {});
    transition.finished?.then?.(
      () => finishTransition(transition),
      () => finishTransition(transition),
    );
    return transition;
  }

  function cancel() {
    requestToken += 1;
    pendingUpdate = null;
    queuedRequest = null;
    const transition = activeTransition;
    activeTransition = null;
    transition?.skipTransition?.();
    clearVisualState();
  }

  function finishImmediately() {
    if (queuedRequest) update(undefined, queuedRequest.request);
    else pendingUpdate?.();
    cancel();
  }

  function onMotionChange() {
    if (documentNode.visibilityState === "hidden" || prefersReducedMotion()) finishImmediately();
  }

  function finishTransition(transition) {
    if (activeTransition !== transition) return;
    activeTransition = null;
    const next = queuedRequest;
    queuedRequest = null;
    clearVisualState();
    if (next) run(next.request);
  }

  function clearVisualState() {
    documentNode?.removeEventListener?.("visibilitychange", onMotionChange);
    motionQuery?.removeEventListener?.("change", onMotionChange);
    motionQuery = null;
    if (documentTransitions.get(documentNode) === owner) documentTransitions.delete(documentNode);
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

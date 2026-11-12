const MODEL_SETTINGS = [
  "newsSourceMode", "newsBookmarkFolder", "inspirationSourceMode", "inspirationBookmarkFolder",
  "bookmarkOnlyFolders", "excludedNewsSources", "newsEntriesPerCategory",
];

export function createBookmarkModelCache({ readTree, buildModel, now = () => new Date() }) {
  let generation = 0;
  let treePromise = null;
  let cached = null;

  function invalidate() {
    generation += 1;
    treePromise = null;
    cached = null;
  }

  async function currentTree() {
    const version = generation;
    if (!treePromise) {
      const pending = Promise.resolve().then(readTree);
      treePromise = pending;
      pending.catch(() => {
        if (treePromise === pending) treePromise = null;
      });
    }
    const tree = await treePromise;
    return version === generation ? tree : currentTree();
  }

  async function get(settings, locale) {
    const date = now();
    const day = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    const modelSettings = Object.fromEntries(MODEL_SETTINGS.map((key) => [key, settings[key]]));
    const settingsKey = JSON.stringify(modelSettings);
    const key = JSON.stringify([generation, day, locale, settingsKey]);
    if (cached?.key === key) return cached.promise;
    const version = generation;
    const promise = currentTree().then((tree) => {
      if (version !== generation) return get(settings, locale);
      return buildModel(tree, JSON.parse(settingsKey), locale);
    });
    cached = { key, promise };
    promise.catch(() => {
      if (cached?.promise === promise) cached = null;
    });
    return promise;
  }

  return { get, invalidate, currentTree };
}

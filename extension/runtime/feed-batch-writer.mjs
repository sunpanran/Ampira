// Flush the first source immediately, then coalesce nearby completions. A slow
// source must not hold the already fetched text or a partially filled batch.
export function createFeedBatchWriter(commit, { size = 4, delayMs = 400 } = {}) {
  let pending = [], tail = Promise.resolve(), timer = null, started = false, failure = null, closed = false;
  function flush() {
    clearTimeout(timer);
    timer = null;
    if (!pending.length) return;
    const batch = pending;
    pending = [];
    started = true;
    tail = tail.then(() => failure ? undefined : commit(batch)).catch(error => { failure = error; });
  }
  return {
    add(value) {
      if (closed) return;
      pending.push(value);
      if (!started || pending.length >= size) flush();
      else if (timer === null) timer = setTimeout(flush, delayMs);
    },
    async finish() {
      closed = true;
      flush();
      await tail;
      if (failure) throw failure;
    },
    async cancel() {
      closed = true;
      clearTimeout(timer);
      timer = null;
      pending = [];
      await tail;
    },
  };
}

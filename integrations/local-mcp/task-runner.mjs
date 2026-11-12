import { runCodexTask } from "./codex-runner.mjs";

// Store events wake the worker. No model polling, parallel jobs or automatic failure retries.
export async function startTaskRunner(store, { execute = runCodexTask } = {}) {
  await store.recoverRunner();
  let active, stopped = false, scheduled = false, dirty = false, controller;
  const unsubscribe = store.subscribe(wake);
  wake();
  return { close: async () => {
    stopped = true; unsubscribe(); controller?.abort();
    await active;
  } };

  function wake() {
    dirty = true;
    if (controller && store.runnerStatus().status !== "running") controller.abort();
    if (stopped || active || scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (stopped || active) return;
      active = drain().catch(() => {}).finally(() => { active = null; if (dirty && !stopped) wake(); });
    });
  }
  async function drain() {
    while (!stopped) {
      dirty = false;
      const job = await store.beginRunnerTask();
      if (!job) return;
      controller = new AbortController();
      try {
        const result = await execute(job.task, { ...job.config, signal: controller.signal });
        if (stopped) throw Object.assign(new Error("interrupted"), { code: "interrupted" });
        await store.completeRunnerTask(job.runId, result);
      } catch (error) {
        const code = String(error.code || "");
        await store.failRunnerTask(job.runId, code.startsWith("invalid-") || code === "reply-too-large" ? "invalidResult" : code || "invalidResult");
        dirty = store.runnerStatus().status === "idle";
        return;
      } finally { controller = null; }
    }
  }
}

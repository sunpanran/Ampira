export function createRuntimeStatusStore({ getRecord, setRecord, broadcast, createStages, readUsage = async () => undefined }) {
  async function getRefreshStatus() {
    return getRecord("refresh-status", defaultRefreshStatus());
  }

  async function setRefreshStatus(status) {
    await setRecord("refresh-status", status, "state");
    return status;
  }

  async function getAiAutoStatus() {
    return { ...defaultAiAutoStatus(), ...(await getRecord("ai-auto-status", null) || {}) };
  }

  async function setAiAutoStatus(status, notify = true, { contentChanged = false } = {}) {
    const normalized = { ...defaultAiAutoStatus(), ...status };
    await setRecord("ai-auto-status", normalized, "state");
    if (notify) broadcast("dashboard.ai-progress", { autoStatus: normalized, usedToday: await readUsage(), contentChanged });
    return normalized;
  }

  function defaultAiAutoStatus() {
    return {
      phase: "never", running: false, processed: 0, total: 0, eligible: 0,
      attempted: 0, failed: 0, deferred: 0,
      startedAt: "", lastRunAt: "", errorKey: "", errorParams: {}, errorStage: "",
    };
  }

  function defaultRefreshStatus(messageKey = "background.waitingFirstRefresh") {
    return {
      running: false, startedAt: "", finishedAt: "", total: 0, completed: 0,
      failed: 0, excluded: 0, progress: 0, message: "", messageKey, messageParams: {},
      stages: createStages("complete"),
    };
  }

  return { getRefreshStatus, setRefreshStatus, getAiAutoStatus, setAiAutoStatus, defaultAiAutoStatus, defaultRefreshStatus };
}

const OPTIONAL_PERMISSIONS = Object.freeze(["favicon", "search"]);

export function createFactoryResetService(options) {
  const {
    chrome,
    cacheMutations,
    refreshCoordinator,
    permissionEpoch,
    contentSyncService,
    clientStateStore,
    waitForActiveRequests = async () => {},
    clearSyncStorage = () => chrome.storage.sync.clear(),
    clearRecords,
    setResetting = () => {},
    broadcast = () => {},
    schedule = (callback) => setTimeout(callback, 0),
  } = options;
  let resetPromise = null;

  return { factoryReset };

  function factoryReset() {
    if (resetPromise) return resetPromise;
    resetPromise = performFactoryReset().finally(() => {
      resetPromise = null;
    });
    return resetPromise;
  }

  async function performFactoryReset() {
    const failedSteps = [];
    let grantedPermissions = null;
    setResetting(true);
    cacheMutations.invalidate();
    refreshCoordinator.invalidate();
    permissionEpoch.next();

    try {
      await attempt("active-requests", () => waitForActiveRequests(), failedSteps);
      grantedPermissions = await attempt("permissions-read", () => chrome.permissions.getAll(), failedSteps);
      await attempt("content-sync", () => contentSyncService.reset(), failedSteps);
      await attempt("client-state", () => clientStateStore.reset(), failedSteps);
      await attempt("sync-storage", () => clearSyncStorage(), failedSteps);
      await attempt("local-storage", () => chrome.storage.local.clear(), failedSteps);
      if (chrome.storage.session?.clear) {
        await attempt("session-storage", () => chrome.storage.session.clear(), failedSteps);
      }
      await attempt("indexed-db", () => clearRecords(), failedSteps);
      if (grantedPermissions) {
        await attempt("optional-permissions", () => removeOptionalPermissions(chrome, grantedPermissions), failedSteps);
      }
    } finally {
      setResetting(false);
    }

    if (failedSteps.length) {
      broadcast("settings.changed", { factoryResetIncomplete: true });
      broadcast("dashboard.updated", { reason: "factory-reset-incomplete" });
      throw factoryResetError(failedSteps);
    }

    schedule(() => broadcast("settings.factory-reset", { reason: "factory-reset" }));
    return { ok: true };
  }
}

async function attempt(step, action, failedSteps) {
  try {
    return await action();
  } catch {
    failedSteps.push(step);
    return null;
  }
}

async function removeOptionalPermissions(chrome, granted = {}) {
  const grantedNames = new Set(Array.isArray(granted.permissions) ? granted.permissions : []);
  const permissions = OPTIONAL_PERMISSIONS.filter((permission) => grantedNames.has(permission));
  const origins = uniqueStrings(granted.origins);
  if (!permissions.length && !origins.length) return true;
  const removed = await chrome.permissions.remove({
    ...(permissions.length ? { permissions } : {}),
    ...(origins.length ? { origins } : {}),
  });
  if (removed !== true) throw new Error("OPTIONAL_PERMISSIONS_NOT_REMOVED");
  return true;
}

function factoryResetError(failedSteps) {
  const error = new Error("FACTORY_RESET_INCOMPLETE");
  error.code = "FACTORY_RESET_INCOMPLETE";
  error.messageKey = "background.error.factoryResetIncomplete";
  error.messageParams = { count: failedSteps.length };
  error.retryable = true;
  error.details = { failedSteps: [...failedSteps] };
  return error;
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean))];
}

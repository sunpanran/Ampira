import { CONTENT_SYNC_META_KEY, CONTENT_SYNC_DATASETS } from "../core/content-sync.mjs";
import { buildManualSyncPlan } from "../core/manual-sync-plan.mjs";
import { syncSettingsValue } from "../core/sync-snapshot.mjs";
import { stableSyncValue, syncError, syncValueDigest } from "../core/sync-values.mjs";
import { removeUnusedSettingsChunks } from "../core/settings-storage.mjs";
import { encodeSyncedCredentials } from "../core/credential-sync.mjs";

export const SYNC_RECOVERY_KEY = "ampira.sync-recovery.local.v1";
const TOKEN_LIFETIME_MS = 5 * 60 * 1000;

export function createManualSyncService(options) {
  const {
    storage, localStorage, settingsStore, contentSyncService, clientStateStore, withCredentialTransaction,
    getRecord, setRecord, broadcast = () => {}, onApplied = async () => {}, isResetting = () => false,
    now = () => Date.now(), randomUUID = () => crypto.randomUUID(),
  } = options;
  const previews = new Map();
  let recoveryChecked = false, recoveryPromise = null;

  return { preview, apply, recover, isReady: () => recoveryChecked, invalidate: () => previews.clear() };

  function locked(action, finish = async () => {}, abort = async () => {}) {
    return settingsStore.exclusive(settings => contentSyncService.runExclusive(() => withCredentialTransaction(async credentials => {
      try {
        const result = await clientStateStore.mutate(state => action({ settings, credentials, state }));
        await finish();
        return result;
      } catch (error) {
        await abort();
        throw error;
      }
    })));
  }

  async function finalize(plan) {
    if (plan) {
      await removeUnusedSettingsChunks(storage, plan.removals);
      await localStorage.remove(SYNC_RECOVERY_KEY);
    }
    recoveryChecked = true;
  }

  async function snapshot(context, direction) {
    const [settings, records, credentials, metadata] = await Promise.all([
      context.settings.readLocal({ allowInvalidSync: direction === "clear" }), storage.get(null), context.credentials.capture(),
      getRecord(CONTENT_SYNC_META_KEY, { version: 1, datasets: {} }),
    ]);
    return { settings: syncSettingsValue(settings), records, credentials, metadata, state: context.state };
  }

  async function preview({ direction } = {}) {
    if (isResetting()) throw syncError("busy");
    await recover();
    return locked(async context => {
      const current = await snapshot(context, direction);
      const plan = await buildManualSyncPlan(current, direction, now(), randomUUID());
      const token = randomUUID();
      for (const [key, value] of previews) if (value.expires <= now()) previews.delete(key);
      while (previews.size >= 8) previews.delete(previews.keys().next().value);
      if (plan.hasChanges) previews.set(token, { plan, fingerprint: await fingerprint(current), expires: now() + TOKEN_LIFETIME_MS });
      return { result: { direction, token: plan.hasChanges ? token : "", hasChanges: plan.hasChanges, rows: plan.rows } };
    });
  }

  async function apply({ token } = {}) {
    if (isResetting()) throw syncError("busy");
    await recover();
    const prepared = previews.get(token);
    previews.delete(token);
    if (!prepared || prepared.expires <= now()) throw syncError("stale");
    const plan = prepared.plan;
    let journalWritten = false, published = false;
    try {
      await locked(async context => {
        const current = await snapshot(context, plan.direction);
        if (isResetting() || await fingerprint(current) !== prepared.fingerprint) throw syncError("stale");
        const journal = { version: 1, plan, before: localBaseline(current, plan), createdAt: now() };
        await localStorage.set({ [SYNC_RECOVERY_KEY]: journal });
        journalWritten = true;
        recoveryChecked = false;
        if (plan.direction === "upload") {
          await storage.set(plan.writes);
          published = true;
        } else if (plan.direction === "clear") {
          await storage.clear();
          published = true;
        }
        await applyLocal(context, plan);
        return { values: plan.values };
      }, () => finalize(plan), async () => {
        if (journalWritten && plan.direction !== "download" && !published) {
          try { await localStorage.remove(SYNC_RECOVERY_KEY); recoveryChecked = true; } catch { /* Recovery still owns the retained journal. */ }
        }
      });
    } catch (error) {
      if (journalWritten) throw syncError(plan.direction === "clear" ? "clearFailed" : "partial");
      throw error;
    }
    previews.clear();
    await notify(plan);
    return { direction: plan.direction, rows: plan.rows };
  }

  async function applyLocal(context, plan) {
    if (plan.settings) await context.settings.applyLocal(plan.settings, plan.settingsSource);
    if (plan.credentials) await context.credentials.applyLocal(plan.credentials);
    await setRecord(CONTENT_SYNC_META_KEY, plan.metadata, "state");
  }

  function recover() {
    if (recoveryChecked) return Promise.resolve();
    if (recoveryPromise) return recoveryPromise;
    recoveryPromise = performRecovery().finally(() => { recoveryPromise = null; });
    return recoveryPromise;
  }

  async function performRecovery() {
    if (!(await localStorage.get(SYNC_RECOVERY_KEY))[SYNC_RECOVERY_KEY]) {
      recoveryChecked = true;
      return;
    }
    let recoveredPlan = null;
    await locked(async context => {
      const journal = (await localStorage.get(SYNC_RECOVERY_KEY))[SYNC_RECOVERY_KEY];
      if (!journal) return {};
      if (journal.version !== 1 || !journal.plan || !journal.before) {
        await localStorage.remove(SYNC_RECOVERY_KEY);
        throw syncError("partial");
      }
      const { plan, before } = journal;
      const current = await snapshot(context, plan.direction);
      // A sync submission has no cloud acknowledgement. Recovery only completes
      // local bookkeeping for the exact published records, never resubmits them.
      if (plan.direction === "upload" && Object.entries(plan.writes).some(([key, value]) => !same(current.records[key], value))) {
        await localStorage.remove(SYNC_RECOVERY_KEY);
        throw syncError("partial");
      }
      if (plan.direction === "clear" && Object.keys(current.records).length) {
        await localStorage.remove(SYNC_RECOVERY_KEY);
        throw syncError("clearFailed");
      }
      const credentials = credentialValue(current.credentials);
      const values = {};
      let conflict = false;
      for (const [key, value] of Object.entries(plan.values)) {
        if (same(current.state[key], before.state[key]) || same(current.state[key], value)) values[key] = value;
        else conflict = true;
      }
      if (plan.settings && !same(current.settings, before.settings) && !same(current.settings, plan.settings)) conflict = true;
      if (plan.credentials && !sameCredentials(credentials, before.credentials) && !sameCredentials(credentials, plan.credentials)) conflict = true;
      if (!same(current.metadata, before.metadata) && !same(current.metadata, plan.metadata)) conflict = true;
      if (conflict) {
        await localStorage.remove(SYNC_RECOVERY_KEY);
        throw syncError("partial");
      }
      await applyLocal(context, plan);
      recoveredPlan = plan;
      return { values };
    }, () => finalize(recoveredPlan));
    if (recoveredPlan) await notify(recoveredPlan);
  }

  async function notify(plan) {
    await onApplied(plan).catch(() => {});
    if (Object.keys(plan.values).length) broadcast("content-sync.changed", { values: plan.values });
    broadcast("settings.changed", { manualSyncChanged: true, imageSearchChanged: Boolean(plan.credentials) });
    broadcast("dashboard.updated", { reason: "manual-sync" });
  }
}

function credentialValue(snapshot) {
  if (!snapshot.providerExists) return null;
  const { credentialGeneration: _generation, schemaVersion: _version, ...provider } = snapshot.provider;
  return { provider, secrets: snapshot.secrets || { braveSearchApiKey: "" } };
}

function localBaseline(snapshot, plan) {
  return {
    settings: plan.settings ? snapshot.settings : null,
    state: Object.fromEntries(Object.keys(plan.values).map(key => [key, snapshot.state[key]])),
    credentials: plan.credentials ? credentialValue(snapshot.credentials) : null, metadata: snapshot.metadata,
  };
}

async function fingerprint(value) {
  const state = Object.fromEntries(Object.values(CONTENT_SYNC_DATASETS)
    .filter(definition => value.settings[definition.flag] === true)
    .map(definition => [definition.localKey, value.state[definition.localKey]]));
  return syncValueDigest({ ...value, state });
}

function same(a, b) { return stableSyncValue(a) === stableSyncValue(b); }

function sameCredentials(a, b) {
  return same(a && encodeSyncedCredentials(a.provider, a.secrets), b && encodeSyncedCredentials(b.provider, b.secrets));
}

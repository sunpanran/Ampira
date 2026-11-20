import { SYNC_CREDENTIALS_KEY } from "./constants.mjs";
import { encodeSyncedCredentials, decodeSyncedCredentials, assertCredentialSyncBudget } from "./credential-sync.mjs";
import { assertSyncStorageBudget } from "./sync-budget.mjs";
import { prepareSettingsSyncWrite, readCompleteSyncSettings, syncSettingsValue } from "./sync-snapshot.mjs";
import { stableSyncValue, syncError, MAX_SYNC_RECORD_BYTES } from "./sync-values.mjs";
import {
  CONTENT_SYNC_DATASETS, contentSyncStorageKey, normalizeSyncRecord, metadataFromSyncRecord,
  parseLocalEntries, selectSyncEntries, serializeLocalEntries, readLocalSyncEntries, readRemoteSyncRecords,
  nextSyncTime, syncRecord, tombstoneRecord,
} from "./content-sync-records.mjs";

export async function buildManualSyncPlan(snapshot, direction, now = Date.now(), nonce = crypto.randomUUID()) {
  if (direction === "clear") return clearSyncPlan(snapshot, now, nonce);
  if (!["upload", "download"].includes(direction)) throw syncError("invalid");
  const { records, settings, credentials } = snapshot;
  const remoteSettings = await readCompleteSyncSettings(records);
  const localSettings = syncSettingsValue(settings);
  const flags = Object.fromEntries(Object.values(CONTENT_SYNC_DATASETS).map(({ flag }) => [flag, localSettings[flag] === true]));
  const plan = {
    direction, writes: {}, removals: [], values: {}, settings: null, settingsSource: null, credentials: null,
    metadata: structuredClone(snapshot.metadata || { version: 1, datasets: {} }), rows: [],
  };
  plan.metadata.datasets ||= {};
  const sourceSettings = direction === "upload" ? localSettings : remoteSettings && { ...remoteSettings, ...flags };
  const targetSettings = direction === "upload" ? remoteSettings : localSettings;
  const settingsRow = differenceRow("settings.sync.preferences", objectEntries(sourceSettings), objectEntries(targetSettings));
  settingsRow.skipped = !sourceSettings;
  plan.rows.push(settingsRow);
  if (sourceSettings && changed(settingsRow)) {
    plan.settings = sourceSettings;
    plan.settingsSource = direction === "upload" ? sourceSettings : remoteSettings;
    if (direction === "upload") {
      const prepared = await prepareSettingsSyncWrite(records, sourceSettings);
      Object.assign(plan.writes, prepared.writes);
      plan.removals.push(...prepared.removals);
    }
  }

  // The existing credential record is the opt-in switch. Never create one while
  // it is absent, and never send a key or provider identity to the preview UI.
  const syncedCredentials = decodeSyncedCredentials(credentials.synced);
  if (credentials.syncedExists && !syncedCredentials) throw syncError("invalid");
  if (syncedCredentials) {
    const local = credentials.providerExists ? {
      provider: credentials.provider, secrets: credentials.secrets || { braveSearchApiKey: "" },
    } : null;
    const localRecord = local && encodeSyncedCredentials(local.provider, local.secrets);
    if (localRecord && !decodeSyncedCredentials(localRecord)) throw syncError("invalid");
    const source = direction === "upload" ? localRecord : credentials.synced;
    const target = direction === "upload" ? credentials.synced : localRecord;
    const row = differenceRow("settings.sync.ai", source ? [{ id: "credentials", value: source }] : [], target ? [{ id: "credentials", value: target }] : []);
    row.skipped = !source;
    plan.rows.push(row);
    if (source && changed(row)) {
      plan.credentials = decodeSyncedCredentials(source);
      if (direction === "upload") {
        assertCredentialSyncBudget(records, source);
        plan.writes[SYNC_CREDENTIALS_KEY] = source;
      }
    }
  }

  for (const [name, definition] of Object.entries(CONTENT_SYNC_DATASETS)) {
    if (!flags[definition.flag]) continue;
    await addDataset(plan, snapshot, name, definition, now, nonce);
  }
  // Old settings chunks are cleaned only AFTER publishing, so include their
  // temporary space in preflight instead of depending on a destructive removal.
  if (direction === "upload") assertSyncStorageBudget(records, plan.writes);
  plan.hasChanges = plan.rows.some(row => !row.skipped && changed(row));
  return plan;
}

async function addDataset(plan, snapshot, name, definition, now, nonce) {
  const { records, state } = snapshot;
  const remote = await readRemoteSyncRecords(name, records, { strict: true });
  const local = readLocalSyncEntries(name, state[definition.localKey]);
  const selected = selectSyncEntries(name, local, definition);
  const remoteEntries = remote.filter(record => !record.deleted).map(({ id, value }) => ({ id, value }));
  if (remoteEntries.length > definition.maxItems) throw syncError("invalid");
  const uploading = plan.direction === "upload";
  const source = uploading ? selected : remoteEntries.sort((a, b) => a.id.localeCompare(b.id));
  const target = uploading ? remoteEntries : local;
  const row = differenceRow(definition.label, source, target);
  row.skipped = !uploading && !remote.length;
  row.excluded = uploading ? local.length - selected.length : 0;
  plan.rows.push(row);
  if (row.skipped || !changed(row)) return;
  if (!uploading) {
    plan.values[definition.localKey] = serializeLocalEntries(name, source, state[definition.localKey]);
    plan.metadata.datasets[name] = Object.fromEntries(remote.map(record => [record.id, metadataFromSyncRecord(record)]));
    return;
  }
  // A manual replacement is newer than every version already observed locally.
  const oldMeta = plan.metadata.datasets[name] || {};
  const time = nextSyncTime(oldMeta, remote, now);
  const nextMeta = { ...oldMeta };
  const selectedIds = new Set(source.map(entry => entry.id));
  const removed = new Set([...remote.filter(record => !record.deleted).map(record => record.id), ...Object.keys(oldMeta)]);
  for (const entry of source) {
    const record = syncRecord(name, entry.id, entry.value, time, nonce);
    if (new TextEncoder().encode(JSON.stringify(record)).length > MAX_SYNC_RECORD_BYTES) throw syncError("tooLarge");
    plan.writes[await contentSyncStorageKey(name, entry.id)] = record;
    nextMeta[entry.id] = metadataFromSyncRecord(record);
  }
  for (const id of removed) {
    if (selectedIds.has(id)) continue;
    const record = tombstoneRecord(name, id, time, nonce);
    plan.writes[await contentSyncStorageKey(name, id)] = record;
    nextMeta[id] = metadataFromSyncRecord(record);
  }
  plan.metadata.datasets[name] = nextMeta;
}

function objectEntries(value) {
  return Object.entries(value || {}).map(([id, value]) => ({ id, value }));
}

function differenceRow(label, source, target) {
  const sourceMap = new Map(source.map(entry => [entry.id, stableSyncValue(entry.value)]));
  const targetMap = new Map(target.map(entry => [entry.id, stableSyncValue(entry.value)]));
  return {
    label, count: source.length, added: source.filter(entry => !targetMap.has(entry.id)).length,
    updated: source.filter(entry => targetMap.has(entry.id) && targetMap.get(entry.id) !== sourceMap.get(entry.id)).length,
    removed: target.filter(entry => !sourceMap.has(entry.id)).length, skipped: false, excluded: 0,
  };
}

function changed(row) { return row.added + row.updated + row.removed > 0; }

function clearSyncPlan(snapshot, now, nonce) {
  const metadata = structuredClone(snapshot.metadata || { version: 1, datasets: {} });
  metadata.datasets ||= {};
  // Keep a local baseline so the deletion event or a worker restart does not
  // immediately upload unchanged local content into the just-cleared area.
  for (const [name, definition] of Object.entries(CONTENT_SYNC_DATASETS)) {
    if (!snapshot.settings[definition.flag]) continue;
    const previous = metadata.datasets[name] || {};
    const remote = Object.entries(snapshot.records).filter(([key]) => key.startsWith(definition.prefix))
      .map(([, value]) => normalizeSyncRecord(name, value)).filter(Boolean);
    const time = nextSyncTime(previous, remote, now);
    const revision = `${time}:${nonce}`;
    const next = {};
    for (const id of new Set([...Object.keys(previous), ...remote.map(record => record.id)])) {
      next[id] = metadataFromSyncRecord({ id, deleted: true, updatedAt: time, revision });
    }
    for (const { id, value } of selectSyncEntries(name, parseLocalEntries(name, snapshot.state[definition.localKey]))) {
      next[id] = metadataFromSyncRecord({ id, value, updatedAt: time, revision });
    }
    metadata.datasets[name] = next;
  }
  return {
    direction: "clear", hasChanges: Object.keys(snapshot.records).length > 0, rows: [],
    writes: {}, removals: [], values: {}, settings: syncSettingsValue(snapshot.settings), settingsSource: null,
    credentials: null, metadata,
  };
}

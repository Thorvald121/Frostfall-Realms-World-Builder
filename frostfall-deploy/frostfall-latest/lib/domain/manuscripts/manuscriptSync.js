/** Frostfall P3: pure, world-scoped browser recovery decision logic. */
export const JOURNAL_PREFIX = 'frostfall-manuscript-draft-v3:';
export const LEGACY_PREFIX = 'frostfall-novels-';
export const journalKey = (worldId) => JOURNAL_PREFIX + String(worldId);
export const legacyKey = (worldId) => LEGACY_PREFIX + String(worldId);

export function validateManuscripts(manuscripts) {
  if (!Array.isArray(manuscripts)) throw new Error('Manuscript payload must be an array.');
  for (const m of manuscripts) {
    if (!m || typeof m !== 'object' || !m.id || !Array.isArray(m.acts)) {
      throw new Error('Manuscript recovery is malformed; no data has been overwritten.');
    }
  }
  return manuscripts;
}
// PostgreSQL jsonb normalizes object-key order, so plain JSON.stringify would
// falsely report a conflict on every load after a successful cloud save.
export function stableSerialize(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().filter((k)=>value[k]!==undefined).map((k)=>`${JSON.stringify(k)}:${stableSerialize(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const sameSnapshot = (a,b) => stableSerialize(a) === stableSerialize(b);

export function readBrowserDraft(storage, worldId) {
  const serialized = storage.getItem(journalKey(worldId));
  if (serialized) {
    const snapshot = JSON.parse(serialized);
    if (snapshot.format !== 'frostfall-manuscript-draft-v3' || snapshot.worldId !== String(worldId)) {
      throw new Error('Browser manuscript draft belongs to another world or format.');
    }
    validateManuscripts(snapshot.manuscripts);
    return snapshot;
  }
  const legacy = storage.getItem(legacyKey(worldId));
  if (!legacy) return null;
  return {format:'frostfall-manuscript-draft-v3',worldId:String(worldId),
    manuscripts:validateManuscripts(JSON.parse(legacy)),savedAt:null,syncedRevision:null,dirty:true,legacy:true};
}

export function writeBrowserDraft(storage, worldId, manuscripts, {syncedRevision=null,dirty=true}={}) {
  const record = {format:'frostfall-manuscript-draft-v3',worldId:String(worldId),
    manuscripts:validateManuscripts(manuscripts),savedAt:new Date().toISOString(),syncedRevision,dirty};
  // Journal is always committed before touching the legacy key. A quota failure
  // must never claim that a draft was backed up.
  storage.setItem(journalKey(worldId), JSON.stringify(record));
  storage.setItem(legacyKey(worldId), JSON.stringify(manuscripts));
  return record;
}

export function chooseManuscriptHydration({cloud, browser, hosted}) {
  const remote = validateManuscripts(cloud?.manuscripts ?? []);
  const remoteRevision = Number(cloud?.revision ?? 0);
  if (!hosted) return {manuscripts: browser?.manuscripts ?? remote, revision:0, recovery:null};
  if (browser && !sameSnapshot(browser.manuscripts, remote)) {
    // The local backup might contain unsynced edits. Never overwrite either copy.
    return {manuscripts:remote,revision:remoteRevision,recovery:browser};
  }
  return {manuscripts:remote,revision:remoteRevision,recovery:null};
}

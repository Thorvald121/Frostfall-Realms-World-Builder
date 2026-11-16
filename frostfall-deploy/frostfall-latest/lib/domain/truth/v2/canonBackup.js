/** Canon-specific portable snapshot. Does not include provider keys, sessions, or auth. */
export function makeCanonBackup(worldId, snapshot, now = new Date()) {
  if (!worldId || !snapshot || typeof snapshot !== 'object') throw new Error('Cannot export an uninitialized canon world.');
  const payload = {
    format: 'frostfall.canon.v2',
    version: 2,
    worldId: String(worldId),
    exportedAt: now.toISOString(),
    branches: Array.isArray(snapshot.branches) ? snapshot.branches : [],
    sources: Array.isArray(snapshot.sources) ? snapshot.sources : [],
    assertions: Array.isArray(snapshot.assertions) ? snapshot.assertions : [],
    decisions: Array.isArray(snapshot.decisions) ? snapshot.decisions : [],
  };
  return JSON.stringify(payload,null,2);
}

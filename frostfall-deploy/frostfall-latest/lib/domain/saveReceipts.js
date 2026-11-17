/** Guard against false 'Saved' notices. */
export function requireSaveReceipt(receipt) {
  if (receipt === false || receipt == null || receipt.ok !== true) {
    throw new Error("The server did not acknowledge this save");
  }
  return receipt;
}

export function codexRecoveryKey(worldId) {
  if (!worldId) throw new Error("Missing world identity for recovery backup");
  return `frostfall-codex-recovery-v1-${worldId}`;
}

/** A stable, serializable, user-recoverable backup. Never contains AI keys. */
export function makeCodexRecovery(worldId, articles, archived) {
  return JSON.stringify({
    format: "frostfall-codex-recovery", version: 1, worldId,
    createdAt: new Date().toISOString(), articles, archived,
  });
}

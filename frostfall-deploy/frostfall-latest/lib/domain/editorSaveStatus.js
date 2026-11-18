/**
 * Codex and manuscript saves are independent. The status of the persisted
 * article library must never imply that the *open editor draft* was saved.
 */
export function codexFooterLabel(status, editorOpen = false) {
  if (status === "error") return "CODEX SYNC FAILED · EXPORT RECOVERY";
  if (editorOpen) return "CODEX DRAFT · UNSAVED";
  if (status === "saving") return "CODEX LIBRARY · SYNCING";
  if (status === "saved") return "CODEX LIBRARY · SAVED";
  return "CODEX LIBRARY · NOT VERIFIED";
}

/**
 * Avoid showing a reassuring "cloud saved" indicator for a manuscript library
 * with zero manuscripts. Always surface errors or in-flight operations.
 */
export function showManuscriptFooter(status, count, error = null) {
  if (!status) return false;
  if (error || status === "error" || status === "conflict" || status === "recovery" || status === "saving" || status === "loading") return true;
  return Number(count) > 0;
}

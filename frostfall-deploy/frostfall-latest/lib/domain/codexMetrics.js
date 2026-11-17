/** Pure, world-scoped Codex summary; never infers participation or canonical status. */
export function summarizeCodexWorkspace({ articles = [], categories = {}, disabledCategories = [] } = {}) {
  const disabled = new Set(disabledCategories);
  const records = (Array.isArray(articles) ? articles : []).filter((a) => a && !a.archived && !a.isArchived && !a.is_archived);
  const enabled = Object.keys(categories).filter((id) => !disabled.has(id));
  const counts = Object.fromEntries(enabled.map((id) => [id, 0]));
  let linked = 0;
  let flagged = 0;
  for (const entry of records) {
    if (Object.hasOwn(counts, entry.category)) counts[entry.category]++;
    if (Array.isArray(entry.linkedIds) && entry.linkedIds.length) linked++;
    if (entry.integrityStatus === 'needs_review' || entry.canonStatus === 'disputed') flagged++;
  }
  return {
    entries: records.length,
    categories: Object.values(counts).filter((count) => count > 0).length,
    linked,
    flagged,
    categoryCounts: counts,
  };
}

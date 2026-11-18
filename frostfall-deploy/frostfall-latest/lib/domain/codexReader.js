/** Read-only, presentation-only summaries for the Codex article reader. */
export function summarizeCodexReader(article) {
  const entry = article && typeof article === 'object' ? article : {};
  const body = typeof entry.body === 'string' ? entry.body : '';
  const visibleText = body
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:nbsp|amp|lt|gt|quot|#39);/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const fields = entry.fields && typeof entry.fields === 'object' && !Array.isArray(entry.fields) ? entry.fields : {};
  const filledFields = Object.values(fields).filter(value => value !== null && value !== undefined &&
    (typeof value === 'number' || typeof value === 'boolean' || String(value).trim() !== '')).length;
  return {
    wordCount: visibleText ? visibleText.split(' ').length : 0,
    filledFields,
    tagCount: Array.isArray(entry.tags) ? entry.tags.filter(Boolean).length : 0,
    linkedCount: Array.isArray(entry.linkedIds) ? new Set(entry.linkedIds.filter(Boolean)).size : 0,
  };
}

/**
 * Read-only editor metrics. Never used to infer canonical facts or persist data.
 * Rich-text contents stay on their existing, separately validated save path.
 */
export function draftOverview(draft = {}) {
  const title = typeof draft.title === 'string' ? draft.title.trim() : '';
  const summary = typeof draft.summary === 'string' ? draft.summary.trim() : '';
  const html = typeof draft.body === 'string' ? draft.body : '';
  const plain = html
    .replace(/<\s*br\s*\/?\s*>/gi, ' ')
    .replace(/<\/(?:p|li|div|h[1-6]|blockquote)>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(?:nbsp|amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const fields = draft.fields && typeof draft.fields === 'object' && !Array.isArray(draft.fields) ? draft.fields : {};
  const filledFields = Object.values(fields).filter(v => v !== null && v !== undefined && String(v).trim().length > 0).length;
  const tagList = Array.isArray(draft.tags) ? draft.tags : typeof draft.tags === 'string' ? draft.tags.split(',') : [];
  const tags = [...new Set(tagList.map(t => String(t).trim().toLowerCase()).filter(Boolean))];
  return {
    titleReady: title.length > 0,
    summaryReady: summary.length > 0,
    wordCount: plain ? plain.split(/\s+/u).length : 0,
    filledFields,
    tagCount: tags.length,
  };
}

/**
 * Freeze the latest sanitized editor body when Save is requested. React state
 * updates may still be batched; validation and persistence must use this value.
 */
export function captureEditorDraft(draft, latestSanitizedBody) {
  const safe = draft && typeof draft === "object" && !Array.isArray(draft) ? draft : {};
  const body = typeof latestSanitizedBody === "string" ? latestSanitizedBody : (safe.body || "");
  return { ...safe, body };
}

/**
 * Browser-local Codex draft recovery. This is NOT a cloud save or a publication.
 * Keys are scoped to the signed-in user, world, entry type and entry identity.
 * Callers must still obtain a verified Supabase write receipt before cleanup.
 */
export function getBrowserCodexStorage() {
  try { return typeof window !== "undefined" ? window.localStorage : null; }
  catch { return null; }
}

export const CODEX_DRAFT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
export const CODEX_DRAFT_MAX_SIZE = 850_000;
const VERSION = 1;

export function codexDraftKey(userId, worldId, category, entryId = "new") {
  const parts = [userId, worldId, category, entryId];
  if (parts.some((part) => typeof part !== "string" || !part.trim())) return null;
  return ["frostfall", "codex-draft", "v1", ...parts.map((part) => encodeURIComponent(part))].join(":");
}

export function draftHasContent(draft) {
  if (!draft || typeof draft !== "object") return false;
  if (String(draft.title || "").trim() || String(draft.summary || "").trim()
    || String(draft.tags || "").trim() || String(draft.body || "").replace(/<[^>]*>/g, "").trim()) return true;
  return Object.values(draft.fields || {}).some((value) => String(value ?? "").trim());
}

export function readCodexDraft(storage, key, now = Date.now()) {
  if (!storage || !key) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw || raw.length > CODEX_DRAFT_MAX_SIZE) return null;
    const record = JSON.parse(raw);
    if (record?.version !== VERSION || typeof record.token !== "string"
      || !Number.isFinite(record.savedAtMs) || !record.draft
      || !Number.isFinite(now) || record.savedAtMs > now + 60_000
      || now - record.savedAtMs > CODEX_DRAFT_MAX_AGE_MS) return null;
    return record;
  } catch {
    return null;
  }
}

export function writeCodexDraft(storage, key, draft, options = {}) {
  if (!storage || !key || !draftHasContent(draft)) return { ok: false, reason: "empty" };
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const token = options.token || [now, Math.random().toString(36).slice(2, 12)].join("-");
  const record = {
    version: VERSION,
    token,
    savedAtMs: now,
    draft: {
      title: draft.title || "", summary: draft.summary || "",
      fields: draft.fields || {}, body: draft.body || "",
      tags: draft.tags || "", temporal: draft.temporal || null,
      portrait: draft.portrait || null,
    },
  };
  try {
    const serialized = JSON.stringify(record);
    if (serialized.length > CODEX_DRAFT_MAX_SIZE) return { ok: false, reason: "size" };
    storage.setItem(key, serialized);
    return { ok: true, token };
  } catch {
    return { ok: false, reason: "storage" };
  }
}

/** Do not erase a newer unsaved edit when an older cloud write finishes. */
export function clearCodexDraftOnReceipt(storage, key, expectedToken) {
  if (!expectedToken) return false;
  const current = readCodexDraft(storage, key);
  if (!current || current.token !== expectedToken) return false;
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function discardCodexDraft(storage, key) {
  if (!storage || !key) return false;
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

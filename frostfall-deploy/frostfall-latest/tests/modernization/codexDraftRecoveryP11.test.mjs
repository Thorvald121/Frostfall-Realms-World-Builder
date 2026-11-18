import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  getBrowserCodexStorage, codexDraftKey, draftHasContent, readCodexDraft, writeCodexDraft,
  clearCodexDraftOnReceipt, discardCodexDraft, CODEX_DRAFT_MAX_AGE_MS,
} from "../../lib/domain/codexDraftRecovery.js";

const memory = () => {
  const records = new Map();
  return {
    records,
    getItem: (key) => records.get(key) ?? null,
    setItem: (key, value) => records.set(key, value),
    removeItem: (key) => records.delete(key),
  };
};
const draft = { title: "Daltos Varix", summary: "Character",
  fields: { race: "Human" }, body: "<p>Hello <strike>old</strike> world</p>",
  tags: "hero, north", temporal: null, portrait: null };
const now = Date.now();
const key = codexDraftKey("account-A", "world-A", "character", "new");

test("P11 requires a signed-in account and world for any recovery key", () => {
  assert.equal(codexDraftKey(null, "world-A", "character"), null);
  assert.equal(codexDraftKey("account-A", "", "character"), null);
  assert.equal(codexDraftKey("account-A", "world-A", "", "new"), null);
});
test("P11 isolates drafts by account, world, category and entry", () => {
  assert.notEqual(key, codexDraftKey("account-B", "world-A", "character", "new"));
  assert.notEqual(key, codexDraftKey("account-A", "world-B", "character", "new"));
  assert.notEqual(key, codexDraftKey("account-A", "world-A", "deity", "new"));
  assert.notEqual(key, codexDraftKey("account-A", "world-A", "character", "daltos_varix"));
});
test("P11 rejects blank drafts and recognizes structured fields", () => {
  assert.equal(draftHasContent({ title: "", summary: "", body: "<p></p>", fields: {} }), false);
  assert.equal(draftHasContent({ fields: { race: "Human" } }), true);
  assert.equal(draftHasContent({ title: " Daltos " }), true);
  assert.equal(draftHasContent({ body: "<p>story</p>" }), true);
});
test("P11 preserves formatted body and fields for manual restoration", () => {
  const storage = memory();
  const saved = writeCodexDraft(storage, key, draft, { now, token: "saved-original" });
  assert.deepEqual(saved, { ok: true, token: "saved-original" });
  const restored = readCodexDraft(storage, key, now + 100);
  assert.equal(restored.draft.body, draft.body);
  assert.equal(restored.draft.fields.race, "Human");
  assert.equal(restored.draft.tags, "hero, north");
});
test("P11 browser drafts expire and cannot be automatically resurrected indefinitely", () => {
  const storage = memory();
  writeCodexDraft(storage, key, draft, { now, token: "expiry" });
  assert.equal(readCodexDraft(storage, key, now + CODEX_DRAFT_MAX_AGE_MS + 1), null);
  assert.equal(readCodexDraft(storage, key, now - 61_000), null);
});
test("P11 malformed draft JSON is ignored safely", () => {
  const storage = memory();
  storage.setItem(key, "{not valid JSON");
  assert.equal(readCodexDraft(storage, key), null);
});
test("P11 confirmed cloud receipt clears only the matching recovery token", () => {
  const storage = memory();
  writeCodexDraft(storage, key, draft, { now, token: "v1" });
  assert.equal(clearCodexDraftOnReceipt(storage, key, "different"), false);
  assert.ok(readCodexDraft(storage, key));
  assert.equal(clearCodexDraftOnReceipt(storage, key, "v1"), true);
  assert.equal(readCodexDraft(storage, key), null);
});
test("P11 late cloud receipts never erase a more recent browser draft", () => {
  const storage = memory();
  writeCodexDraft(storage, key, draft, { now, token: "old" });
  writeCodexDraft(storage, key, { ...draft, body: "<p>New unsaved words</p>" }, { now: now + 5, token: "new" });
  assert.equal(clearCodexDraftOnReceipt(storage, key, "old"), false);
  assert.equal(readCodexDraft(storage, key).draft.body, "<p>New unsaved words</p>");
});
test("P11 reports quota or disabled-storage failure instead of claiming recovery", () => {
  const storage = { getItem: () => null, setItem: () => { throw new Error("Quota"); }, removeItem: () => {} };
  assert.deepEqual(writeCodexDraft(storage, key, draft), { ok: false, reason: "storage" });
});
test("P11 refuses oversized draft backups rather than silently truncating lore", () => {
  const storage = memory();
  const saved = writeCodexDraft(storage, key, { ...draft, body: "a".repeat(900_000) });
  assert.equal(saved.ok, false);
  assert.equal(saved.reason, "size");
  assert.equal(storage.records.size, 0);
});
test("P11 discards only the requested recovery key", () => {
  const storage = memory(), key2 = codexDraftKey("account-A", "world-B", "character");
  writeCodexDraft(storage, key, draft, { now, token: "one" });
  writeCodexDraft(storage, key2, draft, { now, token: "two" });
  assert.equal(discardCodexDraft(storage, key), true);
  assert.equal(readCodexDraft(storage, key), null);
  assert.ok(readCodexDraft(storage, key2));
});
test("P11 recovery prompt demands explicit restore or discard and suspends Save", () => {
  const jsx = readFileSync("features/codex/CodexEditorWorkspace.jsx", "utf8");
  assert.match(jsx, /Unsaved Codex draft found/);
  assert.match(jsx, /Restore this draft/);
  assert.match(jsx, /Discard recovery copy/);
  assert.match(jsx, /!!recovery/);
});
test("P11 requires a verified Supabase receipt matching the article revision before cleanup", () => {
  const app = readFileSync("components/FrostfallRealms.jsx", "utf8");
  assert.match(app, /requireSaveReceipt\(await bulkUpsertArticles/);
  assert.match(app, /article\.id === pending\.articleId && article\.updatedAt === pending\.updatedAt/);
  assert.match(app, /clearCodexDraftOnReceipt\(window\.localStorage, pending\.key, pending\.token\)/);
});
test("P11 preserves original editor sanitizer and formatting storage", () => {
  const app = readFileSync("components/FrostfallRealms.jsx", "utf8");
  assert.match(app, /sanitizeRichHtml\(articleBodyRef\.current\.innerHTML/);
  assert.match(app, /draft\.body/);
});

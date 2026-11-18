# P11 — Codex Draft Recovery & Save Receipt Protection

**2026-11-18** · Branch: `feature/p11-codex-draft-recovery-20261118`

## User acceptance
The author created **Daltos Varix** in the Chairondis world; a read-only Supabase query confirmed it was persisted with its HTML strikethrough formatting. This verifies an actual stored entry, but it does not alone prove every browser reload and edit workflow.

## Implemented
- Browser-local draft backup for **unsaved Codex editor** entries, isolated by signed-in user ID, world ID, category and edit identity.
- Manual restore/discard prompt; no automatic overwriting of an existing stored article. Recoveries older than 14 days are not offered.
- Title, summary, structured fields, rich text, tags, portrait and chronology are retained when browser storage capacity allows.
- Debounced backups while authoring, immediate backup when leaving via editor actions/world switch, and a `pagehide` flush. If browser storage is blocked/full, show a visible warning.
- A submitted draft's browser backup is removed **only** after `bulkUpsertArticles` returns a valid receipt for a snapshot containing the exact entry ID and revision. Newer local draft tokens must survive older cloud receipts.
- Existing DB article autosave and server-side RLS remain untouched. No new backend tables, migrations, or paid dependencies.

## Honest limitations
- A browser-local recovery is not a verified cloud save; it is tied to the browser/device and may be lost if storage is cleared or an InPrivate session ends.
- Storage quota may reject large embedded images. No automatic silent truncation; the editor surfaces a warning.
- Background network sync after the user presses Create still requires confirmed receipts. UI may display the article optimistically before the save returns.
- A full rich-text engine replacement (e.g., Lexical), structured undo history, persistent snapshots, collaborative conflict resolution and authenticated browser acceptance remain future milestones.

## Verification
- `prebuild` executes `test:modernization` and `test:syntax` on Vercel without paid GitHub Actions.
- New `tests/modernization/codexDraftRecoveryP11.test.mjs` checks account/world scoping, formatting preservation, expiration, corrupt JSON, storage errors, maximum-size protection, and token-safe receipt clearing.
- Preview must be READY and green before merging. Test with an authenticated account: write an unsaved entry, navigate away, reopen, restore/discard, save, reload, verify cloud content and absence of stale recovery. Repeat in other authorized world; no leakage.
- Roll back the frontend release to prior P10.1 deployment if a save/navigation regression appears. No DB rollback required.

## Next development
- Codex rich-text editor replacement with safe HTML round-trip migration and true authoritative save receipts.
- Rebuild sparse article detail reader into accessible, responsive multi-section Studio view.
- Continue Atlas/relationship, manuscript and Canon authoring improvements while reducing the monolithic coordinator.

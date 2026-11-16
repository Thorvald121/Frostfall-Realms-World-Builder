# Frostfall Realms P4 — Chronicles Studio

**Date:** 2026-11-16  
**Based on:** P3 `240c8509797e8ba03c53b17d12772d26d33cd66e`  
**Branch:** `modernization/p4-chronicles-20261116`  
**Deployment:** not pushed to GitHub, not migrated to Supabase, not deployed to production.

## Functional changes to source

- Replace the original mostly static temporal swim-lane view with a **Chronicles Studio** embedded in the existing application navigation.
- Two views: a horizontally scrollable chronological lane canvas and a paginated, sortable event index (50 records per tranche).
- Search title, summaries, fields, tags and body text; filter by category, named era overlap, event kind, start/end year (including negative and Year 0), and include records with no date.
- Sort ascending/descending chronology, A–Z/Z–A, recently updated and longest duration. The **index** follows this ordering; the canvas is always chronological.
- Zoom control; jump to a world year; date ticks; color-coded category markers with per-theme contrast; robust overlap layout.
- Clickable entries open an accessible dialog displaying category, timeline span, era, summary, relevant source text/fields, explicit linked lore, and applicable integrity findings; actions open the actual Codex entry or editor. Escape and focus handling are provided.
- Export filtered chronology to CSV with text formula-injection protection. Zero and negative numeric years remain numeric.
- The workspace uses the existing parent page-level vertical scroll and a single horizontal timeline scroll. No new page-level scrollbar is introduced.
- No invented interaction from mere `@` mentions: the inspector explicitly labels them as references only.
- Works from the existing article `temporal` data; no database schema migration or data rewrite required for P4 itself.
- All nine established themes, distinct sidebar nav identities and single theme selector remain unchanged.

## Test status

- Run `node --experimental-default-type=module --test tests/modernization/*.test.mjs`.
- TypeScript parser syntax-check of all JS/JSX files and CSS parser check of all CSS files.
- Offline proof-of-concept passed Chromium click-through checks at 1536×864, 1280×800, 900×700, 390×844 and 320×700: navigation, filtering, sort/index, dialog, zoom, year jump, no document overflow, no page JS exceptions.
- **Offline HTML uses invented demonstration data. The real Next.js application is not running in that preview.**
- Full Next.js dependency install and production build were not possible in this environment (no package registry access). SQL/RLS staging checks for P2/P3 remain outstanding.

## Live deployment gate — required

1. Verify current remote main revision, database schema/ownership and backups. Do not replace the live app with the standalone HTML preview or apply SQL blindly.
2. Push this source to a new **staging branch** from a GitHub identity with push permissions. Existing connector is read-only (`pull: true`, `push: false`). Never force-push main.
3. Build cleanly with Node 22 and pnpm; regenerate the lockfile because earlier milestones introduced dependencies that are not yet locked. Run modernization tests and full project tests.
4. Set a **separate staging environment and Supabase project**. Apply and verify P2 migration `202611160001_canon_studio.sql` and P3 migration `202611160002_manuscript_versioned_sync.sql` only after staging backups. P4 itself has no migration.
5. Sign in to staging as an ordinary user: validate world isolation, browser drafts, manuscript version conflicts, Codex facts, all nine themes, keyboard navigation, Chronicles inspector and filter behavior, mobile accessibility and no duplicate scrollbars.
6. Verify actual server session validation, CSP, HTML sanitization, and migration rollback; address all critical findings from previous audits before declaring production-ready.
7. Promote to production only after acceptance and a rollback plan; otherwise keep existing live portal unchanged.

## Deferred but explicit requirements

- **Self-service account deletion:** see `ACCOUNT_DELETION_REQUIREMENTS.md`. This is not yet implemented. It must handle secure reauthentication, shared-world ownership, storage, durable export, Auth identity deletion, and audits.
- Direct event authoring/drag edits inside the timeline, explicit fact-derived participation, source-span citations and canon branch overlay are future enhancements. P4 intentionally reads established Codex chronology; it never silently changes facts.

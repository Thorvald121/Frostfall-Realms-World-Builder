# Frostfall Realms — P2 Canon Studio engineering handoff

**Date:** November 16, 2026  
**Parent:** `modernization/p1-studio` commit `ea35815af6c95aa44d87daff81428661d0b1917b`  
**Delivery mode:** isolated source and incremental Git bundle/patch; no changes applied to hosted GitHub or Supabase.

## What P2 actually adds

- A new **Canon Studio** route accessible from the uniquely colored Lucide sidebar entry and Codex Studio toolbar.
- Interactive, theme-token-based **review queue, structured fact ledger, evidence library, and canon branches**.
- Explicit author-controlled statuses: `draft`, `canon`, `disputed`, `superseded`, `alternate`.
- An **evidence-linked** fact form; no implicit AI promotion, no assumptions from textual `@mentions`.
- Author review dispositions `acknowledged`, `intentional`, `dismissed`, with explanations and manual reopening. Review signatures invalidate an old disposition when underlying fact fields/evidence links change.
- Separate canon data repository backed by **Supabase Postgres when configured**, with browser-local **clearly labeled demonstration mode only** if no Supabase is configured. Hosted mode **never** hides migration/RLS failures with silent local storage fallback.
- A **portable canon JSON export** without access tokens or provider keys. Import/restore from the P2 export is not yet implemented. Preserve exports.
- **Typed-date suggestions** from existing codex character fields; these open editable drafts and are never automatically canonized.
- The explicit-fact evaluator now detects physical participation extending past a recorded death and competing explicitly exclusive locations or memberships; a remembrance is not a physical encounter.
- A staged **additive SQL migration** with `ff_canon_*` tables, branch-scoped findings, source provenance checks, foreign keys, RLS, role-aware authorization, and stable article UUID references. No existing article or manuscript rows are altered.
- All nine named themes remain available; the new Canon Studio uses text/border/status color calculations to target 4.5:1 for text and 3:1 for control borders, preserving distinct module navigation colors.

## SQL migration contract

Migration: `supabase/migrations/202611160001_canon_studio.sql`.

- Creates `ff_canon_branches`, `ff_canon_sources`, `ff_canon_assertions`, and `ff_canon_findings`.
- Adds a `main` canon branch to each existing world and a trigger for newly created worlds.
- Owner/editor can read/write; viewer can read. Uses the existing optional `world_members` relation when available; the world's owner always has access. All checks derive the requester from `auth.uid()`.
- Claims store **stable Supabase article UUIDs** as well as readable slugs; changing an article slug must not detach a claim. Their foreign keys intentionally **restrict deletion** of referenced articles until the author resolves their dependent claims.
- Cross-world subject/object references, source/article provenance, and nonmatching branch/world references are rejected.
- SQL installs or replaces functions/triggers with `ff_canon_` prefix; does not overwrite P1 authoring records.
- Migration is written to be rerunnable, but **must first be exercised on a representative staging database**, with an independently verified backup.
- **Not executed in this session.** No live database permission or schema consistency was asserted.

## Staging procedure (do not run against production)

1. Back up the staging Supabase project and confirm the backup can be restored. Establish a coherent P1 code baseline.
2. Extract `Frostfall_Studio_P2_Source.zip` into a fresh directory, or import the supplied P2 Git bundle (which contains the P1 parent commit).
3. Ensure `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` point to **staging** only. Do not put a Supabase service-role key in the frontend or source archive.
4. Run the *staging-only* migration from `supabase/migrations/202611160001_canon_studio.sql` in the staging Supabase SQL editor after reviewing the exact existing schema.
5. Regenerate `pnpm-lock.yaml` via `corepack pnpm install --no-frozen-lockfile` on a host able to install dependencies; commit the reviewed lockfile. P1 already introduced the Tabler/Lucide dependencies without updating its lockfile.
6. Run `corepack pnpm test:modernization`, then `corepack pnpm test:run`, then `corepack pnpm build`.
7. In the browser, confirm nine themes, high-contrast navigation labels, light-mode forms, mobile navigation, authenticated world access, and previous Codex/Timeline/Atlas/Novel routes.
8. In Canon Studio, add a source, create a draft claim, promote it deliberately to Canonical, generate a contradiction, record a review rationale, edit the underlying fact, confirm the old review turns stale, reopen it, create an alternate branch, and export the canon JSON.
9. Verify RLS with **separate** owner/editor/viewer users, and with a user outside the world. Ensure anonymous queries cannot read canon tables; cross-world subject/object/source relationships must be rejected.
10. Compare article and manuscript counts and hashes before/after. Never drop tables, replace production state, or migrate manuscripts implicitly.

## Checks completed locally

- `node --experimental-default-type=module --test tests/modernization/*.test.mjs`: **25/25 passing** (all P1 checks preserved).
- TypeScript parser syntax scans all JS/JSX sources: no diagnostics.
- Static module import resolution scan: no unresolved local or declared dependency imports.
- PostCSS CSS parser: all CSS sources parse.
- Standalone P2 HTML preview's embedded JavaScript parses.
- The P2 standalone HTML preview passed automated **Chromium desktop and mobile smoke checks**: navigation, Canon Studio view switching, simulated review action, Parchment and Dark Arcane theme selection, and no JavaScript page errors. The restricted test browser blocked direct `file://` access and external Google font import, so the QA runner set the HTML document directly and suppressed only the remote font import in its test copy. This does **not** constitute browser QA of the Next.js application or its database-backed screens.
- No full Next.js compile or Supabase migration was run: packages are not installed in this execution environment, and no staging database connection was provided.

## Important limitations / known work ahead

- P2 is an **isolated feature**, not a replacement for the legacy Integrity panel. Both are visible so existing functionality can be retained while the new assertion model matures.
- The source library records **excerpts/citations and optional article links**, not uploaded file binaries or automatic document provenance. Fine-grained span references and editor highlighting remain planned.
- No server-side import pipeline for canon suggestions. The model does not infer facts from prose.
- No collaborator notification or multiuser conflict-resolution revision ledger yet. RLS guards storage, but concurrent editing needs its own versioning and audit strategy.
- Canon data export is available; **re-import/restore is not yet built**.
- P1 manuscripts still use browser storage; authenticated, versioned manuscript cloud sync remains a critical separate milestone.
- The old editor's HTML sanitization and remaining hardcoded low-contrast colors still require a system-wide modernization pass before production promotion.
- Source repo is a snapshot; the connected GitHub repository was read-only. No remote push or deployment occurred.

## Suggested P3 milestone

Build versioned manuscript/codex persistence and recovery, then integrate evidence highlighting and structured facts directly into the revamped rich-text Codex editor. Complete high-contrast visual acceptance across all routes. Add verified multiuser writes and per-world audit logs before enabling automatic claim extraction.

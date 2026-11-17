# Frostfall Realms — Phase 3: manuscript durability + Codex/canon bridge

**Date:** 2026-11-16
**Base:** P2 `c00a37d9a07c29a8df6bbdbb15488183e6a97768`
**Status:** local source and interactive demonstration preview; **NOT deployed, NOT migrated to production**.

## Functional work included

1. **Versioned manuscripts, cloud-first with browser recovery:**
   - Additive Supabase `ff_manuscript_worlds` and `ff_manuscript_revisions` tables (30 latest immutable snapshots); RLS and authenticated, owner/editor-only write RPC.
   - Transactional `ff_save_manuscript_world` compares expected revision; concurrent sessions receive explicit conflict instead of silently overwriting one another.
   - Browser journal for every edit, world-scoped, plus legacy localStorage copy. A legacy `window.storage` copy is recognized when available.
   - When cloud data differs from a browser recovery, pause manuscript editing and require an explicit **Restore browser draft** or **Keep cloud and archive browser draft** decision. An export action is offered before the choice.
   - Missing migration, permission error or corrupt recovery blocks manuscript editing; never load an empty editable workspace on failure.
   - A successful database revision receipt precedes **Cloud saved**. Browser-only mode clearly labels its limitations.
   - The manuscript workspace gets a compact save/history toolbar **inside** the pre-existing scroll-constrained editor container, to avoid reintroducing multiple scrollbars.
   - Authors can export, browse the last 30 revisions and restore an older snapshot **as a new revision** after confirmation.

2. **Codex → Canon Studio integration:**
   - A new per-entry **Verified canon** panel shows structured assertions for the main branch, canonical/draft counts, evidence references and source excerpts.
   - **Open canon** opens Canon Studio filtered to the selected Codex entity. **Draft fact** opens a prefilled uncommitted assertion.
   - Article UUID references remain stable across slug changes; the original prose is not modified by a claim.

3. **Visual continuity:** Nine existing themes, independent colorful sidebar icon+text identities, single theme dropdown, and fixed navigation/viewport behavior remain unchanged. New panels inherit semantic theme tokens and have responsive widths.

## Staging deployment gates — mandatory

1. **Establish baseline.** Work in a separate staging checkout with P2 code and **staging Supabase only**. Do not point an untested P3 build at the production project.
2. **Backup staging database and important browser manuscripts.** Confirm ability to restore. Compare manuscript/world counts and backup hashes.
3. **Review and apply P2 schema first if not yet applied:** `supabase/migrations/202611160001_canon_studio.sql`. This provides `ff_canon_can_read` and `ff_canon_can_write`.
4. **Apply P3 migration to staging:** `supabase/migrations/202611160002_manuscript_versioned_sync.sql`. No existing article/manuscript rows are rewritten, but test carefully with a representative staging dataset.
5. **Dependencies:** Install with pnpm (Node 22 recommended), regenerate and review the lockfile because P1/P2 added Tabler/Lucide without updating the lock. Keep all environment secrets outside Git.
6. **Run checks:**

   ```powershell
   corepack enable
   corepack pnpm install --no-frozen-lockfile
   corepack pnpm test:modernization
   corepack pnpm test:run
   corepack pnpm build
   ```

7. **Browser acceptance:** verify all nine themes; distinct colored nav labels; no double scrollbars at 1536/1280/900/390/320 widths; manuscript save acknowledgement; deliberate empty-list save; legacy browser recovery; cloud/local divergence; two-tab same-document CAS conflict; version history restore; Codex assertions/evidence; viewer restrictions; world isolation; old manuscript/novel workflows.
8. **Database checks:** authenticated owner/editor can read/write; viewer can read but cannot invoke write RPC; unrelated user cannot read/write, anon cannot read/write; conflict leaves original snapshot and history intact; failed RPC does not show saved. Confirm every revision appears once and old snapshots remain readable.

## Existing limitations / next engineering steps

- No live Supabase migration or Next.js build was executed here. Node dependency installation was unavailable in the isolated build environment. **41 focused Node tests passed**, and all changed JSX/JS files passed TypeScript parser syntax scans. The interactive **offline concept** passed Chromium click-through checks at five widths, but is not the running Next.js application.
- A `contentEditable` legacy editor and some hardcoded legacy colors still need a modernization pass. The P3 feature does **not** convert manuscripts to Lexical or sanitise HTML.
- Current cloud persistence stores a **world-level JSON snapshot** and up to 30 versions, not per-scene incremental revisions or diff-based sync. The 10 MiB RPC cap and browser localStorage quota require a future IndexedDB/large-document strategy. Exports remain strongly advised.
- The offline preview uses invented lore and simulated recovery statuses. No actual browser demo data is synchronized to Supabase.
- The cloud canon schema and P3 manuscript schema have only been statically reviewed. SQL syntax, runtime RLS semantics, concurrency and read/write permission scenarios need a **staging PostgreSQL test**.
- No GitHub changes were pushed, since the connected GitHub repository exposes read-only access for this workspace. Use the supplied patch or Git bundle in a writable checkout after review.
- Existing P2 Codex save uses a bulk-upsert architecture and may warrant a separate transactional revision overhaul in P4; P3 is focused on manuscripts and structured canon bridge.

## Recommended P4 work

Replace the legacy manuscript editor with a structured editor and durable per-scene checkpoints, connect source spans directly to article passages, expand the deterministic Truth Engine, and complete across-the-board light/dark contrast and keyboard accessibility testing.

# P12 — Codex Reader Studio

**2026-11-18 · Branch:** `feature/p12-codex-reader-studio-20261118`

## Goal and scope
Modernize how **saved** Codex articles are read without changing their stored records, schemas, authoring flow, Canon decisions, or P11 draft recovery.

## Implemented
- Responsive two-column reading layout with a portrait/category masthead, world/Codex breadcrumb navigation, category-color identification, chronology badges, article summary, and reader metadata.
- Distinct Story & Lore panel with typography for rich HTML paragraphs, headings, quotes, code blocks, tables, and images. Existing `SafeRichText` and legacy mention navigation remain authoritative.
- Context rail keeps article portrait, table of contents, fields, Canon panel, temporal information, outgoing links, suggested links, backlinks, related articles, tags and version history.
- Existing Edit, Move, Duplicate, Template, and Delete handlers are reused, not replaced. No direct database operation in the new reader component.
- New presentation-only word/property/tag/link summarizer with tests for malformed data, no source mutation, JSX validity, accessibility, presentation tokens and legacy feature retention.

## Verification / release gate
1. `pnpm run test:modernization`, `pnpm run test:syntax`, and `next build --webpack` execute as Vercel `prebuild` + build for each branch commit.
2. Latest verified implementation commit before docs: `f63cc5877d26102381f496f9901f6d3578dc7d19`: Vercel preview READY, GitHub Vercel status success, 92 JS/JSX, 9 CSS, 129 local imports, 0 errors.
3. Verify **final branch head** again after documentation changes, then merge the reviewed PR. Vercel must redeploy the merge SHA to production before calling P12 live.
4. No Supabase migrations, no destructive data changes, and no new dependency.

## Browser acceptance (signed-in user)
1. Open an existing Chairondis Character such as Daltos Varix. Confirm title, summary, strikethrough text and properties remain readable.
2. Open a long-form article with H2/H3 sections. Check table of contents anchors, collapse/expand and links.
3. Check navigation to related entries, suggested links, Canon, version history and Edit. Confirm reader does not create unsaved changes or overwrite articles.
4. Check mobile/tablet widths, long titles, light and dark themes; check actions are keyboard reachable.
5. Exercise P11 draft restore/discard in a normal browser session; don't use InPrivate as durable recovery storage.

## Rollback
- Roll back the Vercel **frontend only** to P11 deployment commit `50f9625d409ab801b23447f8fa843f1e15bb77e1` if a reader/navigation regression arises.
- The P12 change has no database or storage migration and therefore no DB rollback.
- A signed-in browser acceptance test cannot be inferred from passing CI; record it separately.

## Next development
P13 structured HTML-compatible Codex editor replacement. Preserve existing stored HTML, inline links, strike/strong/emphasis, selection, author history, and the P11 explicit recovery behavior through the migration.

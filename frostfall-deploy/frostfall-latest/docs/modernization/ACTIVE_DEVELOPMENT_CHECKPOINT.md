# Frostfall Realms — Active Development Checkpoint

**2026-11-18 · P12 Codex Reader Studio**

- Canonical repository: `Thorvald121/Frostfall-Realms-World-Builder`; Next.js root: `frostfall-deploy/frostfall-latest/`.
- Last confirmed **production** release: P11, merge commit `50f9625d409ab801b23447f8fa843f1e15bb77e1`, Vercel READY and aliased to `frostfall-realms.com`.
- P11: browser-local Codex draft recovery scoped by account/world/category/entry, explicit Restore/Discard and receipt-safe cleanup. Authenticated browser acceptance still outstanding; InPrivate storage is ephemeral.
- **P12 branch**: `feature/p12-codex-reader-studio-20261118`. Replaces the sparse saved-article masthead and layout with a responsive Codex Reader Studio (read-only presentation layer). Includes breadcrumb navigation, category/chronology badges, lore metrics, story reading panel and research rail.
- Retains the existing article-data owner, sanitized `SafeRichText` HTML, non-mutating render path, collapsible H2/H3, Canon warnings/panel, link discovery, backrefs, related articles, tags, version history and all existing Edit/Move/Duplicate/Template/Delete handlers.
- New files: `features/codex/CodexReaderWorkspace.jsx`, its theme-token CSS module, `lib/domain/codexReader.js`, and `tests/modernization/codexReaderP12.test.mjs`.
- P12 preview at commit `f63cc5877d26102381f496f9901f6d3578dc7d19` confirmed Vercel READY with green GitHub Vercel status. The earlier failed preview was caused by a test counting an HTML entity as a word; this was corrected before READY. Source syntax checks: 92 JS/JSX, 9 CSS, 129 imports, 0 errors.
- **Release rule**: do not merge until the final branch head has a READY preview and green required checks; production must remain P11 until then. No Supabase migration, direct data edits, external CI cost or paid AI dependencies.
- Visual style: theme tokens across nine themes, Cinzel/Inter typography, responsive reading rail and Tabler/Lucide-inspired actions.
- Remaining acceptance: signed-in P11 recovery test, P12 reader review in Chairondis using Daltos Varix and a second article with headings, links and version history; check mobile width and both theme modes.
- Next major feature: P13 safe structured rich-text editing with HTML round-trip, selection/undo and save-receipt regression coverage. Then Atlas, relationship visualizations, account deletion and further app decomposition.

See `docs/modernization/PHASE12_HANDOFF.md` for QA and rollback details.

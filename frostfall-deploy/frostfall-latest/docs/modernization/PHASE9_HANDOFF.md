# P9 — World Home Studio / Codex Empty-State Consolidation

**Base:** P8 production on `main`. **Feature:** `feature/p9-modern-world-home-20261117`.

## Replacement scope
- `features/world/WorldHomePage.jsx` is a full replacement of the legacy World Home, not a nested mock screen.
- New `WorldHomePage.module.css` supplies token-based responsive design across desktop/tablet/mobile.
- Preserves editing: tagline, introduction, up to three featured Codex entries, and world cover uploads through existing Supabase calls. No schema changes.
- Empty worlds show three actionable authoring next steps without demo or fabricated lore.
- World-switch race protection: `key={activeWorld.id}`, cancellable fetch effect, explicit read errors, and edit actions disabled if home data is unavailable.
- `components/FrostfallRealms.jsx` removes the redundant legacy `No entries found.` block; the P8 `CodexEmptyState` remains.

## Verification and release
- Local P9 targeted test file `tests/modernization/worldHomeP9.test.mjs`: 10 tests passing.
- Automated code checks are not a substitute for authenticated browser/save workflow testing.
- Require Vercel preview READY and green GitHub check before merging to `main`.
- Live acceptance: select Chairondis (empty), test World Home and Codex; select a populated **authorized** world and confirm categories/recent entries, feature picks, cover upload, tagline save and reload; do not try to access worlds belonging to other users.
- Verify Dark Arcane, Obsidian, Emberforge, Frozen Steel and the remaining themes; phone 320px and common tablet/desktop widths.
- Rollback: revert P9 merge or redeploy verified prior P8 Vercel deployment. No database rollback is necessary for this presentation-only change.

## Remaining modernization
- P10: responsive Codex entry authoring/editor rebuild, structured templates, source linking, accessibility and robust save receipts.
- Subsequent: world Atlas and connection graphs, manuscript studio, deep canon/timeline tools.

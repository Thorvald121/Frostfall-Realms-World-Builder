# Frostfall Realms — Active Development Checkpoint

**2026-11-17 · P9 World Home Studio · GitHub feature branch `feature/p9-modern-world-home-20261117`**

- Canonical source: `Thorvald121/Frostfall-Realms-World-Builder`; Next.js app: `frostfall-deploy/frostfall-latest/`.
- GitHub `main` baseline: P8 `b1cf795f6fb7e402b228333b1515c0f71eb7e9e9`. GitHub connector `velessec` has verified repository write permissions; Vercel auto-builds GitHub branches.
- P1–P8 are merged into `main` and production. P8 shipped a reusable dismissible entry menu and modular Codex workspace; new-entry outside-click problem was addressed in P8.
- P9 changes replace the **entire legacy World Home presentation** (not just an overlay): full-width responsive Studio layout, structured intro, feature pins, recent lore, category breakdown, genuine empty-world getting-started actions.
- P9 corrects a duplicated legacy empty-results message in Codex; `CodexEmptyState` remains the single authoritative empty state.
- Critical world-scope defense: World Home React component is keyed by `activeWorld.id`; asynchronous fetches ignore stale results after world switches and show explicit errors rather than showing a previous world's details.
- P9 preserves Supabase `fetchWorldHome`, `updateWorldHome`, `uploadWorldCover`, owner checks, `worlds` home columns, and existing category / role isolation. No SQL or destructive database migration.
- P9 regression: 10 new static/parser tests locally passed. Next.js production build and authenticated browser interactions must be confirmed on Vercel prior to promotion.
- Production data baseline (last verified): 8 worlds, 168 articles, 16 user profiles; selected world Chairondis has 0 Codex articles. Aelvarin contains 165 but belongs to a distinct access scope; do not bypass RLS.
- Known follow-ups: redesign the *Codex article editor*, consolidate remaining monolithic coordinator logic, improve map/relationship views; reconcile legacy `user_worlds` SECURITY DEFINER view and improve independent backup/restore strategy.
- Standards: Tabler-inspired layout, Lucide icons, nine themes, module-specific icon and label colors; preserve single theme dropdown and accessible responsive behavior.
- Do not claim browser acceptance from a Vercel build alone. Keep rollback deployment ID from previous release.

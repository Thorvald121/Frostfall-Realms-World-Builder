# P7 — World Studio application shell and meaningful overview

Target branch: `feature/p7-world-studio-shell-20261117` based on the verified real GitHub branch `modernization/p6-github-integration-20261116` (`3bc783cdb31c3dd16c3d7a40b044a0cfe6d49eb0`).

## Why this release exists

Live screenshots on 2026-11-17 confirmed that the modernized Chronicles and Canon Studio were shipped inside a largely **legacy dashboard/navigation shell**. The approved P4 standalone concept had a cleaner brand, active-world card, grouped sidebar, contextual toolbar and useful world overview. This release integrates those shell decisions into the actual Next.js application without replacing real Supabase records.

## Implementation

- Replace the legacy 13-category statistics dashboard with a world-scoped Overview: active-world hero, entry/category/manuscript/integrity counts, direct tool launchers, recent lore and an honest empty state.
- Promote brand `Frostfall / REALMS STUDIO`, move author profile to bottom, and keep the active-world switcher prominent. Collapse the long category list behind a real Browse Categories toggle.
- Group every existing tool under The World, Connections, Writing & Canon, Creation & Tools, Account & Help. No former application module is deleted. The Locations link opens the existing locations Codex filter; it is not falsely presented as a completed map builder.
- One global New Entry category menu in the toolbar; compact theme selector remains in the toolbar on desktop and accessible in the mobile sidebar. The nine theme definitions and individually colored Lucide sidebar icons/labels are preserved.
- Responsive/contrast styling uses live theme tokens; a single bounded vertical workspace and sidebar scroll remain.
- No SQL migration, no Auth changes, no package dependency or lockfile changes.

## Data investigation (production read-only)

- 8 worlds, 168 articles in existing production database.
- Chairondis 0 entries; Aelvarin 165; Karak-Izdar 2; Mangoss 1. The Chairondis owner has no ownership or membership access to those other worlds; the zero-entry screenshot is correct for this account/world, not an account-wide data loss.
- Production remains on P6 deployment unless separately promoted. New GitHub commits to P7 feature branch should deploy only to Vercel Preview, not production.

## QA gates

- `pnpm run test:modernization` — now 84 tests, including nine new P7 tests.
- `pnpm run test:syntax` — TS parser and local import resolution.
- `pnpm run build` — Next.js Webpack build on connected Windows workstation.
- Authenticated browser: desktop 1440/1280, tablet, mobile 390/320; nine themes; group expansion; every tool launch; empty Chairondis and populated Aelvarin; switching only between accessible worlds; switching back; refresh; no infinite scroll.
- Release only after Vercel Preview READY at the correct commit and a production promotion decision.

## Known next tasks

- Test actual Next.js compilation on a connected machine. The constrained authoring container did not have Next/React installed.
- Deep redesign of Codex cards/editor, World Home, relationship graph and manuscript editing screens is not part of P7.
- Resolve the production legacy `public.user_worlds` SECURITY DEFINER view security advisory in a reviewed migration; audit remaining function grants; maintain protected backup independent of production DB.
- Commit migrations previously applied to live Supabase and reconcile migration history before merge to main.
- Account deletion remains explicitly tracked, not implemented.

# Frostfall Studio P8 — Codex Workspace and New Entry usability

2026-11-17. Built against live `main` merge commit `f77a61290f2b25e6b95cd1e3230d1d3e8bbae850`.

## Delivered

1. Reusable `EntryTypeMenu` used by the topbar and Codex. Native capture-phase pointer/focus listeners dismiss on outside interaction WITHOUT swallowing the user’s click. Escape dismisses and returns focus to trigger; ArrowUp, ArrowDown, Home and End navigate menu choices. Navigating or changing worlds also dismisses it. No click-blocking full-page dismiss overlay.
2. Codex Studio modern workspace uses an independent module and CSS tokens: summary, world-scoped search, category counts, responsive category scroller, select/filter/sort/list/grid and clear empty states.
3. Pure `summarizeCodexWorkspace` function for deterministic, world-scoped metrics. Does not infer relationship or canonical facts from text, excludes archived entries, honors disabled-category filters.
4. Existing Codex CRUD, search match highlighting, tag and reference filters, bulk workflows, routing, permissions, nine themes and existing world data are retained. No database changes or schema migrations in P8.
5. Removes redundant Codex-only dropdown markup and replaces legacy Codex toolbar/pills/sort UI with reusable components.

## Verification

- 93/93 modernization tests passed, including nine new P8 regression tests.
- Source checker reports 81 JS/JSX modules, six CSS files, and 114 local imports, no errors.
- Exact baseline Git blob SHA checked for changed source before preparing branch.
- A Vercel production build and authenticated browser interaction still require remote CI and signed-in acceptance. Do not claim browser/E2E testing from source-only tests.

## Live acceptance checklist

- Click New Entry and then click in the workspace; the menu closes while the click works normally.
- Open and press Escape: menu closes and keyboard focus returns to the New Entry button.
- Tab into and out of menu, and use ArrowUp/ArrowDown/Home/End; choose a category and verify the correct entry editor opens.
- Repeat in Codex Studio and after world switch; ensure read-only worlds do not offer creation actions.
- Confirm Codex category counts and search work on an existing populated world; try list/grid toggle, tags and references filters, and clear all.
- Test 320/390 px and all nine themes; verify no horizontal page overflow and light palette contrast.
- Verify existing article create/edit/save/reload and cross-world isolation with authorized accounts.

## Remaining roadmap

P9: replace legacy Codex record editor with structured, validated, richer inputs and provenance. P10: manuscript workspace refactor. Relationship engine, Atlas/map builder, and advanced Chronicles follow. Full production backup and the remaining legacy security view should be reviewed separately.

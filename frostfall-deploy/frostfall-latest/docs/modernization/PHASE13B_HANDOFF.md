# P13B — In-App Codex Spellchecker Reliability and Ranking

**2026-11-19 · Repair release**
Branch: `fix/p13b-codex-proofreader-apply-and-ranking-20261119`
Production baseline: P13A `3747606236bd67ff3ec06c20cb8bd54077f34765`

## User finding
Screenshots from a signed-in Chairondis Character edit showed that an inline correction suggestion clicked in the popover **closed the popup without changing the word**. The 19k-word checker also flagged common correct words such as `what`, and offered irrelevant spellings. The previous source-only test suite did not simulate pointerdown → editor blur → click.

## Root cause and fix
In `CodexProofreader.jsx` the editor registered a focusout listener calling a `schedule` function that did `setPopover(null)`. Clicking a suggestion blurs the rich-text editor before the button's `onClick`. The button therefore unmounted before React could invoke the correction handler. The popup also had a broad window scroll capture dismissal.

Fixes:
- Do not close the popup during editor focusout. Keep debounced rescanning.
- Keep outside-pointer and Escape close behavior, but remove broad scroll-capture dismissal.
- Prevent mouse-down focus-stealing on inline and full-panel correction buttons.
- Give explicit “Applied” feedback and a guarded Undo last correction action.
- Failed stale-text replacements visibly open the review panel with an error instead of silently hiding the failure.
- Corrections still modify only a verified Text-node range, preserve ancestor HTML markup, and invoke the existing editor input update path.

## Dictionary and ranking
- Expanded local English word coverage from 19,160 to **118,306** words and declared affix forms, generated from `wooorm/dictionaries` `dictionaries/en/index.dic` and `index.aff` (SCOWL-based). The upstream license is retained in `docs/third-party/english-dictionary-license.txt`.
- Sagnverk's locally bundled 10,000-word frequency ranking is reused solely for client-side suggestion ordering.
- Common-typo corrections and plausible joined-word splits improve usefulness: `teh → the`, `wierd → weird`, `wth → with`, `wirking → working`, `itworking → it working`.
- Correct common words such as `what`, `which`, `with`, `testing`, `working`, and `correctly` are accepted.
- Engine remains lazy and offline. These words are **not** a full Hunspell grammar or morphology implementation, and suggestions are not guaranteed correct.

## Test gate
- Vercel prebuild invokes `test:modernization` and `test:syntax`, followed by the Next production build.
- Source regression `tests/modernization/codexSpellingP13B.test.mjs` tests the actual screenshot sentence, ranked suggestions, popover focusout guard, safe verified replacement and undo, license dataset size and zero network spelling requests.
- Implementation preview at `770b062dbe1e39737b2be9fe3f7b1a53f96df798` is READY and GitHub Vercel status green: **150/150 modernization tests passed, zero syntax/import errors**.
- After documentation commit, verify final branch head again. Merge only after READY and green status, then verify exact merge SHA from production alias.

## User browser acceptance (required)
1. Open the production site signed in, Chairondis → Daltos Varix → Edit → Lore & Narrative.
2. Type `teh wierd castle`; click `teh` and choose **the**. The word must visibly change in the editor immediately and the popup should close intentionally.
3. Use Undo last correction. The word should revert; reapply the correction.
4. Type `wth` and `itworking`. Verify **with** and **it working** suggestions are visible and applied.
5. Confirm correctly spelled `what` is **not** underlined. Open the full review panel and apply a correction there as well.
6. Confirm strikethrough/bold paragraphs remain formatted, select **Save changes**, navigate back, reload and verify cloud persistence. P11 draft recovery remains operable on unsaved text.
7. Check mobile-sized window, dark/light theme, keyboard dismissal. Avoid interpreting an InPrivate local dictionary as durable storage.

## Scope and rollback
- Frontend-only. No Supabase schema, data, authorization, RLS, or account change.
- Roll back Vercel to the P13A production deployment (`3747606236bd67ff3ec06c20cb8bd54077f34765`) if a save/navigation regression appears.
- Automated tests provide evidence for the new fix, but only a signed-in browser interaction establishes end-to-end user acceptance.

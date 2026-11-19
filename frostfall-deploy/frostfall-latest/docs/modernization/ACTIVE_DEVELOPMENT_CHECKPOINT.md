# Frostfall Realms — Active Development Checkpoint

**2026-11-19 · P13B Codex Writing Assistant Reliability Repair**

- Canonical repository: `Thorvald121/Frostfall-Realms-World-Builder`; deployment root: `frostfall-deploy/frostfall-latest/`; production domain `frostfall-realms.com`.
- P1–P13A merged. **Last verified production baseline before this repair:** P13A merge commit `3747606236bd67ff3ec06c20cb8bd54077f34765`. Do not call P13B live until the merge SHA is READY on the domain alias.
- User acceptance on **2026-11-19** identified a critical bug: clicking inline spelling suggestions dismissed the popover but failed to apply changes. Source cause: editor `focusout` immediately triggered `setPopover(null)` during the pointer/click sequence, unmounting the suggestion button before its `onClick`. Window scroll capture dismissal was also overly broad.
- Active repair branch: `fix/p13b-codex-proofreader-apply-and-ranking-20261119`. Corrects the blur race; prevents mouse focus changes on correction buttons; retains outside-click and Escape dismissal. Explicitly confirms the change in-app with guarded **Undo last correction**, or shows a visible stale-text failure.
- P13B replaces the previous narrow 19,160-word headword list with 118,306 normalized root + affix-form English spellings derived from wooorm/dictionaries/SCOWL; retains licensed provenance. Uses a lazily loaded Sagnverk frequency ordering (10k) to rank candidates. Adds common errors and detects common accidentally joined words (e.g., `itworking`).
- User screenshot regression corpus: `teh`, `wierd`, `wth`, `itworking` receive useful candidates; `what`, `with`, `working`, `correctly`, `testing` are not incorrectly flagged.
- No database migrations, paid API/CI or new npm dependency; existing P11 browser-local account/world/entry draft backups, receipt-gated clearing, `handleArticleBodyInput`, and Supabase save path remain in charge. Existing HTML markup and rich text are never replaced wholesale to fix spelling.
- `tests/modernization/codexSpellingP13B.test.mjs` adds behavior and corpus tests. Implementation head `770b062dbe1e39737b2be9fe3f7b1a53f96df798` preview verified Vercel READY with 150/150 Node tests, syntax/import checks pass.
- **Final release gate**: after docs commit, verify final branch preview READY and GitHub Vercel green; merge reviewed PR, then verify main merge SHA and alias `frostfall-realms.com`. Authenticated browser interaction remains unverified until the author tests; do not equate green tests with user acceptance.
- **Next milestones:** true Hunspell morphological/suggestion engine and stronger contextual proofreading; grammar/punctuation and repetition checks; world dictionary synchronized under Supabase RLS rather than transient browser storage; P14 structured editor with native history and robust round-trip HTML.
- Preserve nine themes, Tabler/Lucide styling, direct FQDN access and separation between unsaved local drafts and verified cloud saves.
- Refer to `docs/modernization/PHASE13B_HANDOFF.md` for acceptance and rollback.

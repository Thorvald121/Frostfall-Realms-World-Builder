# P13A — Codex In-App Writing Assistant

**Date:** 2026-11-18
**Branch:** `feature/p13a-codex-local-spelling-20261118`
**Baseline:** P12 production `78d348087c95d0c4685ec0868c0b5eb127fd9f27`

## Why
The author supplied signed-in screenshots showing that Codex still relies on Edge/Chrome browser spelling underlines and browser correction menus. Frostfall should have its own predictable, in-app review workflow similar to Sagnverk.

## Implemented
- Local offline English (US) spelling checks in the Codex rich-text body, using a **19,160-entry lexicon reused from the author's Sagnverk project**. One lazy-loaded dictionary per session, no API requests for authored text, and no new paid service or npm dependency.
- Debounced scanning; application-owned underlines using CSS Custom Highlight when supported; a contextual correction popover when clicking an issue plus a Writing Assistant review panel for the full list.
- Ranked candidate corrections use restricted Damerau edit distance, a small common-typo override list, and case preservation. No automatic replacement or unsupported grammar claims.
- Corrections are guarded by exact Text-node match before replacing text. Existing bold, italic, strikethrough, links, paragraphs, Canon metadata, undo context and P11 draft/save handlers are not overwritten by an HTML replacement.
- Existing article titles and tags become allowed world vocabulary; capitalized unknown fantasy names are ignored by default, with optional “Check possible names”.
- Ignore-word for current editor entry, and Add to World Words saved under a **user/world-scoped browser-local** key. Storage failures are reported visibly.
- Browser spellcheck is disabled while the app checker is operating, with a visible browser fallback only when the dictionary cannot load.
- Plain text hints, status text, correction actions and accessible labels are themed using existing UI tokens and small-screen breakpoints.

## Explicit limitations
- This is a conservative **spelling milestone**, not the full Sagnverk Hunspell/ranking/grammar ecosystem. The shared 19k lexicon can miss words or propose imperfect corrections; the author is always in control.
- A custom world dictionary is browser-local, not synchronized via Supabase and not guaranteed to survive InPrivate session closure or cleared browser storage.
- A CSS inline underline needs Custom Highlight API support; the in-app review panel still provides corrections without it.
- No account- or world-crossing vocabulary; no background network calls for manuscript text.
- This does not migrate deprecated `execCommand` editing. That remains a separate structural editor release.

## Release gate
1. Verify final branch head is Vercel preview READY, green GitHub Vercel status, all modernization tests pass, source syntax/import check is clean, Next build succeeds.
2. Merge the tested PR to main; verify production alias `frostfall-realms.com` serves the exact merge SHA in READY state.
3. Run signed-in acceptance using Chairondis/Daltos Varix, save and reload from the same account. Existing lore and strikethrough must persist.
4. Exercise typos `teh`, `wierd`, `becuase`, `wirking`, as well as capitalized fantasy names; verify corrections and world vocabulary; check dark/light and mobile.
5. Test selection, editing and navigation while P11 browser-local draft recovery is enabled; no stale cloud-save receipt may erase a newer backup.

## Rollback
Frontend-only revert to P12 Vercel production deployment at `78d348087c95d0c4685ec0868c0b5eb127fd9f27`; no schema/data rollback.

## Next development
- P13B: high-coverage Hunspell lexicons and context-aware ranking; deterministic grammar/punctuation/repetition checks; persistent per-world vocabulary under existing Supabase permissions; accessible panel filters.
- P14: replace deprecated rich text commands with a structured editor preserving stored HTML, text selection, undo and receipt-safe cloud saves.

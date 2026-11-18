# Frostfall Realms — Active Development Checkpoint

**2026-11-18 · P13A Codex In-App Spelling**

- Canonical GitHub repository: `Thorvald121/Frostfall-Realms-World-Builder`; deploy root: `frostfall-deploy/frostfall-latest/`.
- P1–P12 merged and production verified; **P12 baseline commit** `78d348087c95d0c4685ec0868c0b5eb127fd9f27` on `frostfall-realms.com`.
- P11 browser-local drafts remain account/world/category/entry isolated; only matching Supabase receipts clear backups; authenticated recovery test still outstanding.
- **Active milestone P13A**: `feature/p13a-codex-local-spelling-20261118`. A Codex Writing Assistant with local lexicon sourced from Sagnverk, app-owned spelling underlines, inline suggestions, full review panel, safe Text-node-only corrections, world-aware names, and user/world browser-local custom words. No AI API, no paid CI, no new DB schema or dependency.
- Existing editor `handleArticleBodyInput`, `attemptSave`, `sanitizeRichHtml` and draft-recovery controller remain authoritative. No change to database content before release.
- Release gate: final branch preview must be READY with green GitHub status and full tests before merge; confirm the **merge SHA** from production alias afterward. Manual authenticated browser acceptance remains separate.
- Future P13B: broader Hunspell lexicon, grammar/punctuation, per-world cloud vocabulary, richer ranking; P14 structured editor replacing `execCommand`; Atlas, cross-reference graph, account deletion and documentation debt.
- Preserve nine themes, Tabler/Lucide UI, explicit cloud-vs-local save distinction, good keyboard and responsive affordances.
- Full scope, limitations and rollback: `docs/modernization/PHASE13A_HANDOFF.md`.

# Frostfall Realms — Active Development Checkpoint

**2026-11-18 · P11 Codex Draft Recovery**

- Canonical repo: `Thorvald121/Frostfall-Realms-World-Builder` deployable Next.js root: `frostfall-deploy/frostfall-latest/`.
- P1–P10.1 have been merged to `main` and deployed to `frostfall-realms.com` on Vercel. Last verified baseline: `9c82d0107a2f448006989e0a5ea1ebfb754ac6d4`.
- P11 source: `feature/p11-codex-draft-recovery-20261118` requires preview READY + green GitHub status before merging.
- New `lib/domain/codexDraftRecovery.js` and Codex editor UI allow **explicit** recovery of browser-local unsaved drafts without overwriting real cloud entries.
- Scoped local recovery keys: user UUID, world UUID, category, entry identity. Size and age bounded; storage failure warnings; strong token compare to prevent stale write receipt deleting new work.
- A draft's backup is only cleared after an acknowledged Supabase bulk article save including the same article ID and updatedAt revision. Existing persistence, RLS and active data untouched.
- The user-created Chairondis test entry **Daltos Varix** was independently found in the live Supabase table with strikethrough HTML retained; actual page reload testing remains pending.
- Vercel prebuild runs all Node modernization + JS/CSS/import checks. No paid CI or external npm dependency added in P11.
- Future major work: Lexical-style rich-text engine migration with round-trip tests; true save receipts; article detail screen redesign; world Atlas; relationship graph; canonical source/security review, account deletion.
- Strict visual standards: Tabler-inspired UI, Lucide, nine themes, distinct sidebar label/icon colors, responsive layouts and genuine manual/cloud save differentiation.
- See `docs/modernization/PHASE11_HANDOFF.md` for safe acceptance and rollback.

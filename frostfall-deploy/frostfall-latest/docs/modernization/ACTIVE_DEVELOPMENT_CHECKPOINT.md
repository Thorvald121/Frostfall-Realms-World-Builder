# Frostfall Realms — Active Development Checkpoint

**2026-11-18 · P10 Codex Authoring Workspace**

- Canonical GitHub repository: `Thorvald121/Frostfall-Realms-World-Builder`; deployable Next.js app in `frostfall-deploy/frostfall-latest/`.
- P1–P9 merged and live on `main`. Last verified P9 production: `4a0244f4fae3e171e0a9e15fc2d2bc4675290b55`, Vercel `dpl_8gx4WvxMHSwgfrrgffLpHxqs272y`.
- P10 feature branch: `feature/p10-codex-authoring-workspace-20261118`; directly connected GitHub `velessec` has write permission, Vercel builds every branch.
- New `features/codex/CodexEditorWorkspace.jsx` and scoped CSS; 4 authoring sections, responsive rail, draft summary, accessible Save/Cancel buttons.
- Existing category property model, rich-text editor, portrait uploads, duplicate/integrity gates and Supabase article save remain authoritative.
- `lib/domain/editorDraft.js` snapshots sanitized rich-text body directly at save-time before React's debounce can leave stale state; use this same draft through duplicate and integrity dialogs.
- P10 adds `prebuild` test/syntax gates to existing Vercel Next.js build (no external paid GitHub CI).
- No DB migrations, data resets, auth changes or separate ZIP required for P10.
- P10 preview build/test gate still pending; do not claim released until branch and production deploy both READY.
- Database reference, last verified: 8 worlds, 168 articles, 16 profiles, 8 main Canon branches. Chairondis is currently empty; other users' worlds must not be exposed.
- Next major work: modern rich-text editing engine/HTML migration and robust autosave + version receipts, Atlas, relationship graph, account deletion, and SECURITY DEFINER view review.
- UI standards: Tabler-inspired design, Lucide, 9 theme palettes with one selector, distinct navigation icon and label colors, accessible dark/light contrast and mobile scaling.
- See `docs/modernization/PHASE10_HANDOFF.md` for acceptance gates.

# Frostfall Realms — P6 staged-app safety and build handoff

**2026-11-16** · Branch `modernization/p6-safe-rich-text-and-staging-20261116` · Parent P5 `e836fc02bd4b39b80853a6046a40cf1ee265cc08`.

## Implemented (code only; no deployment)

1. **Safe lore/novel display.** The Codex article display, article preview, world introduction and novel comparison pane now use a strict React-element renderer (`components/ui/SafeRichText.jsx` + `lib/domain/richTextSafety.js`) instead of inserting untrusted stored HTML into the live DOM. The parser accepts a small HTML vocabulary (headings, paragraphs, emphasis, lists, tables, approved links and non-SVG images); rejects source event handlers, inline CSS, scripts, SVG/MathML, iframes and embedded active content; and only keeps valid mention identifiers. Text and markup colors inherit the chosen theme for visibility.
2. **Editor rehydration boundary.** Legacy article/scene bodies are normalized before being placed in editable DOM. Accepted AI completions and proofreader suggestions are encoded as text instead of being interpreted as executable HTML.
3. **Staging identity marker.** The new `/api/staging-status` route responds only when `FROSTFALL_DEPLOYMENT_ROLE=staging` and returns no secrets. The read-only staging HTTP smoke script refuses old/incorrect build markers before performing any additional checks.
4. **Browser isolation protections.** Add `frame-ancestors 'none'`, `object-src 'none'` and `base-uri 'self'` CSP directives, plus a noindex header when explicitly in staging. **Not** a full script-src CSP (requires Next nonce/inlining compatibility work and runtime tests).
5. **Reproducible staging runner.** `scripts/Invoke-Frostfall-P6-Staging.ps1` loads a noncommitted staging environment file without `Invoke-Expression`, checks Git checkout isolation, optionally regenerates the lockfile on a connected trusted machine, runs preflight, frozen pnpm install, tests and production build, and optionally runs read-only HTTP smoke. It never pushes branches, deploys images, migrates schemas, or changes live data.
6. **Pinned package manager.** `packageManager: pnpm@9.15.9`; the P5 lockfile remains unchanged until network-assisted resolution. Never invent lock entries.

## Verified locally

- Targeted modernization tests: 75/75.
- Chromium rich-text injection corpus: 10/10 cases; no source scripts/events/unsafe URLs survived or executed.
- TypeScript compiler syntax parser: 74 JavaScript modules (including scripts and tests), zero parse diagnostics.
- CSS parser: 5 CSS files, zero parse errors.
- The runtime rich-text parser introduces no dependency; TypeScript 5.9.3 is added as an explicit development dependency for reproducible local syntax checks.
- P6 preflight correctly refuses a missing isolated staging environment and the outdated Tabler/Lucide/TypeScript lockfile.

## NOT verified / BLOCKERS

- **Full Next.js/pnpm build is blocked.** The npm registry is unreachable (DNS `EAI_AGAIN`) from the current engineering environment. P5's `pnpm-lock.yaml` lacks `@tabler/core` and `lucide-react` entries. A frozen install and production build therefore **cannot** be claimed.
- No verified staging FQDN or isolated staging Supabase instance is configured in this session. Do not point staging at production Supabase or copy production secrets into chat.
- The connected GitHub repository remains read-only; the bundle is portable but has **not** been pushed to a remote or deployed.
- P2 and P3 SQL migrations require separate staging review, backup, and owner/editor/viewer RLS tests; do not run them in production.
- Rich-text sanitization is only one defense; full CSP, authenticated RLS E2E, data-export and account-deletion workflows require further development before production launch.

## Windows staging build gate (no tunnels)

1. Extract P6 release and run `scripts/Import-Frostfall-P6.ps1` with the Git bundle into a **brand new local staging checkout**. This script refuses any existing destination. Do not replace the production checkout.
2. Use Node 22+, enable pnpm 9.15.9 with Corepack on a computer with working npm access. Create an ignored `.env.staging.local` from `.env.staging.example`, containing **separate, real staging** FQDN and Supabase project values. Do not commit it.
3. From PowerShell, run (adjust paths):

```powershell
& .\scripts\Invoke-Frostfall-P6-Staging.ps1 `
  -Repository "$env:USERPROFILE\Documents\realms-rework\frostfall-p6-staging" `
  -EnvironmentFile "$env:USERPROFILE\Documents\realms-rework\frostfall-p6-staging\.env.staging.local" `
  -RepairLockfile
```

The script will refuse same-host/same-Supabase environments and will not deploy. Review and commit the regenerated `pnpm-lock.yaml` only after install/build success. If an isolated HTTPS staging app is subsequently deployed, repeat with `-RunHttpSmoke` to test its P6 marker, security headers and rejection of unauthenticated AI calls.

## Subsequent login acceptance on real staging

- Dedicated staging test user: register/sign in, recover password, OAuth sign-in if enabled, sign out.
- Owner/editor/viewer access: different users, two worlds, checks for forbidden reads and writes, canonical fact and evidence isolation.
- Book persistence: concurrent edits, revision conflict recovery, empty/failed world read, backup verification and restore.
- Codex HTML corpus: malicious import, prose formatting, tables, images, links, mentions and accessible contrast across all nine themes.
- Chronicle event inspector and filters: negative/zero years, multiple overlapping events, mobile 320 px layout and no scroll chaining.
- Rollback: staging DB snapshot and previous deploy image. Production promotion requires a separate explicit decision.

## Next engineering target

After a real build and isolated staging database pass, integrate remaining rich-text input surfaces with a structured editor, test full script-src CSP on Next.js, and complete authenticated staging E2E. Account deletion remains a separate owner-aware, explicitly confirmed destructive workflow.
